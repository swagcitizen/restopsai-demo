// supabase/functions/stripe-update-quantity/index.ts
// Update the location count on the active subscription. Stripe prorates automatically.
//
// Body: { tenant_id, quantity }
// Auth: caller must be owner/manager.

import {
  stripe, cors, json, err, serviceClient, requireOwnerOrManager,
} from "../_shared/_shared.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")    return err("method not allowed", 405);

  let body: { tenant_id?: string; quantity?: number };
  try { body = await req.json(); } catch { return err("invalid json"); }

  const tenantId = body.tenant_id;
  const quantity = Math.max(1, Math.min(50, Number(body.quantity ?? 1)));
  if (!tenantId) return err("tenant_id required");

  try { await requireOwnerOrManager(req.headers.get("authorization"), tenantId); }
  catch (e) { return e instanceof Response ? e : err("auth failed", 401); }

  const svc = serviceClient();
  const { data: sub } = await svc
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!sub?.stripe_subscription_id) {
    return err("no active subscription", 404);
  }

  const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
  const itemId = stripeSub.items.data[0]?.id;
  if (!itemId) return err("no subscription item", 500);

  const updated = await stripe.subscriptions.update(sub.stripe_subscription_id, {
    items: [{ id: itemId, quantity }],
    proration_behavior: "create_prorations",
  });

  // Webhook will sync the row, but write back optimistically too.
  await svc.from("subscriptions").update({ quantity }).eq("tenant_id", tenantId);

  return json({ ok: true, quantity, current_period_end: updated.current_period_end });
});
