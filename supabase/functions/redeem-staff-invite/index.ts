// redeem-staff-invite — invite-link redemption for the Staff PWA.
//
// Flow:
//   1. Staff opens https://stationly.ai/staff/accept.html?token=XYZ
//   2. accept.html POSTs { token, name? } here
//   3. We verify the invite (exists, role='staff', not accepted, not expired)
//   4. If the auth.users row for the invite's email does not exist yet,
//      we create it (email_confirm=true, no password, full_name set).
//   5. We issue a one-time magic-link OTP for that email and return it.
//   6. Client calls supabase.auth.verifyOtp with the OTP, gets a session,
//      then calls public.accept_invite(token) to link tenant + staff row,
//      then routes to forced PIN setup.
//
// This means: staff NEVER set a password. They sign in via the invite
// link once, set a PIN, and the PIN is their only credential thereafter.
// If they ever lose access, the manager re-issues an invite.
//
// Request:  POST { token: string, name?: string }
// Response: 200 { otp, email, name, tenant_id }
//           400 bad input
//           404 invite_not_found / used / expired
//           500 server error

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
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let payload: { token?: string; name?: string };
  try { payload = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const token = (payload.token ?? "").trim();
  const name = (payload.name ?? "").trim();
  if (!token || token.length < 16) return json({ error: "missing_token" }, 400);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Look up the invite (service role bypasses RLS).
  const { data: inv, error: invErr } = await svc
    .from("invites")
    .select("id, tenant_id, email, role, expires_at, accepted_at")
    .eq("token", token)
    .maybeSingle();

  if (invErr) return json({ error: "lookup_failed", detail: invErr.message }, 500);
  if (!inv) return json({ error: "invite_not_found" }, 404);
  if (inv.accepted_at) return json({ error: "invite_already_used" }, 404);
  if (new Date(inv.expires_at).getTime() < Date.now()) {
    return json({ error: "invite_expired" }, 404);
  }
  if (inv.role !== "staff") {
    return json({ error: "invite_not_for_staff" }, 400);
  }

  const email = (inv.email ?? "").trim().toLowerCase();
  if (!email) return json({ error: "invite_missing_email" }, 500);

  // 2. Look up the auth user. Pagination-safe: filter by email.
  //    admin.listUsers supports a query that filters server-side.
  let userId: string | null = null;
  try {
    const { data: list } = await svc.auth.admin.listUsers({
      page: 1, perPage: 100,
    });
    const match = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email);
    if (match) userId = match.id;
  } catch (e) {
    // fall through to create attempt
  }

  // 3. Create auth user if missing — no password, email pre-confirmed.
  if (!userId) {
    const finalName =
      name ||
      // Derive a friendly default from the local-part: "wilson.smith" -> "Wilson Smith"
      email.split("@")[0]
        .replace(/[._-]+/g, " ")
        .split(" ")
        .filter(Boolean)
        .map((s) => s[0].toUpperCase() + s.slice(1).toLowerCase())
        .join(" ") || "New Employee";

    const { data: created, error: createErr } = await svc.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: finalName },
    });
    if (createErr || !created?.user) {
      return json({ error: "user_create_failed", detail: createErr?.message }, 500);
    }
    userId = created.user.id;
  } else if (name) {
    // Existing user — update their full_name if the redemption supplied one
    // and the existing metadata is empty. Helps staff who skipped name on
    // a prior attempt.
    try {
      const { data: u } = await svc.auth.admin.getUserById(userId);
      const existing = (u?.user?.user_metadata?.full_name ?? "").toString().trim();
      if (!existing) {
        await svc.auth.admin.updateUserById(userId, {
          user_metadata: { ...(u?.user?.user_metadata ?? {}), full_name: name },
        });
      }
    } catch { /* non-fatal */ }
  }

  // 4. Issue a one-time magic-link OTP. Client will call verifyOtp with it
  //    and that creates a real session — no password ever needed.
  const { data: link, error: linkErr } = await svc.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !link?.properties?.email_otp) {
    return json({ error: "otp_generate_failed", detail: linkErr?.message }, 500);
  }

  return json({
    otp: link.properties.email_otp,
    email,
    tenant_id: inv.tenant_id,
    name: name || null,
  });
});
