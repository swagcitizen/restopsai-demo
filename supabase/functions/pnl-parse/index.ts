// pnl-parse: downloads the uploaded file, extracts text, runs AI classification,
// writes grouped line items. Handles BOTH formal P&L documents and raw bank statements.
// For bank statements it groups transactions by payee/category so the owner reviews ~10-15
// meaningful buckets instead of 80+ individual transactions.
// Body: { import_id: uuid }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import * as XLSX from 'https://esm.sh/xlsx@0.18.5';
import { extractText, getDocumentProxy } from 'https://esm.sh/unpdf@0.12.1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return j({ error: 'POST only' }, 405);

  try {
    const { import_id } = await req.json();
    if (!import_id) return j({ error: 'import_id required' }, 400);

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: imp, error: iErr } = await supa.from('pnl_imports').select('*').eq('id', import_id).single();
    if (iErr || !imp) return j({ error: 'import not found' }, 404);

    await supa.from('pnl_imports').update({ status: 'parsing' }).eq('id', import_id);

    const { data: blob, error: dErr } = await supa.storage.from('pnl-uploads').download(imp.storage_path);
    if (dErr || !blob) return fail(supa, import_id, `download failed: ${dErr?.message}`);
    const buf = new Uint8Array(await blob.arrayBuffer());

    let rawText = '';
    try {
      if (imp.file_type === 'pdf') rawText = await extractPdf(buf);
      else if (imp.file_type === 'csv') rawText = new TextDecoder().decode(buf);
      else if (imp.file_type === 'xlsx') rawText = extractXlsx(buf);
    } catch (e) {
      return fail(supa, import_id, `extract failed: ${String(e?.message ?? e)}`);
    }
    if (!rawText.trim()) return fail(supa, import_id, 'no text extracted');

    // Cap content sent to AI
    const trimmed = rawText.length > 40000 ? rawText.slice(0, 40000) : rawText;

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return fail(supa, import_id, 'ANTHROPIC_API_KEY not configured');

    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Classify this document and return the appropriate JSON.\n\n<document>\n${trimmed}\n</document>` }],
      }),
    });
    if (!aiResp.ok) return fail(supa, import_id, `AI error: ${await aiResp.text()}`);
    const aiJson = await aiResp.json();
    const text = aiJson.content?.[0]?.text ?? '';
    const parsed = parseJson(text);
    if (!parsed) return fail(supa, import_id, 'AI response not valid JSON');

    const items = (parsed.line_items ?? []).map((li: any, idx: number) => ({
      import_id,
      raw_label: String(li.label ?? '').slice(0, 200),
      raw_amount: Number(li.amount ?? 0),
      mapped_category: VALID_CATS.includes(li.category) ? li.category : 'other_opex',
      confidence: Math.min(1, Math.max(0, Number(li.confidence ?? 0.5))),
      ai_reasoning: String(li.reasoning ?? '').slice(0, 500),
      display_order: idx,
    })).filter((r: any) => r.raw_label && !Number.isNaN(r.raw_amount) && r.raw_amount > 0);

    if (items.length === 0) return fail(supa, import_id, 'no line items found');

    const { data: inserted, error: liErr } = await supa.from('pnl_line_items').insert(items).select('*').order('display_order');
    if (liErr) return fail(supa, import_id, `insert lines: ${liErr.message}`);

    // Do NOT store raw_text for bank statements (sensitive data minimization)
    const isBankStatement = parsed.document_type === 'bank_statement';
    await supa.from('pnl_imports').update({
      status: 'needs_review',
      raw_text: isBankStatement ? null : trimmed,
      period_start: parsed.period_start ?? null,
      period_end: parsed.period_end ?? null,
    }).eq('id', import_id);

    return j({
      import_id,
      document_type: parsed.document_type,
      document_summary: parsed.document_summary ?? null,
      line_count: inserted?.length ?? 0,
      period_start: parsed.period_start,
      period_end: parsed.period_end,
      line_items: inserted ?? [],
    });
  } catch (e) {
    return j({ error: String(e?.message ?? e) }, 500);
  }
});

const VALID_CATS = ['revenue','food_cost','beverage_cost','labor','rent','utilities','marketing','other_opex','ignore'];

const SYSTEM_PROMPT = `You are a restaurant accounting expert. You analyze uploaded financial documents from independent restaurant owners and extract line items suitable for a monthly P&L.

STEP 1 — Classify the document:
- 'pnl': A formal Profit & Loss statement from QuickBooks, Xero, an accountant, or a spreadsheet, with named line items (Revenue, Food Cost, Labor, etc.).
- 'bank_statement': A bank or credit card statement listing individual transactions with dates and amounts (JPMorgan Chase, Bank of America, Wells Fargo, etc.).

STEP 2 — Extract line items:

For 'pnl' documents:
- Extract each reported line exactly as shown
- Map totals/subtotals to 'ignore' so they don't double-count components

For 'bank_statement' documents:
- GROUP transactions into meaningful buckets — never return 50+ individual transactions
- Each bucket summarizes transactions that share the same payee AND category (e.g. 'Slice Solutions deposits', 'Restaurant Depot food purchases', 'Orlando Utilities')
- The 'label' must describe the bucket AND include transaction count, e.g. 'POS Sales — Slice Solutions (35 deposits)'
- The 'amount' is the TOTAL for that bucket
- Put transaction count and example dates in 'reasoning'

Categories available:
- revenue: POS deposits (Slice, Toast, Square, Clover), delivery apps (Uber Eats, DoorDash, Grubhub), catering revenue, merchant card deposits
- food_cost: Restaurant Depot, Sysco, US Foods, Sams Club/Costco for restaurant supply, Wawa/local markets for food, Gordon Food, wholesale food vendors
- beverage_cost: liquor stores, wine wholesalers, beer distributors, ABC Fine Wine, Southern Glazer's
- labor: payroll services (Gusto, ADP, Paychex, Intuit Payroll), direct payroll deposits, obvious wage transfers
- rent: landlord payments, commercial lease, property management
- utilities: electric (Duke, FPL, Orlando Utilities, City of St Cloud utilities, Gas South, FPUC), water, internet/cable (Spectrum, AT&T, Xfinity, Comcast), phone (Spectrum Mobile, Verizon Business)
- marketing: Facebook/Meta Ads, Google Ads, Instagram promotions, Yelp ads, printing services
- other_opex: insurance, software (QuickBooks/Intuit, Perplexity, OpenAI, POS software, accounting), bank fees, equipment financing (Fintegra, Navitas), equipment lease, repairs, supplies (Wm Supercenter for supplies), credit card processing fees, Authnet Gateway, medical/urgent care
- ignore: DO NOT include these in P&L totals:
    * Inter-account transfers ('Online Transfer To/From Chk ...', Zelle to self)
    * Credit card payment made ('Payment To Chase Card Ending')
    * Personal/owner activity (Citi Card Online payments, owner Zelle to self, ATM withdrawals to owner)
    * Fee reversals (offset by fees)
    * Loan principal/draws
    * Beginning/ending balance lines

RULES:
- All amounts are positive (we know deposits are revenue and withdrawals are expense).
- Only return buckets with amount > 0.
- If you see Restaurant Depot, Sysco, Costco for restaurant supply, classify as food_cost even if the statement doesn't label it that way — use common sense for a restaurant business.
- If the owner's name appears next to a withdrawal, it may be an owner draw — classify as 'ignore' unless clearly payroll.
- Detect the period from the statement header.

Return ONLY JSON, no prose, no markdown fences:
{
  "document_type": "pnl" | "bank_statement",
  "document_summary": "1-sentence description for the user, e.g. 'Chase business checking, March 2026. 45 deposits, 37 withdrawals.'",
  "period_start": "YYYY-MM-DD or null",
  "period_end": "YYYY-MM-DD or null",
  "line_items": [
    { "label": "POS Sales — Slice Solutions (35 deposits)", "amount": 14411.04, "category": "revenue", "confidence": 0.98, "reasoning": "35 ACH deposits from Slice Solutions POS across Mar 2-31" }
  ]
}`;

function parseJson(text: string): any {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
  try { return JSON.parse(cleaned); } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

async function extractPdf(buf: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(buf);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join('\n') : String(text ?? '');
}

function extractXlsx(buf: Uint8Array): string {
  const wb = XLSX.read(buf, { type: 'array' });
  let text = '';
  for (const sheetName of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
    text += `\n# Sheet: ${sheetName}\n${csv}\n`;
  }
  return text;
}

async function fail(supa: any, id: string, msg: string) {
  await supa.from('pnl_imports').update({ status: 'error', parse_error: msg }).eq('id', id);
  return j({ error: msg }, 500);
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
