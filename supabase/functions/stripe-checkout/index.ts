// supabase/functions/stripe-checkout/index.ts
// Creates a Stripe Checkout Session and returns the URL for redirect.
//
// Body: { tenant_id, interval: "month"|"year", quantity?: number, with_trial?: boolean }
// Auth: caller JWT must be owner or manager of the tenant.

import {
  stripe, cors, json, err, serviceClient, requireOwnerOrManager,
  PRICE_MONTHLY, PRICE_ANNUAL, APP_BASE, DEMO_TENANT_ID,
} from "../_shared/_shared.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")    return err("method not allowed", 405);

  let body: { tenant_id?: string; interval?: "month" | "year"; quantity?: number; with_trial?: boolean };
  try { body = await req.json(); } catch { return err("invalid json"); }

  const tenantId = body.tenant_id;
  const interval = body.interval ?? "month";
  const quantity = Math.max(1, Math.min(50, Number(body.quantity ?? 1)));
  const withTrial = body.with_trial !== false; // default true on first checkout

  if (!tenantId) return err("tenant_id required");
  if (tenantId === DEMO_TENANT_ID) return err("demo tenant cannot subscribe", 400);

  let user;
  try { user = await requireOwnerOrManager(req.headers.get("authorization"), tenantId); }
  catch (e) { return e instanceof Response ? e : err("auth failed", 401); }

  const priceId = interval === "year" ? PRICE_ANNUAL : PRICE_MONTHLY;
  if (!priceId) return err("price not configured", 500);

  const svc = serviceClient();

  // Reuse stripe_customer_id if we already created one for this tenant
  const { data: existing } = await svc
    .from("subscriptions")
    .select("stripe_customer_id, stripe_subscription_id, status")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existing?.stripe_subscription_id && ["active", "trialing"].includes(existing.status ?? "")) {
    return err("already subscribed; use customer portal to change plan", 409);
  }

  // Get tenant name for nicer customer label
  const { data: tenant } = await svc
    .from("tenants").select("name").eq("id", tenantId).maybeSingle();

  let customerId = existing?.stripe_customer_id ?? undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name:  tenant?.name ?? undefined,
      metadata: { tenant_id: tenantId, supabase_user_id: user.id },
    });
    customerId = customer.id;
    await svc.from("subscriptions")
      .upsert({ tenant_id: tenantId, stripe_customer_id: customerId }, { onConflict: "tenant_id" });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: tenantId,
    line_items: [{ price: priceId, quantity }],
    success_url: `${APP_BASE}/app.html#billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${APP_BASE}/app.html#billing?status=cancelled`,
    allow_promotion_codes: true,
    automatic_tax: { enabled: false }, // flip on after Stripe Tax is configured
    subscription_data: {
      metadata: { tenant_id: tenantId },
      ...(withTrial ? {
        trial_period_days: 14,
        trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
      } : {}),
    },
    payment_method_collection: withTrial ? "if_required" : "always",
    metadata: { tenant_id: tenantId, supabase_user_id: user.id },
  });

  return json({ url: session.url, session_id: session.id });
});
