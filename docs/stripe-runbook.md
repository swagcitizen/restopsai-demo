# Stripe Unlock Runbook — Stationly

When Stripe support restores access to the sandbox account, follow these steps in order. The full integration is already built and deployed — you only need to paste credentials and turn on the webhook.

**Estimated time to "live billing":** ~10 minutes.

---

## What's already done (no action needed)

- ✅ Database migration applied (`subscriptions`, `billing_events`, RLS, RPC, view, auto-trigger)
- ✅ All 4 edge functions deployed and ACTIVE on Supabase:
  - `stripe-checkout`
  - `stripe-portal`
  - `stripe-webhook` (signature-verified, no JWT)
  - `stripe-update-quantity`
- ✅ Frontend Billing tab live in the app (status card, plan picker, events log, read-only mode, past-due banner)
- ✅ Trial auto-starts in DB the moment a tenant signs up — no Stripe call needed
- ✅ Demo tenant (`a2e00ee7-1f30-4fbd-86b9-e560fc062f72`) pinned to `active` until 2099, immune to billing

---

## Stripe IDs for reference (test mode)

| Item | Value |
|---|---|
| Sandbox name | Stationly sandbox |
| Product | `prod_UPjSH7ulRatCkk` (Stationly · all-in) |
| Monthly price ($89) | `price_1TQtzeKEZmx2FnWM4tM864Gu` |
| Annual price ($852) | `price_1TQuJIKEZmx2FnWMO8eXbO39` |
| Publishable key | `pk_test_51TQtTRKEZmx2FnWM76rAzEbjMJ2OsqZ5Msf60n9ZwpKm4F3ZuDikRZdoySgi131BRaMn9nHGwGEQSdTo425F2NbG00piLRfvjH` |
| Secret key | **Get from Stripe → Developers → API keys** |
| Webhook secret | **Generated in Step 3 below** |
| Webhook endpoint | `https://vmnhizmibdtlizigbzks.supabase.co/functions/v1/stripe-webhook` |

---

## Step 1 — Grab the secret key

1. Sign back into Stripe → switch to the **Stationly sandbox**.
2. Top-right → **Developers → API keys**.
3. Click **Reveal test key** next to "Secret key" → copy the value (starts with `sk_test_`).

---

## Step 2 — Configure the Customer Portal

The portal lets customers update payment method, switch plans, and cancel without leaving Stripe.

1. Go to **Settings → Billing → Customer portal** (sandbox).
2. **Functionality** section — turn ON:
   - ✅ Customers can update their payment methods
   - ✅ Customers can update their billing address
   - ✅ Customers can view their invoice history
   - ✅ Customers can cancel subscriptions
     - Cancellation mode: **At end of billing period** (recommended)
     - Cancellation reason: optional, your choice
   - ✅ Customers can switch plans
     - Add both products: **Stationly · all-in** with the **monthly** and **annual** prices
     - Proration behavior: **Prorate**
3. **Branding** — upload Stationly logo if you want.
4. **Business information** — set Terms of Service URL and Privacy Policy URL (we have both at `/legal.html`).
5. Click **Save**.

---

## Step 3 — Register the webhook endpoint

1. Go to **Developers → Webhooks → Add endpoint**.
2. **Endpoint URL:** `https://vmnhizmibdtlizigbzks.supabase.co/functions/v1/stripe-webhook`
3. **Description:** "Stationly Supabase webhook"
4. **Events to send** — select these 6:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
5. Click **Add endpoint**.
6. On the endpoint detail page, click **Reveal signing secret** → copy the value (starts with `whsec_`). You'll paste this into Supabase next.

---

## Step 4 — Set Supabase edge function secrets

Open: [Supabase → Settings → Functions → Secrets](https://supabase.com/dashboard/project/vmnhizmibdtlizigbzks/settings/functions)

Add these 5 secrets (click "Add new secret" for each):

| Name | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` (from Step 1) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (from Step 3) |
| `STRIPE_PRICE_MONTHLY` | `price_1TQtzeKEZmx2FnWM4tM864Gu` |
| `STRIPE_PRICE_ANNUAL` | `price_1TQuJIKEZmx2FnWMO8eXbO39` |
| `APP_BASE_URL` | `https://stationly.ai` |

No redeploy needed — secrets propagate to running edge functions within ~30 seconds.

---

## Step 5 — Smoke test end-to-end

### 5a. Webhook ping
1. Stripe → Webhooks → click your endpoint → **Send test webhook**.
2. Pick `customer.subscription.updated` → **Send test webhook**.
3. Should return **200 OK**. If 400 → secret mismatch. If 500 → check Supabase function logs.

### 5b. Trial → paid upgrade flow
1. Sign in to https://stationly.ai as a real (non-demo) tenant.
2. Go to **Billing** tab → should show "Trial · X days remaining".
3. Click **Add a card** → Stripe Checkout opens.
4. Use test card `4242 4242 4242 4242`, any future expiry, any CVC, any zip.
5. Complete checkout → redirects back to Billing tab.
6. Within ~5 seconds the status card flips to **Active**, plan = "Stationly · all-in (monthly)".
7. In Stripe → **Customers** → you should see a new customer with an active subscription.
8. In Supabase → `subscriptions` table → that tenant's row should now have `status='active'`, `stripe_subscription_id='sub_...'`.

### 5c. Customer portal
1. On Billing tab → click **Manage payment**.
2. Stripe portal opens → you should see plan, payment method, invoice history.
3. Try switching to annual → confirm prorated invoice generated correctly.

### 5d. Past-due simulation (optional)
1. In Stripe → **Customers → [your test customer] → Subscriptions** → click the subscription.
2. **Update subscription → Cancel** OR trigger a failed invoice via test card `4000 0000 0000 0341`.
3. Wait for `invoice.payment_failed` webhook → app should show the past-due banner.
4. After 7 days from `past_due_since`, app goes read-only (write buttons disabled).

---

## Going live (when ready for production)

When you're ready to flip to live mode:

1. In Stripe, switch from sandbox → **live mode**.
2. Re-create the product + monthly + annual prices in live mode (Stripe doesn't auto-copy from sandbox).
3. Re-do **Steps 2 + 3** in live mode (Customer Portal config + new webhook endpoint).
4. In Supabase, replace the 5 secrets above with their live-mode values:
   - `STRIPE_SECRET_KEY` → `sk_live_...`
   - `STRIPE_WEBHOOK_SECRET` → new `whsec_...` from live webhook
   - `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL` → new live price IDs
5. Update `stripeClient.js` `BILLING_CONFIG` with the live publishable key (`pk_live_...`) and live price IDs.
6. Test with a real card (you can refund yourself).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Webhook returns 400 | `STRIPE_WEBHOOK_SECRET` wrong | Re-copy from Stripe webhook detail page |
| Checkout returns 401 | User not signed in / `verify_jwt` failing | Re-auth in app, retry |
| Status stays `trialing` after checkout | Webhook not firing | Check Stripe → Webhooks → Recent deliveries; verify endpoint URL |
| Same event processed twice | Should be impossible | `billing_events.stripe_event_id` unique constraint dedupes |
| Demo tenant gets billed | Should be impossible | Demo tenant ID hardcoded as `active` until 2099 in migration |

---

## Webhook handler architecture (FYI)

Events are processed in this order inside `stripe-webhook/index.ts`:

1. **Verify Stripe signature** using `STRIPE_WEBHOOK_SECRET` — reject with 400 if invalid.
2. **Insert into `billing_events`** with `stripe_event_id` as unique key — duplicate events bail with `{ ok: true, deduped: true }`.
3. **Switch on `event.type`:**
   - `checkout.session.completed` → fetch subscription, upsert tenant's `subscriptions` row.
   - `customer.subscription.*` → upsert with mapped status (trialing/active/past_due/canceled/etc).
   - `invoice.paid` → ensure `status='active'`, clear `past_due_since`.
   - `invoice.payment_failed` → set `status='past_due'`, set `past_due_since=NOW()` if not already set.
4. **Return 200** — Stripe retries on any non-2xx.

Tenant lookup: subscription row carries `tenant_id` set when checkout session was created (via `client_reference_id` and `subscription_metadata.tenant_id`).
