# Stripe Billing Integration — Stationly

**Status:** Draft · **Author:** Engineering  
**Supabase project:** `vmnhizmibdtlizigbzks`  
**Stripe mode:** Test (cutover checklist in §8)  
**Last updated:** 2026-04-27

---

## ⚠️ Pricing override — supersedes §1

After user review, Stationly is shipping with **one flat plan**, not 3 tiers. The original §1 tier model below is retained for reference only — **the actual implementation MUST use the model in this section.**

### Final pricing model

| Item | Value |
|---|---|
| Plan name | **Stationly · all-in** |
| Monthly price | **$89 USD per location, per month** |
| Annual price | **$71/loc/mo billed yearly** ($852/loc/yr — 20% discount) |
| Trial | 14 days, no card required |
| Locations included | 1 (each additional location = $89/mo or $71/mo annual) |
| Seats | Unlimited |
| Feature gating | None — every customer gets every feature |
| Enterprise / chains | "Talk to us" CTA → manual quote, billed via Stripe invoicing |

### Stripe object simplification

Instead of 6 prices across 3 products, we ship **one product + two prices**:

```
Product: prod_stationly_allin ("Stationly · all-in")
  ├── price_monthly_loc      $89/mo   (recurring, per_unit, quantity = location count)
  └── price_annual_loc       $852/yr  ($71/mo equivalent)
```

Location count is billed via the `quantity` field on the subscription item — increment when an owner adds a location, decrement on removal (Stripe prorates automatically). This collapses §3 considerably: skip product creation for Pro/Enterprise; create only the two prices above.

### Data model simplification

The `subscriptions` table still applies, but:
- `plan` column becomes a single fixed value `'allin'` (kept for future-proofing)
- Add `quantity int default 1` to track location count
- Drop the `tier` concept entirely — no `requireTier()` helper, no upgrade modals
- Past-due grace period and demo-tenant exemption logic from §7 still applies as written

### Frontend simplification

- No tier picker. Checkout always uses `price_monthly_loc` (or `price_annual_loc` if user toggles to annual)
- No `gate(tier, feature)` calls anywhere in the app — remove from §4.3
- Customer portal lets owner: switch monthly ↔ annual, update payment method, cancel
- Adding a second location: in-app flow that calls `stripe-update-quantity` edge function (new — adds to §5)

### Onboarding hook

Wizard step 6 still triggers a 14-day trial via Checkout Session, but always against `price_monthly_loc` with `quantity: 1` and `payment_method_collection: 'if_required'`. The trial-ending notification copy from §6 still applies.

### Why this model

- Honors the homepage promise: "No tiers, no upsells, no per-seat games"
- Restaurant operators are tier-fatigued from Toast / 7shifts / Restaurant365
- Single SKU = simpler billing ops, simpler support, simpler webhook code
- Per-location quantity scales naturally with customer growth without forcing a tier conversation

---

## Table of Contents

1. [Pricing Model](#1-pricing-model)
2. [Data Model](#2-data-model)
3. [Stripe Object Setup](#3-stripe-object-setup)
4. [Frontend Flows](#4-frontend-flows)
5. [Edge Functions](#5-edge-functions)
6. [Trial + Onboarding Hook](#6-trial--onboarding-hook)
7. [Failure Handling](#7-failure-handling)
8. [Rollout Checklist](#8-rollout-checklist)
9. [Open Questions](#9-open-questions)

---

## 1. Pricing Model

### Benchmark

Comparable restaurant SaaS tools price as follows:

| Product | Monthly (per location) | Notes |
|---|---|---|
| Toast POS (Point of Sale plan) | $69 | Core POS only; add-ons push typical bills to $300–$800/mo ([UpMenu](https://www.upmenu.com/blog/toast-pricing/)) |
| 7shifts (The Works) | $76.99/location | Scheduling + labor; $150/mo Gourmet tier ([SaaSworthy](https://www.saasworthy.com/product/7shifts/pricing)) |
| MarginEdge | $350/location | Back-office invoice processing + recipe costing ([MarginEdge](https://www.marginedge.com/pricing/)) |

Stationly is positioned as an integrated back-office + ops platform — broader than 7shifts (scheduling only) and more affordable than MarginEdge (back-office only). The recommended pricing lands between them.

---

### Recommended Tiers

#### Starter — $49/month · $39/month billed annually ($468/yr)

Best for: single-location independents, ghost kitchens, food trucks.

| Feature | Included |
|---|---|
| Locations | 1 |
| Seats (named users) | Up to 5 (owner + 4 staff) |
| Menu & recipe management | ✓ |
| Basic scheduling | ✓ |
| Inventory tracking (manual) | ✓ |
| Sales reporting (POS import CSV) | ✓ |
| AI features | None |
| Integrations | None |
| Support | Email, 48h SLA |
| Trial | 14 days free |

#### Pro — $99/month · $79/month billed annually ($948/yr)

Best for: established single-location restaurants or 2–3 location groups.

| Feature | Included |
|---|---|
| Locations | Up to 3 |
| Seats | Up to 20 |
| Everything in Starter | ✓ |
| Live POS integration (Toast API, Square) | ✓ |
| Automated invoice processing | ✓ |
| Labor cost & scheduling forecasts | ✓ |
| AI Menu Optimizer (weekly suggestions) | ✓ |
| AI Chat assistant | ✓ |
| Manager activity log | ✓ |
| Custom roles & permissions | ✓ |
| Support | Email + chat, 24h SLA |
| Trial | 14 days free |

#### Enterprise — $249/month · $199/month billed annually ($2,388/yr)

Best for: multi-location groups, franchises, hospitality groups.

| Feature | Included |
|---|---|
| Locations | Unlimited |
| Seats | Unlimited |
| Everything in Pro | ✓ |
| Multi-location consolidated P&L | ✓ |
| AI Food Cost Predictor | ✓ |
| Dedicated onboarding (2 sessions) | ✓ |
| SSO (SAML) | ✓ |
| Priority support | 4h SLA, named CSM |
| Custom contract available | ✓ |
| Trial | 14 days free |

**Annual discount: 20%.** This is aggressive enough to shift cash flow without being hard to explain. MarginEdge uses 10% ([MarginEdge](https://www.marginedge.com/pricing/)); we can afford 20% because our COGS are lower (Supabase + GitHub Pages vs. managed infrastructure).

**Stripe Price IDs to create** (see §3):

| Plan | Interval | Price ID alias |
|---|---|---|
| `starter_monthly` | month | `price_starter_mo` |
| `starter_annual` | year | `price_starter_yr` |
| `pro_monthly` | month | `price_pro_mo` |
| `pro_annual` | year | `price_pro_yr` |
| `enterprise_monthly` | month | `price_enterprise_mo` |
| `enterprise_annual` | year | `price_enterprise_yr` |

Store these IDs in app config after creation (see §8 env vars).

---

## 2. Data Model

### New Tables

#### `subscriptions`

Tracks the canonical billing state for each tenant. This is the **single source of truth** that the app reads — not Stripe directly.

```sql
-- subscriptions: one row per tenant, updated by webhook
create table public.subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  stripe_customer_id    text,
  stripe_subscription_id text,
  status                text not null default 'trialing',
    -- values: trialing | active | past_due | canceled | unpaid | paused | incomplete
  plan                  text not null default 'starter',
    -- values: starter | pro | enterprise
  billing_interval      text not null default 'month',
    -- values: month | year
  current_period_end    timestamptz,
  cancel_at_period_end  boolean not null default false,
  trial_ends_at         timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint subscriptions_tenant_unique unique (tenant_id)
);

-- Automatically bump updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute procedure public.set_updated_at();

-- Index for webhook lookups by Stripe IDs
create index subscriptions_stripe_customer_id_idx
  on public.subscriptions (stripe_customer_id);

create index subscriptions_stripe_subscription_id_idx
  on public.subscriptions (stripe_subscription_id);
```

#### `billing_events`

Append-only audit log of every Stripe webhook event received. The `stripe_event_id` unique constraint is the idempotency guard — inserting a duplicate event will fail, which is the correct behavior ([Stripe Docs — Webhooks](https://docs.stripe.com/webhooks)).

```sql
-- billing_events: idempotent log of all processed Stripe webhook events
create table public.billing_events (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references public.tenants(id) on delete set null,
  stripe_event_id  text not null,
  type             text not null,  -- e.g. "invoice.paid"
  payload          jsonb not null default '{}',
  processed_at     timestamptz not null default now(),

  constraint billing_events_stripe_event_id_unique unique (stripe_event_id)
);

create index billing_events_tenant_id_idx
  on public.billing_events (tenant_id);

create index billing_events_type_idx
  on public.billing_events (type);
```

### RLS Policies

```sql
-- ────────────────────────────────────────────────
-- subscriptions RLS
-- ────────────────────────────────────────────────
alter table public.subscriptions enable row level security;

-- Members of a tenant can read their subscription
create policy "tenant members can read subscription"
  on public.subscriptions
  for select
  using (
    exists (
      select 1
      from public.memberships m
      where m.tenant_id = subscriptions.tenant_id
        and m.user_id = auth.uid()
    )
  );

-- Platform owners can read all subscriptions (for admin dashboard)
create policy "platform owners can read all subscriptions"
  on public.subscriptions
  for select
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_platform_owner = true
    )
  );

-- Only service role (webhook function) may insert/update/delete.
-- No authenticated-user write policies are created.
-- The stripe-webhook edge function uses the service role key.

-- ────────────────────────────────────────────────
-- billing_events RLS
-- ────────────────────────────────────────────────
alter table public.billing_events enable row level security;

-- Members can read their own tenant's events (useful for debugging UI)
create policy "tenant members can read billing events"
  on public.billing_events
  for select
  using (
    exists (
      select 1
      from public.memberships m
      where m.tenant_id = billing_events.tenant_id
        and m.user_id = auth.uid()
    )
  );

-- Platform owners can read all events
create policy "platform owners can read all billing events"
  on public.billing_events
  for select
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_platform_owner = true
    )
  );

-- Only service role writes billing_events (webhook function).
```

### Initial Seed: Demo Tenant

The demo tenant (`a2e00ee7-1f30-4fbd-86b9-e560fc062f72`) must be seeded as permanently active so it is never gated:

```sql
insert into public.subscriptions (
  tenant_id,
  stripe_customer_id,
  stripe_subscription_id,
  status,
  plan,
  billing_interval,
  current_period_end,
  trial_ends_at
) values (
  'a2e00ee7-1f30-4fbd-86b9-e560fc062f72',
  null,  -- no Stripe customer; exempt
  null,
  'active',
  'enterprise',
  'month',
  '2099-12-31 23:59:59+00',
  null
)
on conflict (tenant_id) do nothing;
```

---

## 3. Stripe Object Setup

### Products & Prices

You need 3 products (one per tier) and 6 prices (monthly + annual per tier). The annual price uses a `year` interval — not a discounted monthly with `count=12` — so Stripe invoices correctly.

#### Dashboard Click-Path

1. Go to **Stripe Dashboard → Products → + Add product**
2. For each tier:
   - **Name:** `Stationly Starter` / `Stationly Pro` / `Stationly Enterprise`
   - **Description:** one-line pitch
   - **Pricing model:** Standard pricing → Recurring
   - Add two prices per product:
     - Monthly: amount in cents, interval = Month
     - Annual: discounted amount in cents × 12, interval = Year
   - **Tax behavior:** `exclusive` (Stripe Billing automatically calculates and collects sales tax if you enable Stripe Tax later; setting it now avoids a breaking change) ([Stripe Docs — Tax behavior](https://docs.stripe.com/products-prices/manage-prices#tax-behavior))
3. Copy the `price_xxx` IDs and store in your app config.

#### Stripe CLI / API Script Alternative

```bash
#!/usr/bin/env bash
# run with: STRIPE_SECRET_KEY=sk_test_... bash setup-stripe-products.sh

set -euo pipefail
API="https://api.stripe.com/v1"
AUTH="-u ${STRIPE_SECRET_KEY}:"

# ── STARTER ──────────────────────────────────────
STARTER=$(curl -s $AUTH "$API/products" \
  -d name="Stationly Starter" \
  -d description="Single-location back-office for independent restaurants" \
  -d "metadata[tier]=starter" | jq -r '.id')
echo "Starter product: $STARTER"

curl -s $AUTH "$API/prices" \
  -d product="$STARTER" \
  -d unit_amount=4900 \
  -d currency=usd \
  -d "recurring[interval]=month" \
  -d tax_behavior=exclusive \
  -d "metadata[plan]=starter" \
  -d "metadata[interval]=month" \
  -d nickname="Starter Monthly"

curl -s $AUTH "$API/prices" \
  -d product="$STARTER" \
  -d unit_amount=46800 \
  -d currency=usd \
  -d "recurring[interval]=year" \
  -d tax_behavior=exclusive \
  -d "metadata[plan]=starter" \
  -d "metadata[interval]=year" \
  -d nickname="Starter Annual"

# ── PRO ──────────────────────────────────────────
PRO=$(curl -s $AUTH "$API/products" \
  -d name="Stationly Pro" \
  -d description="Up to 3 locations, POS integration, AI features" \
  -d "metadata[tier]=pro" | jq -r '.id')
echo "Pro product: $PRO"

curl -s $AUTH "$API/prices" \
  -d product="$PRO" \
  -d unit_amount=9900 \
  -d currency=usd \
  -d "recurring[interval]=month" \
  -d tax_behavior=exclusive \
  -d "metadata[plan]=pro" \
  -d "metadata[interval]=month" \
  -d nickname="Pro Monthly"

curl -s $AUTH "$API/prices" \
  -d product="$PRO" \
  -d unit_amount=94800 \
  -d currency=usd \
  -d "recurring[interval]=year" \
  -d tax_behavior=exclusive \
  -d "metadata[plan]=pro" \
  -d "metadata[interval]=year" \
  -d nickname="Pro Annual"

# ── ENTERPRISE ───────────────────────────────────
ENT=$(curl -s $AUTH "$API/products" \
  -d name="Stationly Enterprise" \
  -d description="Unlimited locations, advanced AI, dedicated support" \
  -d "metadata[tier]=enterprise" | jq -r '.id')
echo "Enterprise product: $ENT"

curl -s $AUTH "$API/prices" \
  -d product="$ENT" \
  -d unit_amount=24900 \
  -d currency=usd \
  -d "recurring[interval]=month" \
  -d tax_behavior=exclusive \
  -d "metadata[plan]=enterprise" \
  -d "metadata[interval]=month" \
  -d nickname="Enterprise Monthly"

curl -s $AUTH "$API/prices" \
  -d product="$ENT" \
  -d unit_amount=238800 \
  -d currency=usd \
  -d "recurring[interval]=year" \
  -d tax_behavior=exclusive \
  -d "metadata[plan]=enterprise" \
  -d "metadata[interval]=year" \
  -d nickname="Enterprise Annual"

echo "Done. Copy the price IDs above into your app config."
```

### Customer Portal Configuration

Configure once in Dashboard → **Billing → Customer portal** ([Stripe Docs — Customer Portal](https://docs.stripe.com/customer-management/integrate-customer-portal)):

| Setting | Value |
|---|---|
| Business name | Stationly |
| Default return URL | `https://stationly.ai/app.html#billing` |
| Allow customers to update payment method | ✓ |
| Allow customers to cancel subscriptions | ✓ (cancel at period end, not immediately) |
| Allow customers to switch plans | ✓ (enable plan upgrade/downgrade) |
| Show invoice history | ✓ |
| Subscription cancellation reason | Optional — enable for churn data |

---

## 4. Frontend Flows

All flows live in `app.js` (or a dedicated `billing.js` module). The app is a static SPA on GitHub Pages so all billing mutations go through Supabase Edge Functions, never directly to Stripe from the browser.

### 4.1 Checkout Flow

From `app.html#billing`, when a user clicks "Upgrade" or "Start Trial":

```javascript
// billing.js

const SUPABASE_URL = "https://vmnhizmibdtlizigbzks.supabase.co";
const EDGE_BASE    = `${SUPABASE_URL}/functions/v1`;

/**
 * Redirect to Stripe Checkout for a given price ID.
 * @param {string} priceId  - Stripe price ID (e.g. "price_xxx")
 * @param {boolean} trial   - if true, 14-day trial is applied
 */
async function startCheckout(priceId, trial = true) {
  const session = await supabase.auth.getSession();
  const token   = session.data?.session?.access_token;
  if (!token) { window.location.href = "/login.html"; return; }

  const tenantId = getCurrentTenantId(); // from app state

  const res = await fetch(`${EDGE_BASE}/stripe-checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ tenant_id: tenantId, price_id: priceId, trial }),
  });

  if (!res.ok) {
    const err = await res.json();
    showToast("Could not start checkout: " + (err.error ?? "unknown error"), "error");
    return;
  }

  const { url } = await res.json();
  window.location.href = url; // redirect to Stripe-hosted Checkout page
}

// Wire up plan buttons in the billing panel
document.querySelectorAll("[data-checkout-price]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const priceId = btn.dataset.checkoutPrice;
    startCheckout(priceId);
  });
});
```

HTML example for the billing panel:

```html
<!-- app.html — billing section -->
<section id="billing-panel" class="panel" hidden>
  <h2>Choose a plan</h2>

  <div class="plan-card">
    <h3>Starter</h3>
    <p class="price">$49<span>/mo</span></p>
    <button data-checkout-price="price_starter_mo">Start 14-day trial</button>
    <button data-checkout-price="price_starter_yr" class="btn-outline">
      $39/mo billed annually
    </button>
  </div>

  <div class="plan-card featured">
    <h3>Pro</h3>
    <p class="price">$99<span>/mo</span></p>
    <button data-checkout-price="price_pro_mo">Start 14-day trial</button>
    <button data-checkout-price="price_pro_yr" class="btn-outline">
      $79/mo billed annually
    </button>
  </div>

  <div class="plan-card">
    <h3>Enterprise</h3>
    <p class="price">$249<span>/mo</span></p>
    <button data-checkout-price="price_enterprise_mo">Start 14-day trial</button>
    <button data-checkout-price="price_enterprise_yr" class="btn-outline">
      $199/mo billed annually
    </button>
  </div>
</section>
```

### 4.2 Customer Portal Flow

Allow owners/managers to manage their subscription (update card, cancel, view invoices):

```javascript
/**
 * Open the Stripe Customer Portal for the current tenant.
 */
async function openCustomerPortal() {
  const session = await supabase.auth.getSession();
  const token   = session.data?.session?.access_token;
  if (!token) return;

  const tenantId = getCurrentTenantId();

  const res = await fetch(`${EDGE_BASE}/stripe-portal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ tenant_id: tenantId }),
  });

  if (!res.ok) {
    showToast("Could not open billing portal", "error");
    return;
  }

  const { url } = await res.json();
  window.location.href = url;
}

document.getElementById("manage-billing-btn")?.addEventListener("click", openCustomerPortal);
```

### 4.3 Plan-Gating UI Helper

`requireTier` is the single gating primitive used throughout the app. It reads from the local subscription state (fetched at boot — see §7) so there is no extra network call per feature check.

```javascript
// subscription-state.js — loaded once at app boot

let _sub = null; // cached subscription row

const TIER_RANK = { starter: 1, pro: 2, enterprise: 3 };
const DEMO_TENANT_ID = "a2e00ee7-1f30-4fbd-86b9-e560fc062f72";

/**
 * Load the tenant's subscription from Supabase.
 * Must be called after auth is resolved.
 */
async function loadSubscription(tenantId) {
  if (tenantId === DEMO_TENANT_ID) {
    // Demo tenant is always treated as active Enterprise
    _sub = { status: "active", plan: "enterprise" };
    return _sub;
  }

  const { data, error } = await supabase
    .from("subscriptions")
    .select("status, plan, trial_ends_at, current_period_end, cancel_at_period_end")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load subscription:", error);
    // Fail open to 'trialing' so users aren't hard-blocked on a DB error
    _sub = { status: "trialing", plan: "starter" };
  } else {
    _sub = data ?? { status: "trialing", plan: "starter" };
  }

  return _sub;
}

/**
 * Returns the current subscription state (cached).
 */
function getSubscription() {
  return _sub;
}

/**
 * Returns true if the tenant's subscription is in an active/usable state.
 * past_due within grace period is also considered active.
 */
function isSubscriptionActive() {
  if (!_sub) return false;
  const { status } = _sub;
  return ["active", "trialing", "past_due"].includes(status);
  // past_due grace: enforced separately by boot check (see §7)
}

/**
 * Returns true if the tenant has at least the requested tier.
 *
 * @param {"starter"|"pro"|"enterprise"} tier
 * @returns {boolean}
 */
function requireTier(tier) {
  if (!isSubscriptionActive()) return false;
  const current = _sub?.plan ?? "starter";
  return (TIER_RANK[current] ?? 0) >= (TIER_RANK[tier] ?? 0);
}

/**
 * Show an upgrade prompt if the tenant lacks the required tier.
 * Returns true if the feature is accessible, false if blocked.
 *
 * Usage:
 *   if (!gate("pro")) return;
 *   // proceed with pro feature
 */
function gate(tier, featureName = "This feature") {
  if (requireTier(tier)) return true;

  // Show upgrade modal
  showUpgradeModal({
    requiredTier: tier,
    featureName,
    currentPlan: _sub?.plan ?? "starter",
  });
  return false;
}

// Example usage in feature code:
//   document.getElementById("ai-optimizer-btn").addEventListener("click", () => {
//     if (!gate("pro", "AI Menu Optimizer")) return;
//     openAiOptimizer();
//   });
```

---

## 5. Edge Functions

Three new Supabase Edge Functions, all in Deno. Deploy pattern matches the existing `notify` function.

### 5.1 `stripe-checkout`

**Path:** `supabase/functions/stripe-checkout/index.ts`  
**Purpose:** Create a Stripe Checkout Session and return its URL. The client redirects the browser there.

```typescript
// supabase/functions/stripe-checkout/index.ts

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const STRIPE_SECRET_KEY  = Deno.env.get("STRIPE_SECRET_KEY")  ?? "";
const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")        ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_BASE           = "https://stationly.ai";
const DEMO_TENANT_ID     = "a2e00ee7-1f30-4fbd-86b9-e560fc062f72";

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-04-10" });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: cors });
  }

  // Validate the JWT and get the calling user
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: { user }, error: userErr } = await supabaseUser.auth.getUser(token);
  if (userErr || !user) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: cors });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { tenant_id: string; price_id: string; trial?: boolean };
  try { body = await req.json(); }
  catch { return Response.json({ error: "invalid_json" }, { status: 400, headers: cors }); }

  const { tenant_id, price_id, trial = true } = body;
  if (!tenant_id || !price_id) {
    return Response.json({ error: "tenant_id and price_id are required" }, { status: 400, headers: cors });
  }

  // ── Block demo tenant ─────────────────────────────────────────────────────
  if (tenant_id === DEMO_TENANT_ID) {
    return Response.json({ error: "demo_tenant_exempt" }, { status: 400, headers: cors });
  }

  // ── Verify caller is owner of this tenant ─────────────────────────────────
  const { data: membership } = await supabaseUser
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenant_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership || !["owner", "manager"].includes(membership.role)) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: cors });
  }

  // ── Find or create Stripe customer ────────────────────────────────────────
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("stripe_customer_id, stripe_subscription_id")
    .eq("tenant_id", tenant_id)
    .maybeSingle();

  let customerId = sub?.stripe_customer_id ?? null;

  if (!customerId) {
    // Get the tenant name for Stripe metadata
    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("name")
      .eq("id", tenant_id)
      .single();

    const customer = await stripe.customers.create({
      email: user.email,
      name: tenant?.name ?? undefined,
      metadata: { tenant_id, supabase_user_id: user.id },
    });
    customerId = customer.id;

    // Upsert the customer ID now so portal can work even before checkout completes
    await supabaseAdmin
      .from("subscriptions")
      .upsert(
        { tenant_id, stripe_customer_id: customerId, status: "trialing", plan: "starter" },
        { onConflict: "tenant_id" }
      );
  }

  // ── Create Checkout Session ───────────────────────────────────────────────
  // See: https://docs.stripe.com/payments/checkout/build-subscriptions
  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: price_id, quantity: 1 }],
    success_url: `${APP_BASE}/app.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${APP_BASE}/app.html#billing`,
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    subscription_data: {
      metadata: { tenant_id },
    },
  };

  // Apply 14-day trial (only for new subscriptions without an existing one)
  // See: https://docs.stripe.com/payments/checkout/free-trials
  if (trial && !sub?.stripe_subscription_id) {
    sessionParams.subscription_data!.trial_period_days = 14;
    sessionParams.subscription_data!.trial_settings = {
      end_behavior: { missing_payment_method: "cancel" },
    };
    // Collect payment method only if user provides one during trial
    sessionParams.payment_method_collection = "if_required";
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(sessionParams);
  } catch (err) {
    console.error("Stripe checkout session error:", err);
    return Response.json({ error: "stripe_error", message: String((err as Error).message) }, { status: 500, headers: cors });
  }

  return Response.json({ url: session.url }, { headers: cors });
});
```

### 5.2 `stripe-portal`

**Path:** `supabase/functions/stripe-portal/index.ts`  
**Purpose:** Create a Stripe Billing Portal session for an existing customer.

```typescript
// supabase/functions/stripe-portal/index.ts

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const STRIPE_SECRET_KEY    = Deno.env.get("STRIPE_SECRET_KEY")       ?? "";
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")            ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_BASE             = "https://stationly.ai";
const DEMO_TENANT_ID       = "a2e00ee7-1f30-4fbd-86b9-e560fc062f72";

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-04-10" });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401, headers: cors });

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !user) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: cors });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { tenant_id: string };
  try { body = await req.json(); }
  catch { return Response.json({ error: "invalid_json" }, { status: 400, headers: cors }); }

  const { tenant_id } = body;
  if (!tenant_id) return Response.json({ error: "tenant_id required" }, { status: 400, headers: cors });

  if (tenant_id === DEMO_TENANT_ID) {
    return Response.json({ error: "demo_tenant_exempt" }, { status: 400, headers: cors });
  }

  // ── Verify caller membership ───────────────────────────────────────────────
  const { data: membership } = await supabaseAdmin
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenant_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership || !["owner", "manager"].includes(membership.role)) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: cors });
  }

  // ── Get Stripe customer ID ─────────────────────────────────────────────────
  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("tenant_id", tenant_id)
    .maybeSingle();

  if (!sub?.stripe_customer_id) {
    return Response.json({ error: "no_stripe_customer", message: "No billing account found. Please start a subscription first." }, { status: 404, headers: cors });
  }

  // ── Create portal session ─────────────────────────────────────────────────
  // See: https://docs.stripe.com/customer-management/integrate-customer-portal
  let portalSession: Stripe.BillingPortal.Session;
  try {
    portalSession = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${APP_BASE}/app.html#billing`,
    });
  } catch (err) {
    console.error("Stripe portal error:", err);
    return Response.json({ error: "stripe_error", message: String((err as Error).message) }, { status: 500, headers: cors });
  }

  return Response.json({ url: portalSession.url }, { headers: cors });
});
```

### 5.3 `stripe-webhook`

**Path:** `supabase/functions/stripe-webhook/index.ts`  
**Purpose:** Receive Stripe webhook events, verify signature, and keep `subscriptions` and `billing_events` tables in sync.

This function **must not** require a user JWT. Stripe calls it directly. It uses only the `STRIPE_WEBHOOK_SECRET` and the service role key.

**Events handled:**
- `checkout.session.completed` — link Stripe customer + subscription to tenant
- `customer.subscription.created` — initial subscription record
- `customer.subscription.updated` — plan changes, status changes
- `customer.subscription.deleted` — cancellations
- `invoice.paid` — confirm active status, update period end
- `invoice.payment_failed` — mark `past_due`

```typescript
// supabase/functions/stripe-webhook/index.ts

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const STRIPE_SECRET_KEY    = Deno.env.get("STRIPE_SECRET_KEY")        ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")   ?? "";
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")             ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-04-10" });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Map Stripe subscription status to our internal status values
function mapStatus(stripeStatus: Stripe.Subscription.Status): string {
  // Stripe statuses: trialing | active | past_due | canceled | unpaid | incomplete | incomplete_expired | paused
  // We surface all of them directly except we normalise 'incomplete_expired' -> 'canceled'
  if (stripeStatus === "incomplete_expired") return "canceled";
  return stripeStatus;
}

// Resolve plan name from a Stripe subscription's price metadata
function resolvePlan(subscription: Stripe.Subscription): string {
  const priceId = subscription.items.data[0]?.price?.id ?? "";
  const meta = subscription.items.data[0]?.price?.metadata ?? {};
  return meta["plan"] ?? inferPlanFromPriceId(priceId);
}

function inferPlanFromPriceId(priceId: string): string {
  if (priceId.includes("enterprise")) return "enterprise";
  if (priceId.includes("pro")) return "pro";
  return "starter";
}

function resolveBillingInterval(subscription: Stripe.Subscription): string {
  return subscription.items.data[0]?.plan?.interval ?? "month";
}

// Idempotently log a billing event; returns false if already processed
async function logBillingEvent(
  stripeEventId: string,
  tenantId: string | null,
  type: string,
  payload: unknown
): Promise<boolean> {
  const { error } = await supabase
    .from("billing_events")
    .insert({
      stripe_event_id: stripeEventId,
      tenant_id: tenantId,
      type,
      payload,
    });

  if (error) {
    if (error.code === "23505") {
      // unique_violation — already processed, skip
      console.log(`Skipping duplicate event: ${stripeEventId}`);
      return false;
    }
    throw error;
  }
  return true;
}

Deno.serve(async (req) => {
  // Webhooks use POST only; no CORS needed (Stripe server → server)
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // ── Signature verification ────────────────────────────────────────────────
  // IMPORTANT: use raw body bytes, not parsed JSON
  // See: https://docs.stripe.com/webhooks#verify-official-libraries
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    // stripe.webhooks.constructEventAsync is the Deno-compatible async variant
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return new Response(`Webhook error: ${(err as Error).message}`, { status: 400 });
  }

  console.log(`Received Stripe event: ${event.type} [${event.id}]`);

  try {
    await handleEvent(event);
  } catch (err) {
    // Log and return 500 — Stripe will retry
    console.error(`Error handling event ${event.id}:`, err);
    return new Response("Internal error", { status: 500 });
  }

  // Return 200 immediately; Stripe retries on non-2xx for up to 3 days
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// ── Event handlers ────────────────────────────────────────────────────────────

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await handleSubscriptionUpserted(event);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event);
      break;
    case "invoice.paid":
      await handleInvoicePaid(event);
      break;
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(event);
      break;
    default:
      // Unhandled event type — log and ignore
      console.log(`Unhandled event type: ${event.type}`);
  }
}

// ── checkout.session.completed ────────────────────────────────────────────────
// This is the moment we first learn which tenant a Stripe customer belongs to.
// We record the mapping and kick off the subscription upsert.
async function handleCheckoutCompleted(event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.mode !== "subscription") return;

  const tenantId = session.metadata?.tenant_id ?? null;
  if (!tenantId) {
    console.warn("checkout.session.completed missing tenant_id in metadata", session.id);
    return;
  }

  const isNew = await logBillingEvent(event.id, tenantId, event.type, session);
  if (!isNew) return;

  const customerId = typeof session.customer === "string"
    ? session.customer
    : session.customer?.id ?? null;

  const subscriptionId = typeof session.subscription === "string"
    ? session.subscription
    : (session.subscription as Stripe.Subscription)?.id ?? null;

  if (!subscriptionId) {
    console.warn("checkout.session.completed has no subscription_id", session.id);
    return;
  }

  // Fetch the full subscription to get status + plan
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price"],
  });

  await upsertSubscription(tenantId, subscription, customerId);
}

// ── customer.subscription.created / updated ───────────────────────────────────
async function handleSubscriptionUpserted(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const tenantId = subscription.metadata?.tenant_id ?? null;

  if (!tenantId) {
    // Try to resolve via subscriptions table (if checkout.session.completed already ran)
    const { data } = await supabase
      .from("subscriptions")
      .select("tenant_id")
      .eq("stripe_subscription_id", subscription.id)
      .maybeSingle();

    if (!data?.tenant_id) {
      console.warn(`${event.type}: cannot resolve tenant for subscription ${subscription.id}`);
      return;
    }

    const isNew = await logBillingEvent(event.id, data.tenant_id, event.type, subscription);
    if (!isNew) return;
    await upsertSubscription(data.tenant_id, subscription, null);
    return;
  }

  const isNew = await logBillingEvent(event.id, tenantId, event.type, subscription);
  if (!isNew) return;
  await upsertSubscription(tenantId, subscription, null);
}

// ── customer.subscription.deleted ─────────────────────────────────────────────
async function handleSubscriptionDeleted(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;

  const { data } = await supabase
    .from("subscriptions")
    .select("tenant_id")
    .eq("stripe_subscription_id", subscription.id)
    .maybeSingle();

  const tenantId = subscription.metadata?.tenant_id ?? data?.tenant_id ?? null;
  if (!tenantId) return;

  const isNew = await logBillingEvent(event.id, tenantId, event.type, subscription);
  if (!isNew) return;

  await supabase
    .from("subscriptions")
    .update({ status: "canceled", cancel_at_period_end: false })
    .eq("tenant_id", tenantId);
}

// ── invoice.paid ──────────────────────────────────────────────────────────────
async function handleInvoicePaid(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId = typeof invoice.subscription === "string"
    ? invoice.subscription
    : (invoice.subscription as Stripe.Subscription)?.id ?? null;

  if (!subscriptionId) return;

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("tenant_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (!sub?.tenant_id) return;

  const isNew = await logBillingEvent(event.id, sub.tenant_id, event.type, invoice);
  if (!isNew) return;

  // On a successful payment, ensure status is active and update period end
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await supabase
    .from("subscriptions")
    .update({
      status: "active",
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    })
    .eq("tenant_id", sub.tenant_id);
}

// ── invoice.payment_failed ────────────────────────────────────────────────────
async function handleInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId = typeof invoice.subscription === "string"
    ? invoice.subscription
    : (invoice.subscription as Stripe.Subscription)?.id ?? null;

  if (!subscriptionId) return;

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("tenant_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (!sub?.tenant_id) return;

  const isNew = await logBillingEvent(event.id, sub.tenant_id, event.type, invoice);
  if (!isNew) return;

  // Mark past_due; grace period and read-only enforcement is handled by the app (see §7)
  await supabase
    .from("subscriptions")
    .update({ status: "past_due" })
    .eq("tenant_id", sub.tenant_id);
}

// ── Shared upsert helper ──────────────────────────────────────────────────────
async function upsertSubscription(
  tenantId: string,
  subscription: Stripe.Subscription,
  customerId: string | null
): Promise<void> {
  const update: Record<string, unknown> = {
    tenant_id:              tenantId,
    stripe_subscription_id: subscription.id,
    status:                 mapStatus(subscription.status),
    plan:                   resolvePlan(subscription),
    billing_interval:       resolveBillingInterval(subscription),
    current_period_end:     new Date(subscription.current_period_end * 1000).toISOString(),
    cancel_at_period_end:   subscription.cancel_at_period_end,
    trial_ends_at:          subscription.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : null,
  };

  if (customerId) {
    update.stripe_customer_id = customerId;
  }

  const { error } = await supabase
    .from("subscriptions")
    .upsert(update, { onConflict: "tenant_id" });

  if (error) throw error;
  console.log(`Upserted subscription for tenant ${tenantId}: ${subscription.status} / ${update.plan}`);
}
```

### Registering the Webhook Endpoint

In Stripe Dashboard → **Developers → Webhooks → + Add endpoint**:

| Field | Value |
|---|---|
| Endpoint URL | `https://vmnhizmibdtlizigbzks.supabase.co/functions/v1/stripe-webhook` |
| Events to listen | `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed` |

Copy the **Signing secret** (`whsec_...`) and store as `STRIPE_WEBHOOK_SECRET` in Supabase secrets.

---

## 6. Trial + Onboarding Hook

### Design Decision

The trial is started at the Stripe level (not just a local flag) so that the 14-day countdown is managed by Stripe's billing engine. If a tenant never provides a payment method, Stripe automatically cancels the subscription — no cron job needed ([Stripe Docs — Free trials](https://docs.stripe.com/payments/checkout/free-trials)).

The onboarding wizard already tracks steps in `tenant_onboarding`. Step 6 is the last wizard step. When `finished_at` is written, the trial checkout starts.

### Wizard Step 6 Completion Handler

```javascript
// In your onboarding wizard JS, after saving step 6:

async function onOnboardingComplete(tenantId) {
  // Skip for demo tenant
  if (tenantId === DEMO_TENANT_ID) {
    window.location.href = "/app.html";
    return;
  }

  // Auto-start a 14-day Starter trial.
  // User can upgrade from the billing panel at any time.
  await startCheckout("price_starter_mo", /* trial= */ true);
  // startCheckout redirects to Stripe; user returns to /app.html?checkout=success
}
```

If you want to let users pick their plan *during* onboarding (before wizard step 6), add a plan selector at step 5 and store the selected `price_id` in local state, then call `startCheckout(selectedPriceId)` on step 6 completion.

### Trial-Ending Notifications

Two triggers send notifications as the trial approaches its end:

**Option A — Stripe email (recommended first):** In Stripe Dashboard → **Settings → Billing → Email**, enable "Send email 7 days before trial ends" and "Send email when trial ends." This requires no code.

**Option B — Custom email via the existing `notify` function** (for branded control):

Add a new event type `trial_warning` to the `notify` function's switch statement:

```typescript
// Addition to edge-notify/index.ts NotifyPayload interface:
//   type: "lead" | "signup" | "invite" | "test" | "trial_warning" | "trial_ended"
//   days_remaining?: number
//   tenant_name?: string
//   upgrade_url?: string

case "trial_warning": {
  const days = body.days_remaining ?? 7;
  const upgradeUrl = body.upgrade_url ?? `${APP_BASE}/app.html#billing`;
  const subject = `Your Stationly trial ends in ${days} day${days === 1 ? "" : "s"}`;
  const html = shell(
    `${days} day${days === 1 ? "" : "s"} left on your trial`,
    `<p style="color:#3d3830;line-height:1.6">
      Your free trial of Stationly for <strong>${escHtml(body.tenant_name ?? "your restaurant")}</strong>
      ends in <strong>${days} day${days === 1 ? "" : "s"}</strong>.
      Add your card now to keep uninterrupted access to your data.
    </p>
    <p style="margin:24px 0">
      <a href="${escHtml(upgradeUrl)}"
         style="background:#e8a33d;color:#1c1a15;padding:12px 22px;border-radius:999px;font-weight:600;text-decoration:none;display:inline-block">
        Upgrade now →
      </a>
    </p>
    <p style="color:#7a715f;font-size:13px;line-height:1.6">
      No credit card? No problem — you can start on our free Starter plan which requires no payment.
    </p>`
  );
  const text = `Your Stationly trial ends in ${days} days. Add your card: ${upgradeUrl}`;
  await sendMail({ to: body.email!, subject, html, text });
  return Response.json({ ok: true, sent: "trial_warning" }, { headers: cors });
}
```

**Trigger these emails** from a Supabase scheduled Edge Function (Deno cron) that runs daily and queries `subscriptions` for rows where `trial_ends_at` is 7 days or 1 day away. This keeps the notify function's call pattern consistent with existing usage.

---

## 7. Failure Handling

### Grace Period for `past_due`

When a payment fails, Stripe marks the subscription `past_due` and retries automatically (Smart Retries — typically 4 attempts over several days). We give 7 additional days before restricting access.

```javascript
// subscription-state.js — extend isSubscriptionActive()

const PAST_DUE_GRACE_DAYS = 7;

function isSubscriptionActive() {
  if (!_sub) return false;
  const { status } = _sub;

  if (status === "active" || status === "trialing") return true;

  if (status === "past_due") {
    // Allow if current_period_end + grace hasn't passed yet
    if (_sub.current_period_end) {
      const graceCutoff = new Date(_sub.current_period_end);
      graceCutoff.setDate(graceCutoff.getDate() + PAST_DUE_GRACE_DAYS);
      return new Date() < graceCutoff;
    }
    return true; // no period end stored, give benefit of the doubt
  }

  return false;
}
```

### App Boot Check

Called once per session after `loadSubscription()`. Controls the full-app read-only mode.

```javascript
// app.js — boot sequence

async function bootBillingCheck(tenantId) {
  const sub = await loadSubscription(tenantId);

  // Demo tenant is always active
  if (tenantId === DEMO_TENANT_ID) return;

  if (!sub) {
    // No subscription at all → show trial CTA (they may have just signed up)
    showBillingBanner("start-trial");
    return;
  }

  const { status } = sub;

  if (status === "trialing") {
    const trialEnd = sub.trial_ends_at ? new Date(sub.trial_ends_at) : null;
    if (trialEnd) {
      const daysLeft = Math.ceil((trialEnd - Date.now()) / 86400000);
      if (daysLeft <= 3) {
        showBillingBanner("trial-ending", { daysLeft });
      }
    }
    return; // trialing = full access
  }

  if (status === "past_due" && isSubscriptionActive()) {
    // Within grace period — show warning banner but allow access
    showBillingBanner("past-due-warning");
    return;
  }

  if (!isSubscriptionActive()) {
    // Subscription lapsed — enter read-only mode
    enableReadOnlyMode();
    showBillingBanner("subscription-lapsed");
  }
}

function enableReadOnlyMode() {
  // Disable all write actions
  document.querySelectorAll("[data-write-action]").forEach((el) => {
    el.setAttribute("disabled", "true");
    el.setAttribute("title", "Subscription required to make changes");
  });

  // Show global read-only banner
  document.getElementById("readonly-banner")?.removeAttribute("hidden");

  // Block form submissions
  document.querySelectorAll("form[data-protected]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      showBillingBanner("subscription-lapsed");
    });
  });
}

function showBillingBanner(type, data = {}) {
  const banner = document.getElementById("billing-banner");
  if (!banner) return;

  const messages = {
    "start-trial": "Start your 14-day free trial to unlock all features.",
    "trial-ending": `Your trial ends in ${data.daysLeft} day${data.daysLeft === 1 ? "" : "s"}. Add a card to keep going.`,
    "past-due-warning": "Your last payment failed. Please update your card to avoid losing access.",
    "subscription-lapsed": "Your subscription is inactive. Upgrade to restore full access.",
  };

  banner.querySelector("[data-message]").textContent = messages[type] ?? "";
  banner.removeAttribute("hidden");
  // Clicking the banner CTA opens billing panel or portal
}
```

### Demo Tenant Handling

The demo tenant row is seeded as `status: 'active'` with `current_period_end: 2099-12-31` (see §2). The `DEMO_TENANT_ID` constant is hardcoded in both the frontend (`subscription-state.js`) and edge functions (`stripe-checkout`, `stripe-portal`). The webhook function will never receive events for it since it has no Stripe subscription.

---

## 8. Rollout Checklist

### Environment Variables

Set all secrets via `supabase secrets set`. Never put these in source code or GitHub.

```bash
# Set Stripe keys (test mode)
supabase secrets set STRIPE_SECRET_KEY=sk_test_...
supabase secrets set STRIPE_PUBLISHABLE_KEY=pk_test_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...

# Verify they're set
supabase secrets list
```

Frontend needs `STRIPE_PUBLISHABLE_KEY` — since it's a static site, embed it in a `config.js` that is **not** committed to the public repo, or inject at deploy time. For GitHub Pages, store it as a GitHub Actions secret and inject via a build step:

```yaml
# .github/workflows/deploy.yml
- name: Write config
  run: |
    cat > config.js <<EOF
    window.APP_CONFIG = {
      supabaseUrl: "https://vmnhizmibdtlizigbzks.supabase.co",
      supabaseAnonKey: "${{ secrets.SUPABASE_ANON_KEY }}",
      stripePublishableKey: "${{ secrets.STRIPE_PUBLISHABLE_KEY }}"
    };
    EOF
```

Load `config.js` before `app.js` in `app.html`. Access via `window.APP_CONFIG.stripePublishableKey`.

### Required Supabase Secrets (full list for billing functions)

| Secret | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe API secret key (`sk_test_...` in test, `sk_live_...` in prod) |
| `STRIPE_WEBHOOK_SECRET` | Webhook endpoint signing secret (`whsec_...`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Already set; billing functions use this for DB writes |
| `SUPABASE_URL` | Already set |

### Deploy the Edge Functions

```bash
# From the repo root
supabase functions deploy stripe-checkout
supabase functions deploy stripe-portal
supabase functions deploy stripe-webhook

# Verify
supabase functions list
```

### Test-Mode QA Steps

Run these in order before touching live keys:

1. **Stripe CLI local testing**
   ```bash
   stripe listen --forward-to https://vmnhizmibdtlizigbzks.supabase.co/functions/v1/stripe-webhook
   # Use the whsec_ output as STRIPE_WEBHOOK_SECRET in your local .env
   ```

2. **Happy path — new signup → checkout → webhook:**
   - Sign up a test user, complete onboarding wizard through step 6
   - Confirm `stripe-checkout` redirects to Stripe Checkout page
   - Use Stripe test card `4242 4242 4242 4242` (any future expiry, any CVC)
   - Confirm `checkout.session.completed` webhook fires
   - Confirm `subscriptions` table has a new row with `status: trialing`
   - Confirm `billing_events` has the event logged

3. **Trial end simulation:**
   ```bash
   stripe subscriptions update sub_xxx --trial-end=now
   # Should trigger customer.subscription.updated with status=active (if card on file)
   # or status=canceled (if no card)
   ```

4. **Payment failure:**
   Use card `4000 0000 0000 0341` (always fails). Confirm `invoice.payment_failed` fires and `subscriptions.status` becomes `past_due`.

5. **Grace period check:**
   Set `current_period_end` to 3 days ago in the DB. Confirm the app still lets the user in (grace period). Set to 10 days ago — confirm read-only mode activates.

6. **Customer portal:**
   - Click "Manage billing" button
   - Confirm redirect to Stripe portal
   - Update card, cancel subscription, confirm webhook fires on cancellation

7. **Demo tenant:**
   - Log in as the demo tenant
   - Confirm no billing prompt appears, all features accessible
   - Confirm clicking "Manage billing" returns `demo_tenant_exempt` error (should be hidden in UI for demo)

8. **Idempotency:**
   ```bash
   # Resend the same webhook event twice
   stripe events resend evt_xxx --webhook-endpoint=we_xxx
   stripe events resend evt_xxx --webhook-endpoint=we_xxx
   # Second insert should be a no-op (unique constraint on stripe_event_id)
   # Check billing_events — only one row for that event ID
   ```

### Production Cutover

1. Create a new Stripe **live mode** restricted API key (not the full secret key) scoped to: Customers read/write, Checkout Sessions write, Subscriptions read/write, Billing Portal Sessions write, Invoices read, Webhook Endpoints read.
2. Recreate products and prices in live mode (run the setup script with `sk_live_...`).
3. Update `STRIPE_SECRET_KEY` in Supabase secrets to the live key.
4. Register a new webhook endpoint in Stripe live mode pointing to the same function URL.
5. Update `STRIPE_WEBHOOK_SECRET` to the new live signing secret.
6. Update `STRIPE_PUBLISHABLE_KEY` in the GitHub Actions secret to `pk_live_...`.
7. Re-deploy all three edge functions to pick up the updated secrets.
8. Run a live checkout with a real card and verify the DB updates.
9. Announce billing in the app (remove the "coming soon" badge from the billing panel if present).

---

## 9. Open Questions

These decisions should be made with the founder before implementation is finalized.

1. **Per-seat pricing add-on?** The current model is flat per-location. Consider whether to add a `$X/user/month` add-on above the base seat limits — this is common (7shifts charges $6/employee/month for Premium). It increases ARPU but adds pricing complexity and support burden. **Recommendation:** skip for v1, revisit at 50+ customers.

2. **Annual discount percentage?** We proposed 20% (pay 10 months, get 12). A 17% discount (2 months free, "2 months free" framing) may convert better than "20% off" — same amount, different psychological framing. Confirm before creating Stripe prices.

3. **Freemium tier?** A permanently-free tier (e.g., 1 location, 2 seats, basic scheduling only, no AI) reduces barrier to entry and allows word-of-mouth. The downside is support cost for non-paying users. **Recommendation:** use the 14-day trial as the freemium substitute — it's zero friction at signup but creates natural urgency.

4. **Multi-location billing model?** Currently Starter = 1 location, Pro = up to 3, Enterprise = unlimited. An alternative is per-location pricing (`$X/location/month`) which scales automatically. MarginEdge does this at $350/location. **Recommendation:** keep flat tiers for v1 (simpler Stripe setup); revisit per-location if multi-location customers represent >30% of signups.

5. **Trial card requirement?** Currently the trial uses `payment_method_collection: if_required`, meaning users can trial without adding a card (the subscription cancels at trial end if no card is added). Requiring a card upfront (`payment_method_collection: always`) improves trial-to-paid conversion but reduces trial starts. **Recommendation:** start without card required; add card requirement after measuring trial-to-paid conversion rate.

6. **Revenue recognition / accounting integration?** If Stationly will need to produce deferred revenue schedules (annual plans), Stripe Revenue Recognition (add-on) handles this automatically. Confirm whether the accountant needs this before go-live.

7. **Proration policy on plan upgrades?** Stripe's default is to prorate mid-cycle upgrades. Confirm whether you want prorated credit (default) or "change takes effect at next billing date" — both are configurable in the Customer Portal settings.

8. **Per-AI-feature usage billing?** The AI features on Pro/Enterprise are currently unlimited. If LLM costs become significant, a usage-based add-on (e.g., $0.10/AI Menu Optimizer run beyond a monthly cap) would be worth introducing via Stripe Usage Records. Flag this for review at 100+ Pro/Enterprise customers.

---

*This document is the single source of truth for the Stationly Stripe integration. Update it when decisions from §9 are resolved.*
