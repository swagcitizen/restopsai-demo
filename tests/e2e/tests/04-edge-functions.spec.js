// @ts-check
const { test, expect } = require('@playwright/test');

const SUPABASE_URL = 'https://vmnhizmibdtlizigbzks.supabase.co';
const ANON = 'sb_publishable_fBz-1MwcGCbytU_k4dXHQg_s1_2cIUd';

// Verified deployed edge function slugs (from list_edge_functions). For each,
// we hit it with no payload and assert it does NOT 404 and does NOT 5xx-crash.
const FUNCTIONS = [
  'ocr-invoice',
  'send-schedule-sms',
  'pnl-upload-url',
  'pnl-parse',
  'pnl-confirm',
  'admin-purge-chase',
  'notify',
  'stripe-checkout',
  'stripe-update-quantity',
  'stripe-webhook',
  'alerts-dispatch',
  'daily-briefing',
  'pos-oauth-start',
  'pos-oauth-callback',
  'pos-sync-runner',
  'invoice-variance-check',
  'stripe-portal',
];

for (const fn of FUNCTIONS) {
  test(`edge function reachable: ${fn}`, async ({ request }) => {
    const res = await request.post(`${SUPABASE_URL}/functions/v1/${fn}`, {
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
        'Content-Type': 'application/json',
      },
      data: {},
      failOnStatusCode: false,
    });
    // Endpoint exists (not 404) and didn't crash (no 5xx)
    expect(res.status(), `${fn} returned ${res.status()}`).not.toBe(404);
    expect(res.status(), `${fn} returned ${res.status()}`).toBeLessThan(500);
  });
}

test('stripe-webhook rejects unsigned payloads', async ({ request }) => {
  const res = await request.post(`${SUPABASE_URL}/functions/v1/stripe-webhook`, {
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    data: { fake: 'event' },
    failOnStatusCode: false,
  });
  expect([400, 401, 403, 422]).toContain(res.status());
});

test('pos-oauth-callback exists and handles missing params gracefully', async ({ request }) => {
  const res = await request.get(`${SUPABASE_URL}/functions/v1/pos-oauth-callback`, {
    headers: { apikey: ANON },
    failOnStatusCode: false,
  });
  // Should be a redirect or 4xx — not 5xx
  expect(res.status()).toBeLessThan(500);
  expect(res.status()).not.toBe(404);
});
