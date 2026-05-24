// pin-login — verifies a 4-digit PIN via the server-side verify_pin_by_email
// RPC (which uses pgcrypto crypt() for bcrypt verification), then issues a
// magic-link OTP the client uses to call supabase.auth.verifyOtp.
//
// Request: POST { email: string, pin: string }
// Response:
//   200 { otp: string, email: string, staff_name: string }
//   401 { error: "invalid pin", attempts_left? }
//   423 { error: "locked", retry_at }
//
// All PIN verification, lockout state, and attempt counters are owned by
// the database (verify_pin_by_email RPC). This function only orchestrates
// the OTP handoff after a successful verify.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let payload: { email?: string; pin?: string };
  try { payload = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const email = (payload.email ?? "").trim().toLowerCase();
  const pin = (payload.pin ?? "").trim();
  if (!email || !/^\d{4,8}$/.test(pin)) return json({ error: "missing email or pin" }, 400);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Single-RPC verification: handles lookup, lockout, bcrypt compare, and
  // failure counter updates atomically server-side.
  const { data, error } = await svc.rpc("verify_pin_by_email", { _email: email, _pin: pin });
  if (error) return json({ error: "lookup failed", detail: error.message }, 500);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return json({ error: "invalid pin" }, 401);

  if (!row.ok) {
    if (row.reason === "locked") return json({ error: "locked" }, 423);
    if (row.reason === "no_pin_set") return json({ error: "pin not set" }, 401);
    // user_not_found / not_enrolled / invalid_pin all collapse to "invalid pin"
    // so we don't leak which staff emails are valid.
    return json({ error: "invalid pin" }, 401);
  }

  // Generate a one-time magic-link OTP — client calls verifyOtp with this.
  const { data: link, error: linkErr } = await svc.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !link?.properties?.email_otp) {
    return json({ error: "could not issue otp", detail: linkErr?.message }, 500);
  }

  return json({
    otp: link.properties.email_otp,
    email,
    staff_name: row.staff_name,
  });
});
