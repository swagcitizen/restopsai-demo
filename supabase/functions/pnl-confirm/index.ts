// pnl-confirm v2: accepts final mapping, rolls up to pnl_period_summary,
// then minimizes stored data (deletes storage file + nulls raw_text).
// Body: { import_id: uuid, period_start: 'YYYY-MM-DD', period_end: 'YYYY-MM-DD',
//         line_items: [{ id: uuid, mapped_category: string }] }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const VALID = ['revenue','food_cost','beverage_cost','labor','rent','utilities','marketing','other_opex','ignore'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return j({ error: 'POST only' }, 405);

  try {
    const { import_id, period_start, period_end, line_items } = await req.json();
    if (!import_id || !period_start || !period_end || !Array.isArray(line_items)) {
      return j({ error: 'import_id, period_start, period_end, line_items required' }, 400);
    }

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: imp, error: iErr } = await supa.from('pnl_imports')
      .select('id, tenant_id, storage_path')
      .eq('id', import_id).single();
    if (iErr || !imp) return j({ error: 'import not found' }, 404);

    // Update each line item's mapped_category + mark confirmed
    for (const li of line_items) {
      if (!li.id || !VALID.includes(li.mapped_category)) continue;
      await supa.from('pnl_line_items')
        .update({ mapped_category: li.mapped_category, is_confirmed: true })
        .eq('id', li.id).eq('import_id', import_id);
    }

    // Read back final rows and roll up totals
    const { data: rows } = await supa.from('pnl_line_items')
      .select('mapped_category, raw_amount')
      .eq('import_id', import_id);

    const totals: Record<string, number> = {
      revenue: 0, food_cost: 0, beverage_cost: 0, labor: 0,
      rent: 0, utilities: 0, marketing: 0, other_opex: 0,
    };
    for (const r of rows ?? []) {
      if (r.mapped_category && r.mapped_category !== 'ignore' && totals[r.mapped_category] !== undefined) {
        totals[r.mapped_category] += Number(r.raw_amount) || 0;
      }
    }

    // Upsert summary (unique on tenant + period)
    const { error: sErr } = await supa.from('pnl_period_summary').upsert({
      tenant_id: imp.tenant_id,
      import_id,
      period_start, period_end,
      ...totals,
    }, { onConflict: 'tenant_id,period_start,period_end' });
    if (sErr) return j({ error: `summary upsert: ${sErr.message}` }, 500);

    // Data minimization: null raw_text and clear storage_path pointer
    await supa.from('pnl_imports').update({
      status: 'confirmed',
      period_start, period_end,
      confirmed_at: new Date().toISOString(),
      raw_text: null,
      storage_path: null,
    }).eq('id', import_id);

    // Best-effort: delete the uploaded file from storage. Non-fatal if it fails.
    if (imp.storage_path) {
      try {
        await supa.storage.from('pnl-uploads').remove([imp.storage_path]);
      } catch (_) { /* ignore */ }
    }

    return j({ import_id, totals });
  } catch (e) {
    return j({ error: String(e?.message ?? e) }, 500);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
