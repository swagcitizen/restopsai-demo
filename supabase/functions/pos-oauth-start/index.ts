// pos-oauth-start — generates the OAuth authorize URL for Toast or Square.
//
// GET /pos-oauth-start?provider=toast&tenant_id=<uuid>
// Returns: { authorize_url: string }
//
// State is signed with SUPABASE_JWT_SECRET so callback can trust it.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { create as createJwt, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://stationly.ai";
const STATE_SECRET = Deno.env.get("POS_STATE_SECRET") || "stationly-pos-state-fallback-change-me";

const TOAST_CLIENT_ID = Deno.env.get("TOAST_CLIENT_ID");
const TOAST_AUTH_URL = "https://ws-api.toasttab.com/authentication/v1/authentication/login";

const SQUARE_APP_ID = Deno.env.get("SQUARE_APP_ID");
const SQUARE_AUTH_URL_BASE = "https://connect.squareup.com/oauth2/authorize";

const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/pos-oauth-callback`;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function signState(payload: Record<string, unknown>): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(STATE_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return await createJwt({ alg: "HS256", typ: "JWT" }, { ...payload, exp: getNumericDate(60 * 10) }, key);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url = new URL(req.url);
  const provider = url.searchParams.get("provider");
  const tenantId = url.searchParams.get("tenant_id");
  if (!provider || !tenantId) return json(400, { ok: false, error: "provider and tenant_id required" });

  // Verify caller is owner/manager of tenant
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json(401, { ok: false, error: "Missing auth" });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json(401, { ok: false, error: "Invalid token" });

  const sbAdmin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: m } = await sbAdmin.from("memberships").select("role").eq("tenant_id", tenantId).eq("user_id", user.id).maybeSingle();
  if (!m || !["owner", "manager"].includes(m.role)) return json(403, { ok: false, error: "Forbidden" });

  const state = await signState({ tenant_id: tenantId, provider, user_id: user.id });
  let authorizeUrl: string;

  if (provider === "toast") {
    if (!TOAST_CLIENT_ID) return json(503, { ok: false, error: "Toast not configured (TOAST_CLIENT_ID missing)" });
    const params = new URLSearchParams({
      client_id: TOAST_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "orders:read menus:read labor:read restaurants:read",
      state,
    });
    authorizeUrl = `${TOAST_AUTH_URL}?${params.toString()}`;
  } else if (provider === "square") {
    if (!SQUARE_APP_ID) return json(503, { ok: false, error: "Square not configured (SQUARE_APP_ID missing)" });
    const params = new URLSearchParams({
      client_id: SQUARE_APP_ID,
      scope: "ORDERS_READ MERCHANT_PROFILE_READ EMPLOYEES_READ TIMECARDS_READ ITEMS_READ",
      session: "false",
      state,
    });
    authorizeUrl = `${SQUARE_AUTH_URL_BASE}?${params.toString()}`;
  } else {
    return json(400, { ok: false, error: `Unsupported provider: ${provider}` });
  }

  return json(200, { ok: true, authorize_url: authorizeUrl, redirect_uri: REDIRECT_URI });
});
