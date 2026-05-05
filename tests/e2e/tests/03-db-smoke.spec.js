// @ts-check
const { test, expect } = require('@playwright/test');

const SUPABASE_URL = 'https://vmnhizmibdtlizigbzks.supabase.co';
const ANON = 'sb_publishable_fBz-1MwcGCbytU_k4dXHQg_s1_2cIUd';

// Use Playwright's request fixture to talk to PostgREST directly — avoids
// supabase-js's WebSocket dependency in Node 20.
const HEADERS = {
  apikey: ANON,
  Authorization: `Bearer ${ANON}`,
  'Content-Type': 'application/json',
};

async function selectAnon(request, table) {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`, {
    headers: HEADERS,
    failOnStatusCode: false,
  });
  return { status: res.status(), body: await res.text() };
}

async function rpcAnon(request, fn, body = {}) {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    headers: HEADERS,
    data: body,
    failOnStatusCode: false,
  });
  return { status: res.status(), body: await res.text() };
}

test('anon cannot read tenants (RLS blocks)', async ({ request }) => {
  const r = await selectAnon(request, 'tenants');
  // Either 200 with [] or 4xx
  if (r.status === 200) {
    expect(JSON.parse(r.body)).toEqual([]);
  } else {
    expect(r.status).toBeGreaterThanOrEqual(400);
  }
});

test('anon cannot read memberships', async ({ request }) => {
  const r = await selectAnon(request, 'memberships');
  if (r.status === 200) expect(JSON.parse(r.body)).toEqual([]);
  else expect(r.status).toBeGreaterThanOrEqual(400);
});

test('anon cannot read time_clock_punches', async ({ request }) => {
  const r = await selectAnon(request, 'time_clock_punches');
  if (r.status === 200) expect(JSON.parse(r.body)).toEqual([]);
  else expect(r.status).toBeGreaterThanOrEqual(400);
});

test('anon cannot read invoices', async ({ request }) => {
  const r = await selectAnon(request, 'invoices');
  if (r.status === 200) expect(JSON.parse(r.body)).toEqual([]);
  else expect(r.status).toBeGreaterThanOrEqual(400);
});

test('anon cannot read employees', async ({ request }) => {
  const r = await selectAnon(request, 'employees');
  if (r.status === 200) expect(JSON.parse(r.body)).toEqual([]);
  else expect(r.status).toBeGreaterThanOrEqual(400);
});

test('anon cannot read temperature_logs', async ({ request }) => {
  const r = await selectAnon(request, 'temperature_logs');
  if (r.status === 200) expect(JSON.parse(r.body)).toEqual([]);
  else expect(r.status).toBeGreaterThanOrEqual(400);
});

test('anon CAN call invite_preview RPC (intentional, signup flow)', async ({ request }) => {
  const r = await rpcAnon(request, 'invite_preview', { _token: 'definitely-not-a-real-token' });
  // Should not be 401/403 (permission denied)
  expect([401, 403]).not.toContain(r.status);
});

test('anon CANNOT call internal RPC is_tenant_member', async ({ request }) => {
  const r = await rpcAnon(request, 'is_tenant_member', { _tenant_id: '00000000-0000-0000-0000-000000000000' });
  expect(r.status).toBeGreaterThanOrEqual(400);
});

test('anon CANNOT call internal RPC platform_list_tenants', async ({ request }) => {
  const r = await rpcAnon(request, 'platform_list_tenants', {});
  expect(r.status).toBeGreaterThanOrEqual(400);
});

test('anon CANNOT call internal RPC tenant_role', async ({ request }) => {
  const r = await rpcAnon(request, 'tenant_role', { _tenant_id: '00000000-0000-0000-0000-000000000000' });
  expect(r.status).toBeGreaterThanOrEqual(400);
});

test('anon CANNOT call internal RPC mark_alert_read', async ({ request }) => {
  const r = await rpcAnon(request, 'mark_alert_read', { p_alert_id: '00000000-0000-0000-0000-000000000000' });
  expect(r.status).toBeGreaterThanOrEqual(400);
});
