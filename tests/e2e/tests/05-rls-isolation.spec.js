// @ts-check
const { test, expect } = require('@playwright/test');

const SUPABASE_URL = 'https://vmnhizmibdtlizigbzks.supabase.co';
const ANON = 'sb_publishable_fBz-1MwcGCbytU_k4dXHQg_s1_2cIUd';

async function signUp(request, email, password) {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/signup`, {
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    data: { email, password },
    failOnStatusCode: false,
  });
  const body = await res.json().catch(() => ({}));
  if (!body.access_token) {
    // Project may require email confirmation — try sign in instead (if confirmation auto-flips)
    const r2 = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      data: { email, password },
      failOnStatusCode: false,
    });
    const b2 = await r2.json().catch(() => ({}));
    return b2.access_token || null;
  }
  return body.access_token;
}

async function rpc(request, token, fn, args) {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: args,
    failOnStatusCode: false,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status(), data: json };
}

async function select(request, token, table, query = '') {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
    },
    failOnStatusCode: false,
  });
  const json = await res.json().catch(() => []);
  return { status: res.status(), data: json };
}

async function insert(request, token, table, row) {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/${table}`, {
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    data: row,
    failOnStatusCode: false,
  });
  return { status: res.status(), text: await res.text() };
}

test('RLS isolation: tenant A cannot read or write tenant B data', async ({ request }) => {
  test.setTimeout(120_000);

  const ts = Date.now();
  const emailA = `qa+rlsA${ts}@stationly.test`;
  const emailB = `qa+rlsB${ts + 1}@stationly.test`;
  const password = 'StationlyQA!2026';

  const tokenA = await signUp(request, emailA, password);
  const tokenB = await signUp(request, emailB, password);

  test.skip(!tokenA || !tokenB, 'Sign-up did not return access token (email confirmation may be required)');

  const { data: tA, status: sA } = await rpc(request, tokenA, 'create_tenant_and_membership', {
    _name: `QA Tenant A ${ts}`, _restaurant_type: 'pizza', _state: 'FL', _city: 'Orlando', _timezone: 'America/New_York',
  });
  expect(sA, `Tenant A creation failed: ${JSON.stringify(tA)}`).toBeLessThan(300);
  const tenantA = typeof tA === 'string' ? tA : (tA?.id || tA?.tenant_id || tA);

  const { data: tB, status: sB } = await rpc(request, tokenB, 'create_tenant_and_membership', {
    _name: `QA Tenant B ${ts}`, _restaurant_type: 'pizza', _state: 'FL', _city: 'Tampa', _timezone: 'America/New_York',
  });
  expect(sB, `Tenant B creation failed: ${JSON.stringify(tB)}`).toBeLessThan(300);
  const tenantB = typeof tB === 'string' ? tB : (tB?.id || tB?.tenant_id || tB);

  expect(tenantA, 'tenantA missing').toBeTruthy();
  expect(tenantB, 'tenantB missing').toBeTruthy();

  // Cross-tenant read attempts
  const leak1 = await select(request, tokenB, 'tenants', `id=eq.${tenantA}&select=id`);
  expect(Array.isArray(leak1.data) ? leak1.data.length : 1, 'B leaked A tenant').toBe(0);

  const leak2 = await select(request, tokenA, 'memberships', `tenant_id=eq.${tenantB}&select=id`);
  expect(Array.isArray(leak2.data) ? leak2.data.length : 1, 'A leaked B memberships').toBe(0);

  // Cross-tenant write attempt
  const writeAttempt = await insert(request, tokenB, 'temperature_logs', {
    tenant_id: tenantA,
    location: 'walkin',
    temperature_f: 38,
    logged_at: new Date().toISOString(),
  });
  expect(writeAttempt.status, `Cross-tenant write should be blocked, got ${writeAttempt.status}: ${writeAttempt.text}`).toBeGreaterThanOrEqual(400);
});
