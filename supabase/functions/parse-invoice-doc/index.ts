// parse-invoice-doc — parse a PDF or CSV uploaded from the Expenses hub and
// return staged expense rows for the manager to review in the browser before
// committing. We DO NOT write anything to the database here; the client owns
// the commit step, calling expenses_misc inserts after the user edits the
// rows in the Review screen.
//
// Request: multipart/form-data with:
//   * file       — the uploaded PDF or CSV
//   * tenant_id  — uuid (kept for logging only; RLS still gates the eventual insert)
//
// Response: { rows: Array<StagedRow>, source: 'pdf' | 'csv' }
//
// Each StagedRow:
//   { occurred_on: 'YYYY-MM-DD', vendor: string, category: string, amount: number, notes?: string }
//
// PDF flow: extract text with unpdf, then ask Claude (cheap model) to return a
// strict JSON array of staged rows. CSV flow: parse inline, no AI needed.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { extractText } from 'https://esm.sh/unpdf@0.12.1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are an invoice/expense extractor for a restaurant back-office.
You are given the raw text of a vendor invoice, utility bill, rent statement, or any other expense document.
Return STRICT JSON only, no prose, no markdown fences.

Shape:
{
  "rows": [
    {
      "occurred_on": "YYYY-MM-DD",
      "vendor": string,
      "category": one of "food" | "labor" | "rent" | "utilities" | "insurance" | "fees" | "waste" | "other",
      "amount": number (positive),
      "notes": string (optional, short)
    }
  ]
}

Rules:
- Prefer ONE row per document (the document total). Only return multiple rows if the document covers multiple distinct expense categories.
- If you cannot find a date, use today.
- Use a positive amount in dollars (number, not string).
- Category mapping hints: Sysco/Publix/Restaurant Depot/produce/meat/dairy = food. Duke Energy/water/gas/comcast/verizon = utilities. Property/landlord/lease = rent. State Farm/Hartford = insurance. Toast/Square/Stripe/Doordash/Ubereats = fees.
- Return JSON ONLY, starting with { and ending with }.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return j({ error: 'POST only' }, 405);

  try {
    const form = await req.formData();
    const file = form.get('file');
    const tenantId = (form.get('tenant_id') ?? '').toString();

    if (!(file instanceof File)) {
      return j({ error: 'file is required (multipart form field)' }, 400);
    }

    const name = (file.name || '').toLowerCase();
    const mime = (file.type || '').toLowerCase();
    const isCsv = name.endsWith('.csv') || mime === 'text/csv';
    const isPdf = name.endsWith('.pdf') || mime === 'application/pdf';

    if (!isCsv && !isPdf) {
      return j({ error: 'Only PDF and CSV files are supported.' }, 400);
    }

    if (isCsv) {
      const text = await file.text();
      const rows = parseCsv(text);
      return j({ source: 'csv', rows, tenant_id: tenantId });
    }

    // PDF path
    const buf = new Uint8Array(await file.arrayBuffer());
    let rawText = '';
    try {
      const out = await extractText(buf, { mergePages: true });
      rawText = typeof out === 'string' ? out : (out?.text ?? '');
    } catch (e) {
      return j({ error: `PDF text extraction failed: ${String((e as Error)?.message ?? e)}` }, 400);
    }
    if (!rawText.trim()) {
      return j({ error: 'No extractable text in PDF. Try a non-scanned PDF, or paste the data into a CSV.' }, 400);
    }
    const trimmed = rawText.length > 30000 ? rawText.slice(0, 30000) : rawText;

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      // Graceful degradation: send back ONE heuristic row so the user can edit it.
      const fallback = heuristicRowFromText(trimmed);
      return j({ source: 'pdf', rows: fallback, fallback: true, hint: 'ANTHROPIC_API_KEY not configured — returned single heuristic row.' });
    }

    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: `Extract expense rows from this document text:\n\n<document>\n${trimmed}\n</document>` },
        ],
      }),
    });

    if (!aiResp.ok) {
      const errBody = await aiResp.text().catch(() => '');
      return j({ error: `AI parser error (${aiResp.status})`, detail: errBody }, 502);
    }

    const aiJson = await aiResp.json();
    const text = aiJson.content?.[0]?.text ?? '';
    const parsed = parseJson(text);
    if (!parsed || !Array.isArray(parsed.rows)) {
      return j({ error: 'Parser did not return valid JSON rows.', raw: text }, 502);
    }

    const cleaned = parsed.rows
      .map((r: any) => ({
        occurred_on: normalizeDate(r.occurred_on) || new Date().toISOString().slice(0, 10),
        vendor: String(r.vendor ?? '').trim() || 'Vendor',
        category: validCategory(r.category) ? r.category : 'other',
        amount: Math.abs(Number(r.amount ?? 0)) || 0,
        notes: r.notes ? String(r.notes).slice(0, 200) : undefined,
      }))
      .filter((r: any) => r.amount > 0);

    return j({ source: 'pdf', rows: cleaned });
  } catch (e) {
    return j({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

function parseJson(s: string): any | null {
  if (!s) return null;
  // Strip code fences if present
  const cleaned = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fallthrough */ }
  // Try to extract the first {...} block
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

const VALID_CATS = ['food', 'labor', 'rent', 'utilities', 'insurance', 'fees', 'waste', 'other'];
function validCategory(c: any) { return typeof c === 'string' && VALID_CATS.includes(c); }

function normalizeDate(s: any): string {
  if (!s) return '';
  const str = String(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let y = m[3]; if (y.length === 2) y = '20' + y;
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return '';
}

// CSV
function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const firstCells = splitCsvLine(lines[0]);
  const firstHasText = firstCells.some((c) => isNaN(parseFloat(c)) && c.length > 0);
  let header: string[] | null = null;
  let dataLines = lines;
  if (firstHasText) { header = firstCells.map((s) => s.toLowerCase().trim()); dataLines = lines.slice(1); }

  return dataLines.map((line) => {
    const cells = splitCsvLine(line);
    const obj: Record<string, string> = {};
    if (header) {
      header.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
    } else {
      obj.date = cells[0] ?? ''; obj.vendor = cells[1] ?? ''; obj.amount = cells[2] ?? ''; obj.category = cells[3] ?? ''; obj.notes = cells[4] ?? '';
    }
    const vendor = obj.vendor || obj['description'] || obj['merchant'] || '';
    const amountRaw = obj.amount ?? obj.total ?? obj['debit'] ?? '';
    const amount = parseFloat(String(amountRaw).replace(/[$,]/g, '')) || 0;
    return {
      occurred_on: normalizeDate(obj.date || obj['transaction date'] || obj['posted date'] || '') || new Date().toISOString().slice(0, 10),
      vendor: vendor.trim() || 'Imported expense',
      category: guessCategory(vendor),
      amount: Math.abs(amount),
      notes: (obj.notes || obj['memo'] || '').trim() || undefined,
    };
  }).filter((r) => r.amount > 0);
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function guessCategory(vendor: string): string {
  const v = (vendor || '').toLowerCase();
  if (/publix|sysco|us foods|restaurant depot|produce|meat|dairy|bakery|cheese/.test(v)) return 'food';
  if (/duke energy|electric|water|gas company|utility|comcast|verizon|internet/.test(v))  return 'utilities';
  if (/rent|landlord|property|lease/.test(v))                                              return 'rent';
  if (/insurance/.test(v))                                                                 return 'insurance';
  if (/doordash|ubereats|grubhub|toast|square|stripe|pos/.test(v))                         return 'fees';
  return 'other';
}

// Heuristic fallback for when no AI key is configured
function heuristicRowFromText(text: string) {
  // Find the largest dollar figure in the text — usually the total.
  const m = text.match(/\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g) || [];
  let max = 0;
  for (const s of m) {
    const v = parseFloat(s.replace(/[$,\s]/g, '')) || 0;
    if (v > max) max = v;
  }
  // First non-empty line is usually the vendor name on most invoices.
  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 2 && l.length < 80) || 'Vendor';
  return [{
    occurred_on: new Date().toISOString().slice(0, 10),
    vendor: firstLine,
    category: guessCategory(firstLine),
    amount: max,
    notes: 'Parsed from PDF without AI (heuristic). Please review.',
  }].filter((r) => r.amount > 0);
}
