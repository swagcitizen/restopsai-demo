// pnl-upload-url: returns a signed upload URL + pending import row.
// Body: { tenant_id: uuid, filename: string, file_type: 'pdf'|'csv'|'xlsx', uploaded_by?: uuid }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS });

  try {
    const { tenant_id, filename, file_type, uploaded_by } = await req.json();
    if (!tenant_id || !filename || !file_type) {
      return json({ error: 'tenant_id, filename, file_type required' }, 400);
    }
    if (!['pdf','csv','xlsx'].includes(file_type)) {
      return json({ error: 'file_type must be pdf|csv|xlsx' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Validate tenant exists
    const { data: tenant, error: tErr } = await supabase
      .from('tenants').select('id').eq('id', tenant_id).single();
    if (tErr || !tenant) return json({ error: 'invalid tenant' }, 404);

    const id = crypto.randomUUID();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    const storage_path = `${tenant_id}/${id}-${safeName}`;

    const { data: signed, error: sErr } = await supabase.storage
      .from('pnl-uploads')
      .createSignedUploadUrl(storage_path);
    if (sErr) return json({ error: sErr.message }, 500);

    const { error: iErr } = await supabase.from('pnl_imports').insert({
      id, tenant_id, filename: safeName, file_type, storage_path,
      status: 'uploaded', uploaded_by: uploaded_by ?? null,
    });
    if (iErr) return json({ error: iErr.message }, 500);

    return json({ import_id: id, upload: signed, storage_path });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
