// pin-login — verifies a 4-digit PIN, returns a magic-link OTP the client uses
// to call supabase.auth.verifyOtp on the staff member's email.
//
// Request: POST { email: string, pin: string }
// Response:
//   200 { otp: string, email: string }   ← client calls verifyOtp({type:'email', token, email})
//   401 { error: "invalid pin", attempts_left }
//   423 { error: "locked", retry_at }
//
// Lockout policy: 5 wrong attempts → 15 min lock per employee_pins row.
//
// IMPORTANT: this function uses the service role so it can read pin_hash and
// generate an OTP. Never expose pin_hash through any other channel.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import bcrypt from "https://esm.sh/bcryptjs@2.4.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let payload: { email?: string; pin?: string };
  try { payload = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const email = (payload.email ?? "").trim().toLowerCase();
  const pin = (payload.pin ?? "").trim();
  if (!email || !/^\d{4,6}$/.test(pin)) return json({ error: "missing email or pin" }, 400);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Find staff by email
  const { data: staff, error: sErr } = await svc
    .from("staff")
    .select("id, tenant_id, email, name, user_id")
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();
  if (sErr) return json({ error: "lookup failed" }, 500);
  if (!staff || !staff.user_id) return json({ error: "invalid pin" }, 401);

  // 2. Load PIN row
  const { data: pinRow } = await svc
    .from("employee_pins")
    .select("id, pin_hash, failed_attempts, locked_until")
    .eq("staff_id", staff.id)
    .maybeSingle();
  if (!pinRow) return json({ error: "pin not set" }, 401);

  // 3. Check lockout
  if (pinRow.locked_until && new Date(pinRow.locked_until) > new Date()) {
    return json({ error: "locked", retry_at: pinRow.locked_until }, 423);
  }

  // 4. Verify
  const ok = await bcrypt.compare(pin, pinRow.pin_hash);
  if (!ok) {
    const attempts = (pinRow.failed_attempts ?? 0) + 1;
    const lockUntil = attempts >= MAX_ATTEMPTS
      ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString()
      : null;
    await svc.from("employee_pins").update({
      failed_attempts: attempts,
      locked_until: lockUntil,
      updated_at: new Date().toISOString(),
    }).eq("id", pinRow.id);
    return json({
      error: "invalid pin",
      attempts_left: Math.max(0, MAX_ATTEMPTS - attempts),
      locked: !!lockUntil,
    }, 401);
  }

  // 5. Reset attempts
  await svc.from("employee_pins").update({
    failed_attempts: 0,
    locked_until: null,
    updated_at: new Date().toISOString(),
  }).eq("id", pinRow.id);

  // 6. Generate a magic-link OTP — client will call verifyOtp
  const { data: link, error: linkErr } = await svc.auth.admin.generateLink({
    type: "magiclink",
    email: staff.email!,
  });
  if (linkErr || !link?.properties?.email_otp) {
    return json({ error: "could not issue otp" }, 500);
  }

  return json({
    otp: link.properties.email_otp,
    email: staff.email,
    staff_name: staff.name,
  });
});
