// @ts-check
const { test, expect } = require('@playwright/test');

const PUBLIC_PAGES = [
  { path: '/', title: /Stationly/i },
  { path: '/login.html', title: /Sign|Stationly/i },
  { path: '/signup.html', title: /Sign|Stationly/i },
  { path: '/forgot-password.html', title: /Forgot|Stationly/i },
  { path: '/about.html', title: /About|Stationly/i },
];

for (const page of PUBLIC_PAGES) {
  test(`public page loads: ${page.path}`, async ({ page: p }) => {
    const res = await p.goto(page.path, { waitUntil: 'domcontentloaded' });
    expect(res?.status(), `HTTP status for ${page.path}`).toBeLessThan(400);
    await expect(p).toHaveTitle(page.title);
    // No JS errors in console
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.waitForLoadState('networkidle').catch(() => {});
    expect(errors, `JS errors on ${page.path}: ${errors.join('; ')}`).toEqual([]);
  });
}

test('PWA manifest is reachable and valid', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.status()).toBe(200);
  const json = await res.json();
  expect(json.name || json.short_name).toBeTruthy();
  expect(Array.isArray(json.icons) && json.icons.length).toBeTruthy();
  expect(json.start_url).toBeTruthy();
  expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(json.display);
});

test('Service worker is reachable', async ({ request }) => {
  const res = await request.get('/sw.js');
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toMatch(/self\.addEventListener/);
});

test('Service worker registers in browser', async ({ page }) => {
  await page.goto('/');
  const registered = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    // wait briefly for registration
    for (let i = 0; i < 20; i++) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  });
  expect(registered).toBeTruthy();
});
