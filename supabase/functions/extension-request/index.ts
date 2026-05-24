// extension-request — staff member requests +N minutes on their active shift.
// Creates a shift_extensions row (pending) and dispatches an alert to managers
// of the tenant via the existing alerts-dispatch path.
//
// Request: POST { time_entry_id: string, requested_minutes: int, reason?: string }
// Response: 200 { extension: shift_extensions_row }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON         = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = req.headers.get("authorization");
  if (!auth) return json({ error: "missing auth" }, 401);

  let body: { time_entry_id?: string; requested_minutes?: number; reason?: string };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const mins = Number(body.requested_minutes);
  if (!body.time_entry_id || !Number.isFinite(mins) || mins < 5 || mins > 240) {
    return json({ error: "invalid request" }, 400);
  }

  // 1. Identify caller
  const u = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: uRes } = await u.auth.getUser();
  if (!uRes?.user) return json({ error: "invalid token" }, 401);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 2. Find staff row for this user
  const { data: staff } = await svc
    .from("staff")
    .select("id, tenant_id, name")
    .eq("user_id", uRes.user.id)
    .maybeSingle();
  if (!staff) return json({ error: "not enrolled as staff" }, 403);

  // 3. Verify time entry belongs to this staff
  const { data: entry } = await svc
    .from("time_entries")
    .select("id, staff_id, tenant_id, clock_out_at")
    .eq("id", body.time_entry_id)
    .maybeSingle();
  if (!entry || entry.staff_id !== staff.id) return json({ error: "shift not found" }, 404);
  if (entry.clock_out_at) return json({ error: "shift already closed" }, 409);

  // 4. Create the extension row
  const { data: ext, error: extErr } = await svc
    .from("shift_extensions")
    .insert({
      tenant_id: staff.tenant_id,
      time_entry_id: entry.id,
      staff_id: staff.id,
      requested_minutes: mins,
      reason: body.reason ?? null,
      status: "pending",
    })
    .select()
    .single();
  if (extErr) return json({ error: "could not create extension", detail: extErr.message }, 500);

  // 5. Best-effort: dispatch alert to managers (don't fail the request if this misfires)
  try {
    await svc.from("alerts").insert({
      tenant_id: staff.tenant_id,
      kind: "shift_extension_request",
      severity: "info",
      title: `${staff.name} requested +${mins} min`,
      body: body.reason ?? null,
      payload: { extension_id: ext.id, time_entry_id: entry.id, staff_id: staff.id, minutes: mins },
    });
  } catch { /* alerts table optional */ }

  return json({ extension: ext });
});
