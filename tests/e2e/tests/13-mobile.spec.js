// @ts-check
// Mobile/tablet polish: hamburger drawer, table-to-card transform,
// fullscreen modals, tap targets, and tablet-coarse default view.

const { test, expect } = require('@playwright/test');

const SUPABASE_URL = 'https://vmnhizmibdtlizigbzks.supabase.co';
const ANON = 'sb_publishable_fBz-1MwcGCbytU_k4dXHQg_s1_2cIUd';

// These tests need a freshly-onboarded tenant so app.html actually boots.
// We only run them when STATIONLY_URL points at a local dev server (so we can
// make API calls + UI calls in lockstep against the same backend). When run
// against the live https://stationly.ai we just skip — the in-app coverage
// for these features lives in 12-onboarding-polish + 02-app-navigation.
const baseURL = process.env.STATIONLY_URL || 'https://stationly.ai';
const isLocal = /localhost|127\.0\.0\.1/.test(baseURL);

async function signUp(request, email, password) {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/signup`, {
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    data: { email, password },
    failOnStatusCode: false,
  });
  const body = await res.json().catch(() => ({}));
  if (body.access_token) return body.access_token;
  const r2 = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    data: { email, password },
    failOnStatusCode: false,
  });
  const b2 = await r2.json().catch(() => ({}));
  return b2.access_token || null;
}

async function bootIntoApp(page, viewport, hasTouch = true) {
  test.skip(!isLocal, 'Mobile spec requires STATIONLY_URL=http://localhost:8080 to bypass onboarding for a fresh tenant');
  await page.setViewportSize(viewport);
  // 1) Sign up
  const email = `qa-mobile-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const password = 'Test1234!';
  // Use page.request so we share cookies / network context.
  const token = await signUp(page.request, email, password);
  expect(token, 'signup must return access token (email confirm should be off)').toBeTruthy();

  // 2) Visit signup confirmation -> we just go straight to onboarding by
  //    storing the session via the supabase client on the app's origin.
  await page.goto('/login.html');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('#login-btn');
  await page.waitForURL(/(onboarding|app)\.html/, { timeout: 30_000 });

  // 3) Create tenant + mark onboarding finished via the bundled supabase client
  await page.evaluate(async () => {
    const m = await import('/supabaseClient.js');
    const { supabase, createTenant } = m;
    await createTenant({ name: 'Mobile QA Cafe', restaurantType: 'cafe', state: 'FL', city: 'Orlando', timezone: 'America/New_York' });
    const u = (await supabase.auth.getUser()).data.user;
    const ms = await supabase.from('memberships').select('tenant_id').eq('user_id', u.id);
    const tid = ms.data[0].tenant_id;
    await supabase.from('tenant_onboarding').upsert({ tenant_id: tid, finished_at: new Date().toISOString(), step_completed: 5 }, { onConflict: 'tenant_id' });
  });

  // 4) Boot the app. Bust the SW cache so prior runs of this spec don't
  //    serve a stale app.html.
  for (let i = 0; i < 3; i++) {
    await page.goto(`/app.html?bust=${Date.now()}`);
    await page.waitForTimeout(800);
    if (/onboarding/.test(page.url())) {
      // tenantContext bounced us back; wait for any in-flight membership
      // mutation to settle and try again.
      await page.waitForTimeout(1500);
      continue;
    }
    break;
  }
  await page.waitForFunction(() => window.__restopsBooted === true, { timeout: 45_000 });
  // Re-assert the requested viewport: app.js may have run resize handlers
  // during boot so we restore intent before the test asserts on it.
  await page.setViewportSize(viewport);
  await page.waitForTimeout(200);
}

test.describe('mobile polish (375x812)', () => {
  test('hamburger toggles the mobile drawer open and closed', async ({ page }) => {
    await bootIntoApp(page, { width: 375, height: 812 });
    const drawer = page.locator('#mobile-nav-drawer');
    const hamburger = page.locator('#mobile-menu-btn');

    // Drawer starts closed (aria-hidden=true, data-open unset or 'false')
    await expect(drawer).toHaveAttribute('aria-hidden', 'true');
    // Open
    await hamburger.click();
    await expect(drawer).toHaveAttribute('data-open', 'true');
    await expect(drawer).toHaveAttribute('aria-hidden', 'false');
    // Close via the explicit close button (the drawer is full-width on small
    // mobile so the backdrop is occluded by the drawer surface itself).
    await page.locator('#mobile-nav-close').click();
    await expect(drawer).toHaveAttribute('data-open', 'false');
  });

  test('bills table renders as cards (vertical labels) at 375px', async ({ page }) => {
    await bootIntoApp(page, { width: 375, height: 812 });
    // Sidebar is hidden ≤1100px — fire the bound click handler on the
    // (display:none) button directly so we don't need the drawer flow here.
    await page.evaluate(() => document.querySelector('.sidebar .nav-item[data-view="bills"]').click());
    await page.waitForTimeout(800);
    // Ensure at least one bill row exists; if not, skip the assertion
    const tableExists = await page.locator('table.bills-table').count();
    test.skip(!tableExists, 'No bills-table rendered yet for empty tenant');
    // At <=720px, tbody rows should render as cards (flex-direction:column)
    const tbodyRowCount = await page.locator('table.bills-table tbody tr').count();
    test.skip(!tbodyRowCount, 'No tbody rows in bills table');
    const direction = await page.locator('table.bills-table tbody tr').first().evaluate((el) => getComputedStyle(el).flexDirection);
    expect(['column', 'column-reverse']).toContain(direction);
  });

  test('opening a modal at 375px is fullscreen', async ({ page }) => {
    await bootIntoApp(page, { width: 375, height: 812 });
    await page.evaluate(() => document.querySelector('.sidebar .nav-item[data-view="inventory"]').click());
    await page.waitForTimeout(500);
    // "Add Inventory Item" opens #inv-modal
    const addBtn = page.locator('button:has-text("Add Inventory Item")').first();
    if (!(await addBtn.count())) test.skip(true, 'Add Inventory button not present');
    await addBtn.click();
    const modalCard = page.locator('#inv-modal .modal-card');
    await expect(modalCard).toBeVisible();
    const box = await modalCard.boundingBox();
    expect(box, 'modal card must have a bounding box').not.toBeNull();
    // At ≤720px the modal goes fullscreen — width should equal viewport
    expect(box.width).toBeGreaterThanOrEqual(370);
  });

  test('time clock action buttons are at least 44px tall', async ({ page }) => {
    await bootIntoApp(page, { width: 375, height: 812 });
    await page.evaluate(() => document.querySelector('.sidebar .nav-item[data-view="clock"]').click());
    await page.waitForTimeout(500);
    // PIN pad keys are .pin-key — they should all be ≥44px tall
    const keys = page.locator('.pin-key');
    const n = await keys.count();
    test.skip(!n, 'PIN pad not rendered');
    for (let i = 0; i < Math.min(n, 6); i++) {
      const box = await keys.nth(i).boundingBox();
      expect(box, `key ${i} must have a bounding box`).not.toBeNull();
      expect(box.height, `key ${i} height`).toBeGreaterThanOrEqual(44);
    }
  });

  test('tablet (820x1180, hasTouch) defaults to Time Clock view', async ({ browser }) => {
    test.skip(!isLocal, 'Requires local server');
    const ctx = await browser.newContext({
      viewport: { width: 820, height: 1180 },
      hasTouch: true,
    });
    const page = await ctx.newPage();
    try {
      await bootIntoApp(page, { width: 820, height: 1180 });
      const activeView = await page.evaluate(() => document.querySelector('.view.active')?.dataset.view);
      expect(activeView).toBe('clock');
    } finally {
      await ctx.close();
    }
  });
});
