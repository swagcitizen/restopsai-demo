// @ts-check
// Bill Pay AP: vendor + bill + approve + partial/final payments, aging, RLS.

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
  if (body.access_token) return body.access_token;
  const r2 = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    data: { email, password },
    failOnStatusCode: false,
  });
  const b2 = await r2.json().catch(() => ({}));
  return b2.access_token || null;
}

async function rpc(request, token, fn, args) {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: args,
    failOnStatusCode: false,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status(), data: json };
}

async function insert(request, token, table, row) {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/${table}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    data: row,
    failOnStatusCode: false,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status(), data: json };
}

async function select(request, token, table, query = '') {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    failOnStatusCode: false,
  });
  const json = await res.json().catch(() => []);
  return { status: res.status(), data: json };
}

test('bill pay: vendor + bill + approve + payments + aging + RLS', async ({ request }) => {
  test.setTimeout(180_000);

  const ts = Date.now();
  const emailA = `qa+billA${ts}@stationly.test`;
  const emailB = `qa+billB${ts + 1}@stationly.test`;
  const password = 'StationlyQA!2026';

  const tokenA = await signUp(request, emailA, password);
  const tokenB = await signUp(request, emailB, password);
  test.skip(!tokenA || !tokenB, 'Sign-up did not return access token (email confirmation may be required)');

  const tA = await rpc(request, tokenA, 'create_tenant_and_membership', {
    _name: `QA Bills A ${ts}`, _restaurant_type: 'pizza', _state: 'FL', _city: 'Orlando', _timezone: 'America/New_York',
  });
  expect(tA.status).toBeLessThan(300);
  const tenantA = typeof tA.data === 'string' ? tA.data : (tA.data?.id || tA.data?.tenant_id || tA.data);

  const tB = await rpc(request, tokenB, 'create_tenant_and_membership', {
    _name: `QA Bills B ${ts}`, _restaurant_type: 'pizza', _state: 'FL', _city: 'Tampa', _timezone: 'America/New_York',
  });
  expect(tB.status).toBeLessThan(300);
  const tenantB = typeof tB.data === 'string' ? tB.data : (tB.data?.id || tB.data?.tenant_id || tB.data);

  // 1. Create vendor
  const vRes = await insert(request, tokenA, 'vendors', {
    tenant_id: tenantA,
    name: `Sysco ${ts}`,
    email: 'ap@sysco.test',
    default_payment_method: 'check',
    default_terms_days: 30,
  });
  expect(vRes.status, JSON.stringify(vRes.data)).toBeLessThan(300);
  const vendorId = (Array.isArray(vRes.data) ? vRes.data[0] : vRes.data).id;

  // 2. Create bill, $1500
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const due30 = new Date(today.getTime() + 30 * 86400 * 1000).toISOString().slice(0, 10);
  const bRes = await insert(request, tokenA, 'bills', {
    tenant_id: tenantA, vendor_id: vendorId,
    bill_number: `INV-${ts}`, bill_date: todayIso, due_date: due30,
    amount: 1500, amount_paid: 0, status: 'open', approval_status: 'pending',
  });
  expect(bRes.status, JSON.stringify(bRes.data)).toBeLessThan(300);
  const billId = (Array.isArray(bRes.data) ? bRes.data[0] : bRes.data).id;

  // 3. Approve
  const approveRes = await rpc(request, tokenA, 'approve_bill', { p_bill_id: billId });
  expect(approveRes.status, `approve: ${JSON.stringify(approveRes.data)}`).toBeLessThan(300);
  let billCheck = await select(request, tokenA, 'bills', `id=eq.${billId}&select=approval_status,approved_at`);
  expect(billCheck.data[0].approval_status).toBe('approved');

  // 4. Partial payment $500
  const pay1 = await rpc(request, tokenA, 'record_bill_payment', {
    p_bill_id: billId, p_amount: 500, p_method: 'check', p_payment_date: todayIso, p_reference: 'CHK1001',
  });
  expect(pay1.status, `pay1: ${JSON.stringify(pay1.data)}`).toBeLessThan(300);
  billCheck = await select(request, tokenA, 'bills', `id=eq.${billId}&select=amount_paid,status`);
  expect(Number(billCheck.data[0].amount_paid)).toBeCloseTo(500, 2);
  expect(billCheck.data[0].status).toBe('partial');

  // 5. Final payment $1000
  const pay2 = await rpc(request, tokenA, 'record_bill_payment', {
    p_bill_id: billId, p_amount: 1000, p_method: 'check', p_payment_date: todayIso, p_reference: 'CHK1002',
  });
  expect(pay2.status, `pay2: ${JSON.stringify(pay2.data)}`).toBeLessThan(300);
  billCheck = await select(request, tokenA, 'bills', `id=eq.${billId}&select=amount_paid,status`);
  expect(Number(billCheck.data[0].amount_paid)).toBeCloseTo(1500, 2);
  expect(billCheck.data[0].status).toBe('paid');

  // 6. Aging bucket — insert a 2nd bill that's 45 days overdue
  const due45ago = new Date(today.getTime() - 45 * 86400 * 1000).toISOString().slice(0, 10);
  const bill45 = await insert(request, tokenA, 'bills', {
    tenant_id: tenantA, vendor_id: vendorId,
    bill_number: `INV-AGED-${ts}`,
    bill_date: new Date(today.getTime() - 60 * 86400 * 1000).toISOString().slice(0, 10),
    due_date: due45ago,
    amount: 250, amount_paid: 0, status: 'open', approval_status: 'pending',
  });
  expect(bill45.status, JSON.stringify(bill45.data)).toBeLessThan(300);
  const bill45Id = (Array.isArray(bill45.data) ? bill45.data[0] : bill45.data).id;

  const aging = await select(request, tokenA, 'v_bills_aging', `id=eq.${bill45Id}&select=aging_bucket,days_overdue,balance`);
  expect(aging.status).toBeLessThan(300);
  expect(aging.data.length).toBe(1);
  expect(aging.data[0].aging_bucket).toBe('d31_60');
  expect(Number(aging.data[0].days_overdue)).toBeGreaterThanOrEqual(40);
  expect(Number(aging.data[0].balance)).toBeCloseTo(250, 2);

  // 7. RLS: tenant B cannot read tenant A's vendors / bills / payments
  const rlsV = await select(request, tokenB, 'vendors', `id=eq.${vendorId}&select=id`);
  expect(rlsV.data.length).toBe(0);
  const rlsB = await select(request, tokenB, 'bills', `id=eq.${billId}&select=id`);
  expect(rlsB.data.length).toBe(0);
  const rlsAg = await select(request, tokenB, 'v_bills_aging', `id=eq.${bill45Id}&select=id`);
  expect(rlsAg.data.length).toBe(0);
  // RLS on RPC: tenant B can't approve A's bill
  const rlsApprove = await rpc(request, tokenB, 'approve_bill', { p_bill_id: bill45Id });
  expect(rlsApprove.status).toBeGreaterThanOrEqual(400);
});
