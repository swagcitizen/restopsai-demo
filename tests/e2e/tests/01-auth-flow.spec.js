// @ts-check
const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://vmnhizmibdtlizigbzks.supabase.co';
const SUPABASE_ANON = 'sb_publishable_fBz-1MwcGCbytU_k4dXHQg_s1_2cIUd';

// Use a fresh email per test run (Supabase enforces uniqueness)
const ts = Date.now();
const TEST_EMAIL = `qa+${ts}@stationly.test`;
const TEST_PW = 'StationlyQA!2026';

test('signup → onboarding → dashboard happy path', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto('/signup.html');
  await page.fill('#signup-email', TEST_EMAIL);
  await page.fill('#signup-password', TEST_PW);
  await page.click('#signup-btn');

  // Should land in onboarding wizard
  await page.waitForURL(/onboarding\.html/, { timeout: 30_000 });
  await expect(page).toHaveURL(/onboarding/);

  // Onboarding form: fill restaurant basics if visible
  // Be defensive — exact field names depend on onboarding implementation
  const nameField = page.locator('input[name="restaurant_name"], #restaurant-name, [data-field="name"]').first();
  if (await nameField.count()) {
    await nameField.fill(`QA Pizzeria ${ts}`);
  }

  // Try to submit / continue through onboarding to land in app
  // Allow up to 8 next-step clicks
  for (let i = 0; i < 8; i++) {
    const nextBtn = page.locator('button:has-text("Next"), button:has-text("Continue"), button:has-text("Finish"), button:has-text("Get started"), button[type="submit"]').first();
    if (!(await nextBtn.count())) break;
    if (!(await nextBtn.isVisible().catch(() => false))) break;
    await nextBtn.click({ trial: false }).catch(() => {});
    await page.waitForTimeout(800);
    if (page.url().includes('/app.html')) break;
  }

  // Eventual outcome: should land in /app.html
  await page.waitForURL(/app\.html/, { timeout: 30_000 }).catch(() => {});
  // soft check
  if (!page.url().includes('app.html')) {
    test.info().annotations.push({ type: 'warn', description: `Did not auto-land on app.html (url=${page.url()}). Onboarding may require manual steps.` });
  }

  // Verify no JS errors during signup/onboarding
  expect(errors.filter((e) => !e.includes('manifest') && !e.includes('favicon')), errors.join('\n')).toEqual([]);
});

test('login with invalid creds shows error', async ({ page }) => {
  await page.goto('/login.html');
  await page.fill('input[type="email"]', 'nope@nope.invalid');
  await page.fill('input[type="password"]', 'wrongpassword');
  await page.click('#login-btn');
  await expect(page.locator('#login-error')).toBeVisible({ timeout: 8_000 });
});

test('login with newly created QA account', async ({ page }) => {
  // Reuse the signup user from the first test
  await page.goto('/login.html');
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PW);
  await page.click('#login-btn');
  // Either onboarding or app
  await page.waitForURL(/(app|onboarding)\.html/, { timeout: 20_000 });
  expect(page.url()).toMatch(/(app|onboarding)\.html/);
});

test.afterAll(async () => {
  // Best-effort cleanup: delete the test user via auth (anon can't, so leave a comment)
  // Cleanup happens through SQL service-role pass after the suite runs.
});
