// @ts-check
// Onboarding polish: sample-data seeder trigger, clear_sample_data RPC,
// and v_activation_status view tracking task completion.

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

async function count(request, token, table, query = '') {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${table}?${query}&select=id`, {
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
    failOnStatusCode: false,
  });
  const cr = res.headers()['content-range'] || '0/0';
  const total = parseInt(cr.split('/')[1] || '0', 10);
  return total;
}

test('onboarding polish: sample data seeded, activation view, clear RPC, RLS', async ({ request }) => {
  test.setTimeout(180_000);

  const ts = Date.now();
  const emailA = `qa+onbA${ts}@stationly.test`;
  const emailB = `qa+onbB${ts + 1}@stationly.test`;
  const password = 'StationlyQA!2026';

  const tokenA = await signUp(request, emailA, password);
  const tokenB = await signUp(request, emailB, password);
  test.skip(!tokenA || !tokenB, 'Sign-up did not return access token (email confirmation may be required)');

  // 1. Create tenant — trigger should auto-seed sample data
  const tA = await rpc(request, tokenA, 'create_tenant_and_membership', {
    _name: `QA Onb A ${ts}`, _restaurant_type: 'pizzeria', _state: 'NY', _city: 'NYC', _timezone: 'America/New_York',
  });
  expect(tA.status, JSON.stringify(tA.data)).toBeLessThan(300);
  const tenantA = typeof tA.data === 'string' ? tA.data : (tA.data?.id || tA.data?.tenant_id || tA.data);
  expect(tenantA).toBeTruthy();

  const tB = await rpc(request, tokenB, 'create_tenant_and_membership', {
    _name: `QA Onb B ${ts}`, _restaurant_type: 'pizzeria', _state: 'NY', _city: 'NYC', _timezone: 'America/New_York',
  });
  expect(tB.status).toBeLessThan(300);
  const tenantB = typeof tB.data === 'string' ? tB.data : (tB.data?.id || tB.data?.tenant_id || tB.data);

  // 2. Verify sample inventory exists for tenant A
  const sampleInvCount = await count(request, tokenA, 'inventory_items', `tenant_id=eq.${tenantA}&is_sample=eq.true`);
  expect(sampleInvCount).toBeGreaterThan(0);

  const sampleMenuCount = await count(request, tokenA, 'menu_items', `tenant_id=eq.${tenantA}&is_sample=eq.true`);
  expect(sampleMenuCount).toBeGreaterThan(0);

  const sampleRecipeCount = await count(request, tokenA, 'recipes', `tenant_id=eq.${tenantA}&is_sample=eq.true`);
  expect(sampleRecipeCount).toBeGreaterThan(0);

  const sampleStaffCount = await count(request, tokenA, 'staff', `tenant_id=eq.${tenantA}&is_sample=eq.true`);
  expect(sampleStaffCount).toBeGreaterThan(0);

  const sampleInvoiceCount = await count(request, tokenA, 'invoices', `tenant_id=eq.${tenantA}&is_sample=eq.true`);
  expect(sampleInvoiceCount).toBeGreaterThan(0);

  const sampleTempCount = await count(request, tokenA, 'temp_logs', `tenant_id=eq.${tenantA}&is_sample=eq.true`);
  expect(sampleTempCount).toBeGreaterThan(0);

  // 3. v_activation_status — sample data is_sample=true should NOT count toward "real" activation
  const status1 = await select(request, tokenA, 'v_activation_status', `tenant_id=eq.${tenantA}`);
  expect(status1.status).toBeLessThan(300);
  expect(status1.data.length).toBeGreaterThanOrEqual(1);
  const row1 = status1.data.find(r => r.tenant_id === tenantA);
  expect(row1).toBeTruthy();
  // All has_* booleans should be false at start (sample data is excluded by is_sample filter in the view)
  expect(row1.has_inventory).toBe(false);
  expect(row1.has_recipe).toBe(false);
  expect(row1.has_staff).toBe(false);
  expect(row1.has_invoice).toBe(false);

  // 4. Insert a real (non-sample) inventory item — has_inventory should flip true
  const locsRes = await select(request, tokenA, 'locations', `tenant_id=eq.${tenantA}&select=id,is_primary&order=created_at.asc`);
  const primaryId = (locsRes.data || []).find(l => l.is_primary)?.id;
  expect(primaryId).toBeTruthy();

  const realInv = await insert(request, tokenA, 'inventory_items', {
    tenant_id: tenantA, name: `Real Cheese ${ts}`, unit: 'lb', on_hand: 10, par: 20,
    unit_cost: 5, location_id: primaryId, is_sample: false,
  });
  expect(realInv.status, JSON.stringify(realInv.data)).toBeLessThan(300);

  const status2 = await select(request, tokenA, 'v_activation_status', `tenant_id=eq.${tenantA}`);
  const row2 = status2.data.find(r => r.tenant_id === tenantA);
  expect(row2.has_inventory).toBe(true);

  // 5. clear_sample_data RPC — wipes all is_sample=true rows for tenant
  const clearRes = await rpc(request, tokenA, 'clear_sample_data', { p_tenant_id: tenantA });
  expect(clearRes.status, JSON.stringify(clearRes.data)).toBeLessThan(300);

  const afterInv = await count(request, tokenA, 'inventory_items', `tenant_id=eq.${tenantA}&is_sample=eq.true`);
  expect(afterInv).toBe(0);
  const afterMenu = await count(request, tokenA, 'menu_items', `tenant_id=eq.${tenantA}&is_sample=eq.true`);
  expect(afterMenu).toBe(0);
  const afterRecipe = await count(request, tokenA, 'recipes', `tenant_id=eq.${tenantA}&is_sample=eq.true`);
  expect(afterRecipe).toBe(0);
  const afterStaff = await count(request, tokenA, 'staff', `tenant_id=eq.${tenantA}&is_sample=eq.true`);
  expect(afterStaff).toBe(0);
  const afterInvoice = await count(request, tokenA, 'invoices', `tenant_id=eq.${tenantA}&is_sample=eq.true`);
  expect(afterInvoice).toBe(0);
  const afterTemp = await count(request, tokenA, 'temp_logs', `tenant_id=eq.${tenantA}&is_sample=eq.true`);
  expect(afterTemp).toBe(0);

  // The real inventory item should still exist after clear
  const realStill = await count(request, tokenA, 'inventory_items', `tenant_id=eq.${tenantA}&is_sample=eq.false`);
  expect(realStill).toBeGreaterThan(0);

  // 6. activation_progress write — manually mark a task dismissed
  const meRes = await request.get(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${tokenA}` },
  });
  const me = await meRes.json();
  const myUid = me?.id;
  expect(myUid).toBeTruthy();

  const progRes2 = await insert(request, tokenA, 'activation_progress', {
    tenant_id: tenantA, user_id: myUid, task_key: 'invite_team_dismissed', dismissed: true,
  });
  expect(progRes2.status, JSON.stringify(progRes2.data)).toBeLessThan(300);

  // Read it back
  const progReadback = await select(request, tokenA, 'activation_progress', `tenant_id=eq.${tenantA}&task_key=eq.invite_team_dismissed`);
  expect(progReadback.data.length).toBeGreaterThan(0);

  // 7. RLS — tenant B cannot see tenant A's sample data, activation rows, or v_activation_status
  const rlsInv = await count(request, tokenB, 'inventory_items', `tenant_id=eq.${tenantA}`);
  expect(rlsInv).toBe(0);
  const rlsProg = await select(request, tokenB, 'activation_progress', `tenant_id=eq.${tenantA}&select=id`);
  expect(rlsProg.data.length).toBe(0);
  const rlsStatus = await select(request, tokenB, 'v_activation_status', `tenant_id=eq.${tenantA}`);
  expect(rlsStatus.data.length).toBe(0);

  // 8. Tenant B cannot call clear_sample_data on tenant A
  const rlsClear = await rpc(request, tokenB, 'clear_sample_data', { p_tenant_id: tenantA });
  expect(rlsClear.status).toBeGreaterThanOrEqual(400);
});
