// pos-oauth-callback — exchanges authorization code for access/refresh tokens.
//
// GET /pos-oauth-callback?code=...&state=...
//
// Verifies signed state JWT, exchanges code via provider's token endpoint,
// stores tokens in Vault, upserts pos_connections row, redirects user back
// to /app.html#view=settings with success/error flag.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verify as verifyJwt } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://stationly.ai";
const STATE_SECRET = Deno.env.get("POS_STATE_SECRET") || "stationly-pos-state-fallback-change-me";

const TOAST_CLIENT_ID = Deno.env.get("TOAST_CLIENT_ID");
const TOAST_CLIENT_SECRET = Deno.env.get("TOAST_CLIENT_SECRET");
const TOAST_TOKEN_URL = "https://ws-api.toasttab.com/authentication/v1/authentication/login";

const SQUARE_APP_ID = Deno.env.get("SQUARE_APP_ID");
const SQUARE_APP_SECRET = Deno.env.get("SQUARE_APP_SECRET");
const SQUARE_TOKEN_URL = "https://connect.squareup.com/oauth2/token";

const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/pos-oauth-callback`;

function redirectBack(ok: boolean, provider?: string, error?: string): Response {
  const params = new URLSearchParams();
  if (ok) params.set("pos_connected", provider || "");
  else { params.set("pos_error", error || "unknown"); if (provider) params.set("provider", provider); }
  return new Response(null, {
    status: 302,
    headers: { Location: `${APP_BASE_URL}/app.html?${params.toString()}#view=alerts` },
  });
}

async function verifyState(state: string): Promise<any | null> {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(STATE_SECRET),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
    );
    return await verifyJwt(state, key);
  } catch { return null; }
}

async function exchangeToast(code: string): Promise<any> {
  // Toast uses a non-standard auth flow: client_credentials grant with userAccessType
  // For the partner flow (what restaurants use), we POST to authentication/login
  const resp = await fetch(TOAST_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Toast-Restaurant-External-ID": code },
    body: JSON.stringify({
      clientId: TOAST_CLIENT_ID,
      clientSecret: TOAST_CLIENT_SECRET,
      userAccessType: "TOAST_MACHINE_CLIENT",
    }),
  });
  return await resp.json();
}

async function exchangeSquare(code: string): Promise<any> {
  const resp = await fetch(SQUARE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Square-Version": "2024-11-20" },
    body: JSON.stringify({
      client_id: SQUARE_APP_ID,
      client_secret: SQUARE_APP_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  return await resp.json();
}

async function storeSecret(sb: any, name: string, value: string): Promise<string | null> {
  // Use vault.create_secret to store and return the UUID
  const { data, error } = await sb.rpc("create_pos_secret", { p_name: name, p_secret: value });
  if (error) { console.error("vault store failed:", error); return null; }
  return data;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");

  if (errParam) return redirectBack(false, undefined, errParam);
  if (!code || !stateRaw) return redirectBack(false, undefined, "missing_code_or_state");

  const state = await verifyState(stateRaw);
  if (!state) return redirectBack(false, undefined, "invalid_state");

  const { tenant_id, provider } = state;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  let tokenResp: any;
  let accessToken: string;
  let refreshToken: string | null = null;
  let expiresIn = 0;
  let externalAccountId = "";
  let accountLabel = "";

  try {
    if (provider === "toast") {
      tokenResp = await exchangeToast(code);
      if (!tokenResp.token?.accessToken) throw new Error(tokenResp.message || "Toast token exchange failed");
      accessToken = tokenResp.token.accessToken;
      refreshToken = tokenResp.token.refreshToken || null;
      expiresIn = tokenResp.token.expiresIn || 3600;
      externalAccountId = code; // Toast restaurant GUID
      accountLabel = tokenResp.token.scope || "Toast restaurant";
    } else if (provider === "square") {
      tokenResp = await exchangeSquare(code);
      if (!tokenResp.access_token) throw new Error(tokenResp.message || tokenResp.error_description || "Square token exchange failed");
      accessToken = tokenResp.access_token;
      refreshToken = tokenResp.refresh_token || null;
      expiresIn = tokenResp.expires_at ? Math.max(0, Math.floor((new Date(tokenResp.expires_at).getTime() - Date.now()) / 1000)) : 30 * 24 * 3600;
      externalAccountId = tokenResp.merchant_id;
      accountLabel = `Square · ${tokenResp.merchant_id?.slice(0, 8) || ''}`;
    } else {
      return redirectBack(false, provider, "unknown_provider");
    }
  } catch (e) {
    console.error("Token exchange failed:", e);
    return redirectBack(false, provider, "token_exchange_failed");
  }

  const accessSecretId = await storeSecret(sb, `pos_${provider}_access_${tenant_id}`, accessToken);
  const refreshSecretId = refreshToken ? await storeSecret(sb, `pos_${provider}_refresh_${tenant_id}`, refreshToken) : null;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  const { error: upsertErr } = await sb.from("pos_connections").upsert({
    tenant_id,
    provider,
    external_account_id: externalAccountId,
    account_label: accountLabel,
    status: "active",
    access_token_secret_id: accessSecretId,
    refresh_token_secret_id: refreshSecretId,
    access_token_expires_at: expiresAt,
    metadata: { connected_via: "oauth", scopes: tokenResp.scope || tokenResp.scopes || null },
  }, { onConflict: "tenant_id,provider,external_account_id" });

  if (upsertErr) {
    console.error("upsert failed:", upsertErr);
    return redirectBack(false, provider, "db_upsert_failed");
  }

  return redirectBack(true, provider);
});
