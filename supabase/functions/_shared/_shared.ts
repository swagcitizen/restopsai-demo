// Shared helpers for stripe-* edge functions.
// Drop a copy of this file into each function's directory at deploy time
// (Supabase functions are deployed individually; the deploy script handles this).

import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const STRIPE_SECRET   = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
export const STRIPE_WH_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
export const PRICE_MONTHLY   = Deno.env.get("STRIPE_PRICE_MONTHLY") ?? "";
export const PRICE_ANNUAL    = Deno.env.get("STRIPE_PRICE_ANNUAL")  ?? "";
export const APP_BASE        = Deno.env.get("APP_BASE_URL") ?? "https://stationly.ai";
export const SUPABASE_URL    = Deno.env.get("SUPABASE_URL") ?? "";
export const SERVICE_ROLE    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
export const SUPABASE_ANON   = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

export const DEMO_TENANT_ID = "a2e00ee7-1f30-4fbd-86b9-e560fc062f72";

export const stripe = new Stripe(STRIPE_SECRET, {
  apiVersion: "2024-12-18.acacia",
  httpClient: Stripe.createFetchHttpClient(),
});

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export function err(message: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status);
}

// Service-role client (bypasses RLS) — for writing subscriptions / reading memberships
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// User-scoped client — used to verify caller identity from JWT
export function userClient(authHeader: string | null): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: authHeader ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Verify the caller is an owner/manager of the given tenant.
// Returns the user record if ok, throws Response on failure.
export async function requireOwnerOrManager(
  authHeader: string | null,
  tenantId: string,
): Promise<{ id: string; email: string }> {
  if (!authHeader) throw err("missing authorization", 401);
  const u = userClient(authHeader);
  const { data: ures, error: uerr } = await u.auth.getUser();
  if (uerr || !ures?.user) throw err("invalid token", 401);

  const svc = serviceClient();
  const { data: m } = await svc
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", ures.user.id)
    .maybeSingle();

  if (!m || (m.role !== "owner" && m.role !== "manager")) {
    throw err("forbidden", 403);
  }
  return { id: ures.user.id, email: ures.user.email ?? "" };
}

// Convert a Stripe subscription object → our subscriptions row shape.
export function mapSubscription(sub: Stripe.Subscription, tenantId: string) {
  const item = sub.items.data[0];
  const price = item?.price;
  const interval = (price?.recurring?.interval ?? "month") as "month" | "year";
  return {
    tenant_id: tenantId,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripe_subscription_id: sub.id,
    status: sub.status,
    plan: "allin",
    billing_interval: interval,
    quantity: item?.quantity ?? 1,
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    cancel_at_period_end: sub.cancel_at_period_end,
    trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    past_due_since: sub.status === "past_due" ? new Date().toISOString() : null,
    current_price_id: price?.id ?? null,
  };
}
