import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req) => {
  // Stub — will be filled in once Document AI credentials are configured.
  // For now, marks the receipt as 'skipped' so the UI doesn't hang.
  const { receipt_id } = await req.json().catch(() => ({}));
  if (!receipt_id) return new Response(JSON.stringify({ error: 'missing receipt_id' }), { status: 400 });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  await fetch(`${SUPABASE_URL}/rest/v1/receipts?id=eq.${receipt_id}`, {
    method: 'PATCH',
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ocr_status: 'skipped', ocr_error: 'OCR not yet configured — pending Document AI setup' }),
  });

  return new Response(JSON.stringify({ ok: true, status: 'skipped' }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
