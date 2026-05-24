// request-password-reset — sends a password recovery email to the given
// address. Wraps supabase.auth.admin.generateLink + the configured SMTP.
//
// Request:  POST { email: string, redirect_to?: string }
// Response: 200 { ok: true }
//           400 { error: "missing email" }
//           500 { error: "send failed", detail }
//
// Public (verify_jwt=false) so the staff "Forgot password?" link works
// before the user is signed in. To prevent enumeration, we always return
// 200 OK even if the email doesn't exist — the email itself simply won't
// be sent. We rate-limit by IP via Supabase's built-in function limiter.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DEFAULT_REDIRECT = "https://stationly.ai/staff/reset.html";

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

  let payload: { email?: string; redirect_to?: string };
  try { payload = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const email = (payload.email ?? "").trim().toLowerCase();
  const redirectTo = (payload.redirect_to ?? DEFAULT_REDIRECT).trim();
  if (!email) return json({ error: "missing email" }, 400);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Trigger the standard recovery email via the auth admin API. This both
  // generates the recovery link AND sends it through Supabase's configured
  // SMTP/email provider — no extra send step needed.
  const { error } = await svc.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) {
    // Don't expose internal errors to the public, but log them server-side.
    console.error("resetPasswordForEmail failed", error);
    return json({ ok: true }, 200); // Always 200 to prevent enumeration
  }

  return json({ ok: true });
});
