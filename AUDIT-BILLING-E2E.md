# Stationly Stripe Billing E2E Audit

**Date:** 2026-05-08  
**Auditor:** Automated Playwright test (qa-billing agent)  
**Supabase Project:** `vmnhizmibdtlizigbzks`  
**App URL:** https://stationly.ai  
**Stripe Mode:** TEST (sandbox)  
**Test Tenant ID:** `de892d6a-5354-42c3-82ba-9f5bbe76b2e7`  
**Test Email:** `qa-billing-1778258703585@example.com`  
**Stripe Customer:** `cus_UTpAhCLxOPWETx`  
**Stripe Subscription:** `sub_1TUrWcKEZmx2FnWMAEdGoHJL`

---

## Pass/Fail Summary

| Stage | Check | Result |
|-------|-------|--------|
| 1 | New tenant signup triggers `subscriptions` row with `status=trialing` | ✅ PASS |
| 1 | Trial period seeded correctly in `subscriptions` (14 days, Stripe-consistent) | ✅ PASS |
| 1 | Signup → onboarding → app.html flow completes without errors | ✅ PASS |
| 2 | Billing tab renders with trial banner | ✅ PASS |
| 2 | "Add a card" / "Add billing" button present and clickable | ✅ PASS |
| 2 | Clicking subscribe calls `stripe-checkout` and redirects to Stripe Checkout | ✅ PASS |
| 3 | Stripe Checkout URL is `checkout.stripe.com` with correct plan/pricing | ✅ PASS |
| 3 | Stripe Checkout shows "14 days free" trial, $0.00 due today | ✅ PASS |
| 3 | "Start trial" submit works and redirects back to `stationly.ai/app.html#billing?status=success` | ✅ PASS |
| 4 | `stripe-webhook` fires within 5s of checkout completion | ✅ PASS |
| 4 | `billing_events` table records all 3 expected events | ✅ PASS |
| 4 | `subscriptions.stripe_customer_id` populated after webhook | ✅ PASS |
| 4 | `subscriptions.stripe_subscription_id` populated after webhook | ✅ PASS |
| 4 | `subscriptions.status` remains `trialing` (correct for trial start) | ✅ PASS |
| 5 | `stripe-portal` edge function returns a valid `billing.stripe.com` URL | ✅ PASS |
| 5 | Stripe Customer Portal loads with correct subscription info | ✅ PASS |
| 5 | Portal button (`#billing-portal-btn`) visible in billing tab DOM after checkout | ✅ PASS |
| REG | Demo tenant blocked by `stripe-checkout` with 400 | ✅ PASS (by code review) |
| REG | `stripe-webhook` rejects requests missing `Stripe-Signature` header | ✅ PASS |
| **BUG** | `tenants.trial_ends_at` default is 30 days vs `subscriptions.trial_ends_at` 14 days | ❌ **BUG P0** |
| **BUG** | `tenants.stripe_customer_id` and `stripe_subscription_id` never updated by webhook | ❌ **BUG P1** |
| **BUG** | Post-checkout return to `#billing?status=success` does not switch SPA to Billing view | ❌ **BUG P1** |
| **NOTE** | Trial checkout does not collect a card (`payment_method_collection: "if_required"`) — 4242 card not exercised in trial flow | ⚠️ NOTE |

---

## Stage 1: New Tenant Trial State

**Status: PASS**

A new tenant's `subscriptions` row is seeded by the `tenants_create_subscription` trigger:

```sql
insert into public.subscriptions (tenant_id, status, trial_ends_at)
values (new.id, 'trialing', now() + interval '14 days')
```

The `tenant_billing_status` view and `get_my_billing_status()` RPC correctly expose this as `status='trialing'` with `trial_ends_at` 14 days out, consistent with the Stripe `trial_period_days: 14` setting in `stripe-checkout`.

**Initial billing state observed:**
```json
{
  "status": "trialing",
  "trial_ends_at": "2026-05-22T16:45:05.791123+00:00",
  "stripe_customer_id": null,
  "access_ok": true,
  "banner": "trial"
}
```

---

## Stage 2: Billing Tab UI

**Status: PASS**

The billing tab at `app.html#billing` correctly shows:
- Trial countdown banner ("14 days left. Add a card")
- Empty state with "Start 14-day free trial" button (`#billing-start-btn`)
- Banner button with "Add a card" (`[data-billing-checkout]`)

Screenshot: `billing-e2e/08-billing.png`

---

## Stage 3: Stripe Checkout Redirect

**Status: PASS**

Clicking the subscribe button calls `stripe-checkout` edge function, which:
1. Creates a Stripe Customer (`cus_*`)
2. Creates a Checkout Session with `mode: "subscription"`, `trial_period_days: 14`, `payment_method_collection: "if_required"`
3. Returns `{ url: "https://checkout.stripe.com/..." }`

The browser redirects to `checkout.stripe.com`. The checkout page shows "Start for free — 14 days free, then $89.00/month", with **$0.00 due today**.

Since `payment_method_collection: "if_required"` is set, Stripe does not require a card for the trial start. The page shows only a "Start trial" button with the pre-filled email. No card form is presented.

**Implication for card testing:** The `4242 4242 4242 4242` test card scenario is only relevant for the **post-trial "Add a card"** flow (when a trialing user clicks "Add a card" from the billing tab). The trial start flow is card-free by design.

Screenshot: `billing-e2e/10-stripe-checkout.png` (before load), `billing-e2e/11-stripe-page.png` (loaded)

---

## Stage 4: Webhook Processing

**Status: PASS**

Three Stripe events were received and processed within ~3 seconds of checkout completion:

| Event ID | Type | Processed At |
|----------|------|--------------|
| `evt_1TUrWeKEZmx2FnWMDzNlkyRI` | `invoice.paid` | 2026-05-08 16:45:21 UTC |
| `evt_1TUrWeKEZmx2FnWMbq2p3W8K` | `customer.subscription.created` | 2026-05-08 16:45:21 UTC |
| `evt_1TUrWeKEZmx2FnWMOzBbNnMi` | `checkout.session.completed` | 2026-05-08 16:45:22 UTC |

**Webhook URL:** `https://vmnhizmibdtlizigbzks.supabase.co/functions/v1/stripe-webhook`  
**JWT verification:** Disabled (`verify_jwt: false`) — correct, Stripe doesn't send Supabase JWTs.  
**Auth method:** HMAC-SHA256 signature via `STRIPE_WEBHOOK_SECRET` env var.

**Final `subscriptions` row after webhook:**
```json
{
  "tenant_id": "de892d6a-5354-42c3-82ba-9f5bbe76b2e7",
  "stripe_customer_id": "cus_UTpAhCLxOPWETx",
  "stripe_subscription_id": "sub_1TUrWcKEZmx2FnWMAEdGoHJL",
  "status": "trialing",
  "plan": "allin",
  "billing_interval": "month",
  "quantity": 1,
  "current_period_end": "2026-05-22T16:45:18+00:00",
  "trial_ends_at": "2026-05-22T16:45:18+00:00",
  "current_price_id": "price_1TRmpUKEZmx2FnWMDc95wawZ"
}
```

**Webhook handles the following events (confirmed in source):**

| Event | Handler | DB Action |
|-------|---------|-----------|
| `checkout.session.completed` | ✅ Handled | Upserts full subscription via `mapSubscription()` |
| `customer.subscription.created` | ✅ Handled | Upserts full subscription via `mapSubscription()` |
| `customer.subscription.updated` | ✅ Handled | Upserts full subscription via `mapSubscription()` |
| `customer.subscription.deleted` | ✅ Handled | Sets `status=canceled` |
| `invoice.paid` | ✅ Handled | Sets `status=active`, clears `past_due_since` |
| `invoice.payment_failed` | ✅ Handled | Sets `status=past_due`, records `past_due_since` |

**Missing events (not registered/handled):**
- `customer.subscription.trial_will_end` — No handler. Recommended for sending trial expiry notifications.
- `payment_intent.payment_failed` — Not handled (only `invoice.payment_failed` is).

---

## Stage 5: Customer Portal

**Status: PASS**

`stripe-portal` returns a valid `billing.stripe.com/p/session/test_*` URL. The portal loads with:
- Current subscription: "Stationly · all-in" at $89/month
- Trial: "Free trial ends May 22"
- No payment method (as expected for trial-only)
- "Add payment method" button available
- Invoice history: $0.00 trial period invoice

Screenshot: `billing-e2e/P2-billing-portal.png`

**Note on portal button in UI:** The `#billing-portal-btn` is shown in the DOM with `hidden=false` after checkout, but only when the Billing view tab is active. Navigating to `#billing` (without `?status=success`) after a fresh page load correctly shows the portal button once `getBillingStatus()` returns a row with `stripe_customer_id` set.

---

## Env Var Configuration

Confirmed present (by edge function behavior — functions return valid Stripe responses):

| Variable | Purpose | Confirmed |
|----------|---------|-----------|
| `STRIPE_SECRET_KEY` | Stripe API authentication | ✅ (checkout creates sessions) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification | ✅ (webhooks processed) |
| `STRIPE_PRICE_MONTHLY` | Monthly plan price ID | ✅ (`price_1TRmpUKEZmx2FnWMDc95wawZ` returned) |
| `STRIPE_PRICE_ANNUAL` | Annual plan price ID | Not tested |
| `APP_BASE_URL` | Redirect URLs for checkout | ✅ (redirects to stationly.ai) |
| `SUPABASE_URL` | Supabase project URL | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role DB writes | ✅ (webhook updates work) |
| `SUPABASE_ANON_KEY` | User JWT verification | ✅ |

---

## DB Schema Reference

### `subscriptions` table (primary billing table — webhook writes here)
| Column | Type | Notes |
|--------|------|-------|
| `tenant_id` | uuid PK | FK to tenants |
| `stripe_customer_id` | text | Set by checkout/webhook |
| `stripe_subscription_id` | text | Set by webhook |
| `status` | text | `trialing`, `active`, `past_due`, `canceled` |
| `plan` | text | Always `allin` |
| `billing_interval` | text | `month` or `year` |
| `quantity` | int | Number of locations |
| `current_period_end` | timestamptz | Next billing date |
| `trial_ends_at` | timestamptz | Stripe trial end |
| `past_due_since` | timestamptz | Set on `invoice.payment_failed` |
| `current_price_id` | text | Active Stripe price ID |

### `tenants` table (legacy billing fields — NOT updated by webhook)
| Column | Type | Notes |
|--------|------|-------|
| `subscription_status` | USER-DEFINED enum | Set to `trialing` by column default |
| `trial_ends_at` | timestamptz | **Default: `now() + 30 days`** ← inconsistency |
| `stripe_customer_id` | text | **Never updated by webhook** ← bug |
| `stripe_subscription_id` | text | **Never updated by webhook** ← bug |

### `tenant_billing_status` view
Reads from `subscriptions` only. Computes `access_ok` and `banner` flags. This is the correct source of truth for billing state.

### `billing_events` table
Idempotency log for all Stripe webhook events. `stripe_event_id` has a UNIQUE constraint.

---

## Bugs Found

### 🔴 P0: Trial duration inconsistency — 30 days (UI) vs 14 days (Stripe/billing)

**Location:**  
- `tenants.trial_ends_at` column default: `now() + interval '30 days'`
- `create_subscription_for_new_tenant` trigger: `now() + interval '14 days'`  
- `stripe-checkout` function: `trial_period_days: 14`
- `signup.html`, `about.html`, `legal/terms.html`: advertise "30-day free trial"
- `app.js:3722`: app banner reads `tenants.trial_ends_at` (30 days)

**Effect:** New users see "30 days left in your free trial" in the app banner, but Stripe will charge them after 14 days. The Stripe portal shows "Free trial ends [14 days from now]". This creates a false expectation — users believe they have 30 days but Stripe charges after 14.

**Fix:** Align the two systems. Decide which is authoritative:
- **Option A (recommended):** Change the Stripe `trial_period_days` to 30 and update the `create_subscription_for_new_tenant` trigger to `now() + interval '30 days'`. Update `stripeClient.js` `trial_days: 14` to `30`.
- **Option B:** Change `tenants.trial_ends_at` default to `now() + interval '14 days'` and update all marketing copy from "30-day" to "14-day".

---

### 🟠 P1: `tenants.stripe_customer_id` and `tenants.stripe_subscription_id` never updated

**Location:** `stripe-webhook/index.ts` — webhook writes to `subscriptions` table only. `tenants` table has `stripe_customer_id` and `stripe_subscription_id` columns that are never populated.

**Effect:**
- `supabaseClient.getMemberships()` selects from `tenants` (includes `subscription_status`, `trial_ends_at`) but not from `subscriptions`
- Code that reads `ctx.tenant.stripe_customer_id` or `ctx.tenant.stripe_subscription_id` will always get `null`
- The `platform.js` admin table may show incorrect billing state

**Fix:** Either:
- **Option A:** Add webhook logic to also update `tenants.stripe_customer_id` and `tenants.stripe_subscription_id` 
- **Option B (preferred):** Remove `stripe_customer_id` and `stripe_subscription_id` from `tenants` table (they are redundant with `subscriptions`) and update `getMemberships()` to join `subscriptions`

---

### 🟠 P1: Post-Checkout SPA navigation does not activate Billing view

**Location:** `app.html` + `app.js` — After Stripe redirects back to `https://stationly.ai/app.html#billing?status=success`, the main content area does not switch to the Billing view. The Overview tab remains active.

**Effect:** Users returning from Stripe Checkout see the Overview dashboard instead of the Billing tab confirming their subscription. The billing polling (`maybeReloadOnReturn`) does fire and correctly fetches updated status, but the billing section is not visible.

**Evidence:** Screenshot `billing-e2e/P1-billing-success-hash.png` shows Overview content despite URL being `#billing?status=success`.

**Root cause investigation needed:** The SPA view switching on hash change may not handle the `?status=success` query string correctly, or the routing logic requires an exact hash match (`#billing` not `#billing?status=success`).

**Fix:** In `app.js`, when handling `hashchange`, parse the view name from the hash before the `?` character:
```javascript
// Instead of: hash === '#billing'
// Use:
const viewName = hash.split('?')[0].replace('#', '');
```

---

### 🟡 P2: "Start trial" checkout does not exercise the 4242 test card

**Location:** `stripe-checkout/index.ts` — `payment_method_collection: withTrial ? "if_required" : "always"`

**Effect:** When `with_trial: true` (the default for new subscriptions), Stripe shows a card-free "Start trial" button. The 4242 card scenario is only reachable if:
1. A user starts a trial (no card), then the trial ends without adding a card → subscription cancels
2. User then starts a new checkout with `with_trial: false` (or via "Add a card" button on a trialing subscription)

The `billing-checkout-btn` ("Add a card") button in the billing status card is shown when `status === 'trialing' && !stripe_subscription_id` — but after our test, `stripe_subscription_id` IS set, so this button should be hidden. The card-collection flow is **not reachable in the normal trial start flow**.

**Fix / Recommendation:** Add a card-optional flow integration test specifically for the post-trial-expiry scenario. Consider always collecting a card upfront (change `payment_method_collection: "always"`) if the business wants guaranteed revenue at trial end.

---

### 🟡 P2: `customer.subscription.trial_will_end` webhook event not handled

**Location:** `stripe-webhook/index.ts` — no case for `customer.subscription.trial_will_end`

**Effect:** Stripe sends this event 3 days before trial ends. Without handling it, Stationly cannot send trial expiry email reminders or surface in-app alerts to prompt users to add a card.

**Fix:** Add a case in the webhook switch statement; trigger an email/notification or update a field like `trial_ending_notified_at`.

---

### 🟡 P2: `tenants.subscription_status` enum not updated after webhook

**Location:** `stripe-webhook/index.ts` + `tenants` table.

**Effect:** `tenants.subscription_status` (a USER-DEFINED enum, default `'trialing'`) is never updated by the webhook. If app code reads `ctx.tenant.subscription_status`, it will always show `trialing` even after a subscription goes `active`, `past_due`, or `canceled`.

**Observed:** After successful trial start + webhook, `tenants.subscription_status` remains `'trialing'`. The `subscriptions.status` is correctly `'trialing'` (matches), so this is currently masked — but will diverge when `invoice.paid` fires and sets `subscriptions.status='active'`.

**Fix:** In the webhook handler's `invoice.paid` case, also update `tenants.subscription_status = 'active'`. Or remove `subscription_status` from `tenants` entirely and rely only on `subscriptions`.

---

## Webhook Registration Note

The webhook URL `https://vmnhizmibdtlizigbzks.supabase.co/functions/v1/stripe-webhook` must be registered in the Stripe Dashboard under **Developers → Webhooks** with the following events:

- `checkout.session.completed` ✅ (confirmed firing)
- `customer.subscription.created` ✅ (confirmed firing)  
- `customer.subscription.updated` (should be registered)
- `customer.subscription.deleted` (should be registered)
- `invoice.paid` ✅ (confirmed firing)
- `invoice.payment_failed` (should be registered)
- `customer.subscription.trial_will_end` (recommended — not currently handled)

**The webhook IS registered and working** — all 3 events from the test run were processed correctly.

---

## Screenshots Reference

| File | Description |
|------|-------------|
| `01-signup.png` | Signup page |
| `02-onboarding-1.png` | Onboarding step 1 (restaurant basics) |
| `03-onboarding-2.png` | Onboarding step 2 |
| `06-onboarding-6.png` | Onboarding step 6 (completion) |
| `07-app.png` | App after onboarding |
| `08-billing.png` | Billing tab |
| `09-pre-checkout.png` | Billing tab — checkout button found |
| `10-stripe-checkout.png` | Stripe checkout page (immediate) |
| `11-stripe-page.png` | Stripe checkout loaded |
| `12-stripe-ready-to-submit.png` | Stripe ready to submit |
| `13-post-checkout.png` | Redirect back to stationly.ai after checkout |
| `P1-billing-success-hash.png` | Billing tab with `#billing?status=success` hash (Overview visible — P1 bug) |
| `V1-billing-success-hash.png` | Billing DOM state after success hash (portal btn hidden=false) |
| `P2-billing-portal.png` | Stripe Customer Portal (PASS) |

All screenshots saved in `/home/user/workspace/restopsai-app/billing-e2e/`.

---

## Recommendations Summary

| Severity | Item | Action |
|----------|------|--------|
| **P0** | 30-day vs 14-day trial mismatch | Align `tenants.trial_ends_at` default, `create_subscription_for_new_tenant` trigger, and Stripe `trial_period_days` to the same value; update marketing copy |
| **P1** | `tenants.stripe_customer_id` never set | Remove redundant columns from `tenants` or add webhook sync |
| **P1** | Post-checkout SPA routing | Fix hash routing to strip `?` query before matching view name |
| **P2** | 4242 card flow untested in E2E | Add dedicated test for post-trial card-add checkout (`with_trial: false`) |
| **P2** | `trial_will_end` event not handled | Add webhook handler; send email reminder 3 days before trial end |
| **P2** | `tenants.subscription_status` not synced | Sync from webhook or deprecate in favor of `subscriptions.status` |
| **P2** | Missing webhook events | Register `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` in Stripe dashboard if not already |

---

## Test Spec

Test file: `tests/e2e/tests/14-billing-e2e.spec.js`

Run with:
```bash
cd tests/e2e
npx playwright test 14-billing-e2e.spec.js --headed
```

Or as part of the full suite:
```bash
npx playwright test
```

---

*Audit completed automatically on 2026-05-08. Test tenant `de892d6a-5354-42c3-82ba-9f5bbe76b2e7` (email: `qa-billing-1778258703585@example.com`) can be cleaned up from Supabase dashboard and Stripe test dashboard.*
