// @ts-check
// Offline write queue end-to-end flow.
//
// Verifies the IndexedDB-backed sync queue + connection-status pill: when the
// app goes offline, a write through dataRepo is enqueued and the pill flips
// to "Offline" with a pending count. When the network returns, the queue
// flushes within ~15s and the inserted row survives a reload.
//
// Skipped unless STATIONLY_DEMO_PW is set (signed-in flow required).

const { test, expect } = require('@playwright/test');

const DEMO_EMAIL = process.env.STATIONLY_DEMO_EMAIL || 'demo@bellavita.app';
const DEMO_PW = process.env.STATIONLY_DEMO_PW || '';

test.describe('offline write queue', () => {
  test.skip(!DEMO_PW, 'STATIONLY_DEMO_PW env var not set — skipping offline flow test');

  test('queues an inventory insert offline and syncs when back online', async ({ page, context }) => {
    // 1. Sign in via the public login page.
    await page.goto('/login.html');
    await page.fill('input[type="email"]', DEMO_EMAIL);
    await page.fill('input[type="password"]', DEMO_PW);
    await page.click('#login-btn');
    await page.waitForURL(/app\.html/, { timeout: 30_000 });

    // 2. Wait for boot to complete and connection pill to mount.
    await page.waitForFunction(() => window.__restopsBooted === true, null, { timeout: 30_000 });
    await page.waitForSelector('.connection-pill', { state: 'attached', timeout: 10_000 });

    // 3. Navigate to Inventory tab.
    await page.locator('.nav-item[data-view="inventory"]').click();
    await page.waitForSelector('section.view[data-view="inventory"]', { state: 'visible' });

    // 4. Go offline.
    await context.setOffline(true);
    // Give the connection-status watcher a moment to flip the pill.
    await page.waitForFunction(
      () => document.querySelector('.connection-pill')?.classList.contains('connection-offline'),
      null,
      { timeout: 10_000 }
    );

    // 5. Insert an inventory item via the repo (offline path).
    const uniqueName = `OfflineTest_${Date.now()}`;
    await page.evaluate(async ({ name }) => {
      const repo = window.__restopsRepos?.dataRepo;
      if (!repo) throw new Error('dataRepo not exposed');
      await repo.addInventoryItem({
        name,
        unit: 'lb',
        onHand: 5,
        par: 10,
        cost: 1.23,
        vendor: null,
      });
    }, { name: uniqueName });

    // 6. Pill should show pending badge ≥ 1.
    await page.waitForFunction(() => {
      const badge = document.querySelector('.connection-pill .connection-badge');
      return badge && parseInt(badge.textContent || '0', 10) >= 1;
    }, null, { timeout: 5_000 });

    const pillText = await page.locator('.connection-pill').first().textContent();
    expect(pillText?.toLowerCase()).toContain('offline');

    // 7. Restore network.
    await context.setOffline(false);

    // 8. Wait for the queue to drain (pending = 0 and pill returns to online).
    await page.waitForFunction(() => {
      const pill = document.querySelector('.connection-pill');
      if (!pill) return false;
      const isOnline = pill.classList.contains('connection-online');
      const badge = pill.querySelector('.connection-badge');
      const pending = badge ? parseInt(badge.textContent || '0', 10) : 0;
      return isOnline && pending === 0;
    }, null, { timeout: 20_000 });

    // 9. Reload and verify the row survives (was actually persisted to Supabase).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__restopsBooted === true, null, { timeout: 30_000 });
    await page.locator('.nav-item[data-view="inventory"]').click();
    await page.waitForSelector('section.view[data-view="inventory"]', { state: 'visible' });

    const persisted = await page.evaluate(({ name }) => {
      const inv = window.__restopsState?.inv || [];
      return inv.some(i => i.name === name);
    }, { name: uniqueName });

    expect(persisted, `Inserted offline row "${uniqueName}" should persist after reload`).toBe(true);
  });
});
