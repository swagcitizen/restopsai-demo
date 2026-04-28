// supabase/functions/stripe-portal/index.ts
// Creates a Stripe Customer Portal session for the caller's tenant.
//
// Body: { tenant_id }
// Auth: caller JWT must be owner/manager.

import {
  stripe, cors, json, err, serviceClient, requireOwnerOrManager, APP_BASE,
} from "../_shared/_shared.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")    return err("method not allowed", 405);

  let body: { tenant_id?: string };
  try { body = await req.json(); } catch { return err("invalid json"); }

  const tenantId = body.tenant_id;
  if (!tenantId) return err("tenant_id required");

  try { await requireOwnerOrManager(req.headers.get("authorization"), tenantId); }
  catch (e) { return e instanceof Response ? e : err("auth failed", 401); }

  const svc = serviceClient();
  const { data: sub } = await svc
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!sub?.stripe_customer_id) {
    return err("no customer on file; start a subscription first", 404);
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${APP_BASE}/app.html#billing`,
  });

  return json({ url: session.url });
});
