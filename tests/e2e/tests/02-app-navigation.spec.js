// @ts-check
const { test, expect } = require('@playwright/test');

// Demo account is publicly known and intended for demos / e2e
const DEMO_EMAIL = process.env.STATIONLY_DEMO_EMAIL || 'demo@bellavita.app';
const DEMO_PW = process.env.STATIONLY_DEMO_PW || ''; // must be supplied via env to run

const ALL_VIEWS = [
  'overview', 'briefing', 'costs', 'recipes', 'sales', 'inventory',
  'invoices', 'labor', 'scheduler', 'clock', 'tasks', 'safety',
  'inspection', 'compliance', 'team', 'locations', 'alerts', 'billing',
];

test.describe('app navigation (signed in)', () => {
  test.skip(!DEMO_PW, 'STATIONLY_DEMO_PW env var not set — skipping signed-in nav tests');

  test.beforeEach(async ({ page }) => {
    await page.goto('/login.html');
    await page.fill('input[type="email"]', DEMO_EMAIL);
    await page.fill('input[type="password"]', DEMO_PW);
    await page.click('#login-btn');
    await page.waitForURL(/app\.html/, { timeout: 30_000 });
  });

  for (const view of ALL_VIEWS) {
    test(`tab loads: ${view}`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));

      const navBtn = page.locator(`.nav-item[data-view="${view}"]`);
      if (!(await navBtn.count())) {
        test.skip(true, `Nav item ${view} not present (role/permission may hide it)`);
        return;
      }
      await navBtn.click();
      await page.waitForTimeout(800);
      const section = page.locator(`section.view[data-view="${view}"]`);
      await expect(section).toBeVisible({ timeout: 10_000 });
      // No JS errors during render
      expect(errors, `JS errors while opening ${view}: ${errors.join('; ')}`).toEqual([]);
    });
  }

  test('alerts bell opens dropdown', async ({ page }) => {
    const bell = page.locator('#alerts-bell');
    if (!(await bell.count())) test.skip();
    await bell.click();
    await expect(page.locator('#alerts-list')).toBeVisible();
  });

  test('billing tab shows status card or empty state', async ({ page }) => {
    await page.locator('.nav-item[data-view="billing"]').click();
    await page.waitForTimeout(1500);
    const status = page.locator('#billing-status-card');
    const empty = page.locator('#billing-empty');
    const visible = (await status.isVisible().catch(() => false)) || (await empty.isVisible().catch(() => false));
    expect(visible).toBeTruthy();
  });
});
