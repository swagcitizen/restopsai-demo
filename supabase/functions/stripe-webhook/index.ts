// supabase/functions/stripe-webhook/index.ts
// Receives Stripe webhook events. Signature-verified. Idempotent via billing_events.stripe_event_id unique.
//
// Configure on Stripe side: dashboard.stripe.com/test/webhooks
//   URL:    https://<project-ref>.supabase.co/functions/v1/stripe-webhook
//   Events: checkout.session.completed, customer.subscription.created,
//           customer.subscription.updated, customer.subscription.deleted,
//           invoice.paid, invoice.payment_failed
//
// IMPORTANT: This function must be deployed with --no-verify-jwt because Stripe
// does NOT send a Supabase JWT — we authenticate via the Stripe signature instead.

import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import {
  stripe, cors, json, err, serviceClient, mapSubscription, STRIPE_WH_SECRET,
} from "../_shared/_shared.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")    return err("method not allowed", 405);

  const sig = req.headers.get("stripe-signature");
  if (!sig) return err("missing stripe-signature", 400);
  if (!STRIPE_WH_SECRET) return err("webhook secret not configured", 500);

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, STRIPE_WH_SECRET);
  } catch (e) {
    return err(`signature verification failed: ${(e as Error).message}`, 400);
  }

  const svc = serviceClient();

  // Resolve tenant_id from the event payload (Checkout sets client_reference_id;
  // subscription events carry metadata.tenant_id; invoices we look up via customer)
  let tenantId: string | null = null;
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      tenantId = (s.client_reference_id ?? s.metadata?.tenant_id) as string ?? null;
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const s = event.data.object as Stripe.Subscription;
      tenantId = (s.metadata?.tenant_id as string) ?? null;
      if (!tenantId) {
        // fallback: look up customer in our table
        const cust = typeof s.customer === "string" ? s.customer : s.customer.id;
        const { data } = await svc.from("subscriptions").select("tenant_id").eq("stripe_customer_id", cust).maybeSingle();
        tenantId = data?.tenant_id ?? null;
      }
      break;
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      const cust = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
      if (cust) {
        const { data } = await svc.from("subscriptions").select("tenant_id").eq("stripe_customer_id", cust).maybeSingle();
        tenantId = data?.tenant_id ?? null;
      }
      break;
    }
  }

  // Idempotency: insert event log first. If duplicate stripe_event_id, ack and bail.
  const { error: dupErr } = await svc.from("billing_events").insert({
    tenant_id: tenantId,
    stripe_event_id: event.id,
    type: event.type,
    livemode: event.livemode,
    payload: event.data.object as unknown as Record<string, unknown>,
  });
  if (dupErr) {
    if (String(dupErr.message).includes("duplicate")) {
      return json({ ok: true, deduped: true });
    }
    return err(`log insert failed: ${dupErr.message}`, 500);
  }

  // Apply state changes
  try {
    if (!tenantId) {
      console.warn(`[webhook] no tenant resolved for event ${event.id} (${event.type})`);
      return json({ ok: true, no_tenant: true });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.subscription) {
          const subId = typeof s.subscription === "string" ? s.subscription : s.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          await svc.from("subscriptions").upsert(mapSubscription(sub, tenantId), { onConflict: "tenant_id" });
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        await svc.from("subscriptions").upsert(mapSubscription(sub, tenantId), { onConflict: "tenant_id" });
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await svc.from("subscriptions").update({
          status: "canceled",
          cancel_at_period_end: false,
          stripe_subscription_id: sub.id,
        }).eq("tenant_id", tenantId);
        break;
      }
      case "invoice.paid": {
        // Mark active and clear past_due_since.
        await svc.from("subscriptions").update({
          status: "active", past_due_since: null,
        }).eq("tenant_id", tenantId);
        break;
      }
      case "invoice.payment_failed": {
        await svc.from("subscriptions").update({
          status: "past_due", past_due_since: new Date().toISOString(),
        }).eq("tenant_id", tenantId);
        break;
      }
    }
  } catch (e) {
    console.error("[webhook] handler error", e);
    return err(`handler failed: ${(e as Error).message}`, 500);
  }

  // Mark processed
  await svc.from("billing_events").update({ processed_at: new Date().toISOString() })
    .eq("stripe_event_id", event.id);

  return json({ ok: true });
});
