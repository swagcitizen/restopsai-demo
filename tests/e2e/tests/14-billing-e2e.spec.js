// @ts-check
// tests/e2e/tests/14-billing-e2e.spec.js
//
// End-to-end billing flow test for Stationly.
// Stripe is in TEST mode — uses 4242 card, no real money moves.
//
// Covers:
//   Stage 1 — New tenant signup creates a trial (subscriptions.status = 'trialing', 14 days)
//   Stage 2 — Billing tab renders; "Add a card" / "Add billing" hits stripe-checkout
//   Stage 3 — Stripe Checkout redirects to checkout.stripe.com
//   Stage 4 — Webhook (checkout.session.completed, invoice.paid, customer.subscription.created)
//             fires and updates subscriptions row with stripe_customer_id + stripe_subscription_id
//   Stage 5 — stripe-portal returns a Stripe Customer Portal URL
//
// Known issues documented in AUDIT-BILLING-E2E.md:
//   P0 — tenants.trial_ends_at default is 30 days but subscriptions.trial_ends_at (Stripe) is 14 days
//   P1 — tenants.stripe_customer_id / stripe_subscription_id are never synced (webhook writes subscriptions only)
//   P1 — Post-checkout return to #billing?status=success does not activate Billing view in the SPA
//   P2 — The checkout flow for a trial start requires no card (payment_method_collection: if_required)
//        so the Stripe 4242 card test scenario is not exercised in trial start; it applies only when
//        adding a card post-trial via the billing tab button ("Add a card")

const { test, expect } = require('@playwright/test');

const SUPABASE_URL = 'https://vmnhizmibdtlizigbzks.supabase.co';
const SUPABASE_ANON = 'sb_publishable_fBz-1MwcGCbytU_k4dXHQg_s1_2cIUd';
const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;

const TS = Date.now();
const TEST_EMAIL = `qa-billing-${TS}@example.com`;
const TEST_PASS = 'Test1234!';

// Helper: wait for hash to change (hash navigation is replaceState, not a page load)
async function waitForHash(page, step, timeout = 8000) {
  await page.waitForFunction(
    (n) => window.location.hash.includes(`step-${n}`),
    step,
    { timeout }
  ).catch(() => {});
}

// Helper: call Supabase RPC directly from Node
async function callRpc(accessToken, fnName, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) return null;
  return res.json();
}

// ── SUITE ────────────────────────────────────────────────────────────────────

test.describe('Stripe Billing E2E', () => {
  /** Shared state filled during the test run */
  let tenantId = null;
  let accessToken = null;

  // ── STAGE 1: Signup → trial state ────────────────────────────────────────
  test('Stage 1 — Signup creates tenant in trial state (14 days)', async ({ page }) => {
    test.setTimeout(120_000);

    // ── 1a. Sign up ──
    await page.goto('/signup.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASS);
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => location.pathname.includes('onboarding'), { timeout: 15_000 });

    // ── 1b. Onboarding (6 steps) ──
    // Step 1: Restaurant basics
    await page.waitForSelector('[data-pane="1"]:not([hidden])', { timeout: 10_000 });
    await page.fill('input[name="name"]', `Billing QA ${TS}`);
    await page.selectOption('select[name="restaurantType"]', 'pizzeria');
    await page.click('#btn-next');
    await waitForHash(page, 2);

    // Step 2: How you operate — no required fields
    await page.waitForSelector('[data-pane="2"]:not([hidden])', { timeout: 5_000 });
    await page.click('#btn-next');
    await waitForHash(page, 3);

    // Step 3: Invite team — skippable
    await page.waitForSelector('[data-pane="3"]:not([hidden])', { timeout: 5_000 });
    const skip3 = page.locator('#btn-skip');
    if (await skip3.isVisible().catch(() => false)) {
      await skip3.click();
    } else {
      await page.click('#btn-next');
    }
    await waitForHash(page, 4);

    // Step 4: Bring numbers — skippable
    await page.waitForSelector('[data-pane="4"]:not([hidden])', { timeout: 5_000 });
    const skip4 = page.locator('#btn-skip');
    if (await skip4.isVisible().catch(() => false)) {
      await skip4.click();
    } else {
      await page.click('#btn-next');
    }
    await waitForHash(page, 5);

    // Step 5: Compliance / Finish setup
    await page.waitForSelector('[data-pane="5"]:not([hidden])', { timeout: 5_000 });
    await page.click('#btn-next');
    await waitForHash(page, 6);

    // Step 6: go to app
    await page.waitForSelector('[data-pane="6"]:not([hidden])', { timeout: 5_000 });
    await page.evaluate(() => { window.location.href = './app.html'; });
    await page.waitForFunction(() => location.pathname.includes('app.html'), { timeout: 15_000 });
    await page.waitForTimeout(2000);

    // ── 1c. Get tenant ID and access token from page ──
    const sessionInfo = await page.evaluate(async () => {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      const sb = createClient(
        'https://vmnhizmibdtlizigbzks.supabase.co',
        'sb_publishable_fBz-1MwcGCbytU_k4dXHQg_s1_2cIUd'
      );
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return null;
      const { data: memberships } = await sb.from('memberships').select('tenant_id, role').eq('user_id', session.user.id);
      return { accessToken: session.access_token, memberships };
    });
    expect(sessionInfo).not.toBeNull();
    expect(sessionInfo.memberships?.length).toBeGreaterThan(0);
    tenantId = sessionInfo.memberships[0].tenant_id;
    accessToken = sessionInfo.accessToken;
    console.log(`Test tenant ID: ${tenantId}`);

    // ── 1d. Verify trial state in subscriptions table via get_my_billing_status ──
    const billingStatus = await page.evaluate(async (tid) => {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      const sb = createClient(
        'https://vmnhizmibdtlizigbzks.supabase.co',
        'sb_publishable_fBz-1MwcGCbytU_k4dXHQg_s1_2cIUd'
      );
      const { data } = await sb.rpc('get_my_billing_status', { p_tenant_id: tid });
      return data;
    }, tenantId);

    // Subscriptions row is seeded by trigger on tenant creation
    expect(billingStatus).not.toBeNull();
    expect(billingStatus.status).toBe('trialing');
    expect(billingStatus.access_ok).toBe(true);

    // Trial should end in ~14 days (± 1 day tolerance for test timing)
    const trialEndDays = (new Date(billingStatus.trial_ends_at) - Date.now()) / 86400000;
    expect(trialEndDays).toBeGreaterThan(12);
    expect(trialEndDays).toBeLessThan(15);

    // No Stripe customer yet (pre-checkout)
    expect(billingStatus.stripe_customer_id).toBeNull();
  });

  // ── STAGE 2: Billing tab renders properly ────────────────────────────────
  test('Stage 2 — Billing tab shows trial banner and subscribe button', async ({ page }) => {
    test.setTimeout(60_000);

    // Re-authenticate (new page context per test)
    await page.goto('/login.html', { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASS);
    await page.click('button[type="submit"], #login-btn');
    await page.waitForFunction(() => location.pathname.includes('app.html'), { timeout: 15_000 });
    await page.waitForTimeout(2000);

    // Navigate to billing
    await page.evaluate(() => { window.location.hash = '#billing'; });
    await page.waitForTimeout(2000);

    // Trial banner should be visible (from app.js / billingView.js)
    const trialBanner = page.locator('.billing-banner, .billing-banner-info, [class*="banner"]:has-text("Trial")');
    // Either the top banner or the in-billing banner
    const bannerText = await page.evaluate(() => document.body.innerText);
    expect(bannerText).toMatch(/trial/i);

    // Subscribe / Add billing button
    const subscribeBtn = page.locator(
      '#billing-start-btn, [data-billing-checkout], button:has-text("Add billing"), button:has-text("Add a card")'
    ).first();
    const subscribeBtnCount = await subscribeBtn.count();
    expect(subscribeBtnCount).toBeGreaterThan(0);
    console.log('Subscribe button found: ', await subscribeBtn.textContent().catch(() => 'n/a'));
  });

  // ── STAGE 3 + 4: Checkout redirect + webhook DB update ───────────────────
  test('Stage 3+4 — Checkout redirects to Stripe, webhook updates subscriptions row', async ({ page }) => {
    test.setTimeout(120_000);

    // Re-authenticate
    await page.goto('/login.html', { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASS);
    await page.click('button[type="submit"], #login-btn');
    await page.waitForFunction(() => location.pathname.includes('app.html'), { timeout: 15_000 });
    await page.waitForTimeout(2000);

    // Get tenant ID
    const sessionData = await page.evaluate(async () => {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      const sb = createClient(
        'https://vmnhizmibdtlizigbzks.supabase.co',
        'sb_publishable_fBz-1MwcGCbytU_k4dXHQg_s1_2cIUd'
      );
      const { data: { session } } = await sb.auth.getSession();
      const { data: memberships } = await sb.from('memberships').select('tenant_id').limit(1);
      return { token: session?.access_token, tenantId: memberships?.[0]?.tenant_id };
    });
    expect(sessionData.tenantId).toBeTruthy();
    const localTenantId = sessionData.tenantId;

    // Navigate to billing
    await page.evaluate(() => { window.location.hash = '#billing'; });
    await page.waitForTimeout(2000);

    // ── 3a. Click the subscribe button ──
    const subscribeBtn = page.locator(
      '[data-billing-checkout]:visible, #billing-start-btn:visible, button:has-text("Add billing"):visible'
    ).first();
    expect(await subscribeBtn.count()).toBeGreaterThan(0);

    const stripeNavPromise = page.waitForURL(/checkout\.stripe\.com|stripe\.com/, { timeout: 20_000 });
    await subscribeBtn.click();
    await stripeNavPromise;

    const checkoutUrl = page.url();
    console.log('Stripe checkout URL (first 80 chars):', checkoutUrl.substring(0, 80));
    expect(checkoutUrl).toMatch(/stripe\.com/);

    // ── 3b. Handle Stripe Checkout ──
    // Trial start uses payment_method_collection: "if_required" → no card required
    await page.waitForLoadState('load', { timeout: 20_000 });
    
    const submitBtn = page.locator('button[type="submit"]:visible').first();
    await expect(submitBtn).toBeVisible({ timeout: 10_000 });
    const submitText = await submitBtn.textContent();
    console.log('Stripe submit button:', submitText);

    // NOTE: If a card form IS visible (e.g. trial_period_days removed), fill it:
    // const cardFrames = page.frames().filter(f => f.url().includes('stripe.com'));
    // In the current config (trial with no card required), just click "Start trial"

    const returnPromise = page.waitForURL(/stationly\.ai/, { timeout: 30_000 });
    await submitBtn.click();
    await returnPromise;
    await page.waitForTimeout(2000);

    const postUrl = page.url();
    console.log('Post-checkout URL:', postUrl.substring(0, 100));
    expect(postUrl).toMatch(/stationly\.ai/);
    // Should include status=success
    expect(postUrl).toContain('status=success');

    // ── 4. Wait for webhook and verify DB ──
    // Webhook fires to https://vmnhizmibdtlizigbzks.supabase.co/functions/v1/stripe-webhook
    // Events: checkout.session.completed, customer.subscription.created, invoice.paid
    await page.waitForTimeout(8000); // give webhook time to fire and process

    const finalStatus = await page.evaluate(async (tid) => {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      const sb = createClient(
        'https://vmnhizmibdtlizigbzks.supabase.co',
        'sb_publishable_fBz-1MwcGCbytU_k4dXHQg_s1_2cIUd'
      );
      const { data } = await sb.rpc('get_my_billing_status', { p_tenant_id: tid });
      return data;
    }, localTenantId);

    console.log('Final billing status:', JSON.stringify(finalStatus));
    expect(finalStatus).not.toBeNull();
    expect(['trialing', 'active']).toContain(finalStatus.status);
    // stripe_customer_id and stripe_subscription_id must be set by webhook
    expect(finalStatus.stripe_customer_id).toBeTruthy();
    expect(finalStatus.stripe_subscription_id).toBeTruthy();
    expect(finalStatus.access_ok).toBe(true);
  });

  // ── STAGE 5: Billing portal ───────────────────────────────────────────────
  test('Stage 5 — stripe-portal returns a valid Stripe Customer Portal URL', async ({ page }) => {
    test.setTimeout(60_000);

    // Re-authenticate
    await page.goto('/login.html', { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASS);
    await page.click('button[type="submit"], #login-btn');
    await page.waitForFunction(() => location.pathname.includes('app.html'), { timeout: 15_000 });
    await page.waitForTimeout(2000);

    // Get session data
    const sessionData = await page.evaluate(async () => {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      const sb = createClient(
        'https://vmnhizmibdtlizigbzks.supabase.co',
        'sb_publishable_fBz-1MwcGCbytU_k4dXHQg_s1_2cIUd'
      );
      const { data: { session } } = await sb.auth.getSession();
      const { data: memberships } = await sb.from('memberships').select('tenant_id').limit(1);
      return { token: session?.access_token, tenantId: memberships?.[0]?.tenant_id };
    });

    expect(sessionData.token).toBeTruthy();
    expect(sessionData.tenantId).toBeTruthy();

    // Call stripe-portal edge function directly
    const portalRes = await page.evaluate(async ({ token, tenantId }) => {
      const res = await fetch('https://vmnhizmibdtlizigbzks.supabase.co/functions/v1/stripe-portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      return { status: res.status, data: await res.json() };
    }, { token: sessionData.token, tenantId: sessionData.tenantId });

    console.log('Portal response:', JSON.stringify(portalRes));
    expect(portalRes.status).toBe(200);
    expect(portalRes.data.url).toBeTruthy();
    expect(portalRes.data.url).toMatch(/billing\.stripe\.com/);

    // Navigate to portal and verify it loads
    await page.goto(portalRes.data.url, { waitUntil: 'load', timeout: 20_000 });
    await page.waitForTimeout(1000);
    const portalUrl = page.url();
    console.log('Portal page URL:', portalUrl.substring(0, 80));
    expect(portalUrl).toMatch(/stripe\.com/);

    // Verify portal shows subscription info
    const portalContent = await page.evaluate(() => document.body.innerText);
    expect(portalContent).toMatch(/subscription|plan|billing/i);
  });

  // ── REGRESSION: stripe-checkout blocks demo tenant ────────────────────────
  test('Regression — stripe-checkout rejects demo tenant with 400', async ({ page }) => {
    test.setTimeout(30_000);

    await page.goto('/login.html', { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASS);
    await page.click('button[type="submit"], #login-btn');
    await page.waitForFunction(() => location.pathname.includes('app.html'), { timeout: 15_000 });
    await page.waitForTimeout(1000);

    const token = await page.evaluate(async () => {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      const sb = createClient(
        'https://vmnhizmibdtlizigbzks.supabase.co',
        'sb_publishable_fBz-1MwcGCbytU_k4dXHQg_s1_2cIUd'
      );
      const { data: { session } } = await sb.auth.getSession();
      return session?.access_token;
    });

    const demoRes = await page.evaluate(async (token) => {
      const res = await fetch('https://vmnhizmibdtlizigbzks.supabase.co/functions/v1/stripe-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: 'a2e00ee7-1f30-4fbd-86b9-e560fc062f72', interval: 'month' }),
      });
      return { status: res.status, data: await res.json() };
    }, token);

    console.log('Demo tenant response:', JSON.stringify(demoRes));
    expect(demoRes.status).toBe(400);
    expect(demoRes.data.error).toContain('demo');
  });

  // ── REGRESSION: webhook requires stripe-signature ─────────────────────────
  test('Regression — stripe-webhook rejects requests without Stripe-Signature', async ({ page }) => {
    test.setTimeout(15_000);
    await page.goto('https://stationly.ai', { waitUntil: 'domcontentloaded' });

    const webhookRes = await page.evaluate(async () => {
      const res = await fetch('https://vmnhizmibdtlizigbzks.supabase.co/functions/v1/stripe-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'test', data: {} }),
      });
      return { status: res.status, data: await res.json() };
    });

    console.log('Webhook no-sig response:', JSON.stringify(webhookRes));
    expect(webhookRes.status).toBe(400);
    expect(webhookRes.data.error).toMatch(/stripe-signature|webhook secret/i);
  });
});
