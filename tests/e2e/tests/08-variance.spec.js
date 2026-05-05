// @ts-check
// Theoretical-vs-Actual variance: end-to-end arithmetic + RLS isolation.
//
// We seed two inventory items (Mozzarella @ $4/lb, Flour @ $0.50/lb), one
// menu item (Cheese Pizza), one recipe with two ingredients, ten POS line
// items, an invoice with a 20-lb mozzarella line, and two finalized counts
// bracketing the period. Then we call compute_variance_report() and assert
// the published numbers from the release brief match exactly.
//
// Worked example (from the brief):
//   10 cheese pizzas sold; recipe = 8 oz mozz + 12 oz flour
//   Beginning mozz 50 lb, +20 lb purchases, ending 60 lb -> actual 10 lb
//   Theoretical mozz = 10 * (8/16) = 5 lb -> variance +5 lb / +$20
//   Beginning flour 100 lb, +0, ending 91 lb -> actual 9 lb
//   Theoretical flour = 10 * (12/16) = 7.5 lb -> variance +1.5 lb (+20%)
//   Both rows should be 'bad' severity (>5%).

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

test('variance: theoretical-vs-actual arithmetic + RLS', async ({ request }) => {
  test.setTimeout(180_000);

  const ts = Date.now();
  const emailA = `qa+varA${ts}@stationly.test`;
  const emailB = `qa+varB${ts + 1}@stationly.test`;
  const password = 'StationlyQA!2026';

  const tokenA = await signUp(request, emailA, password);
  const tokenB = await signUp(request, emailB, password);
  test.skip(!tokenA || !tokenB, 'Sign-up did not return access token (email confirmation may be required)');

  // ---- Tenants ----
  const { data: tA, status: sA } = await rpc(request, tokenA, 'create_tenant_and_membership', {
    _name: `QA Variance A ${ts}`, _restaurant_type: 'pizza', _state: 'FL', _city: 'Orlando', _timezone: 'America/New_York',
  });
  expect(sA, `Tenant A create failed: ${JSON.stringify(tA)}`).toBeLessThan(300);
  const tenantA = typeof tA === 'string' ? tA : (tA?.id || tA?.tenant_id || tA);

  const { data: tB, status: sB } = await rpc(request, tokenB, 'create_tenant_and_membership', {
    _name: `QA Variance B ${ts}`, _restaurant_type: 'pizza', _state: 'FL', _city: 'Tampa', _timezone: 'America/New_York',
  });
  expect(sB, `Tenant B create failed: ${JSON.stringify(tB)}`).toBeLessThan(300);
  const tenantB = typeof tB === 'string' ? tB : (tB?.id || tB?.tenant_id || tB);

  // Tenant A: pick the primary location.
  const locsRes = await select(request, tokenA, 'locations', `tenant_id=eq.${tenantA}&select=id,is_primary&order=created_at.asc`);
  expect(locsRes.status).toBeLessThan(300);
  const primaryId = (locsRes.data || []).find(l => l.is_primary)?.id;
  expect(primaryId).toBeTruthy();

  // ---- Inventory items ----
  const invRes = await insert(request, tokenA, 'inventory_items', [
    { tenant_id: tenantA, name: `Mozzarella ${ts}`, unit: 'lb', on_hand: 0, par: 30, unit_cost: 4.00, location_id: primaryId },
    { tenant_id: tenantA, name: `Flour ${ts}`,      unit: 'lb', on_hand: 0, par: 50, unit_cost: 0.50, location_id: primaryId },
  ]);
  expect(invRes.status, `Insert items failed: ${JSON.stringify(invRes.data)}`).toBeLessThan(300);
  const itemsByName = Object.fromEntries((invRes.data || []).map(r => [r.name, r]));
  const mozzId  = itemsByName[`Mozzarella ${ts}`].id;
  const flourId = itemsByName[`Flour ${ts}`].id;

  // ---- Menu item + recipe + ingredients ----
  const menuRes = await insert(request, tokenA, 'menu_items', { tenant_id: tenantA, name: `Cheese Pizza ${ts}`, price: 14.00, food_cost: 4.20, category: 'Pizza' });
  expect(menuRes.status).toBeLessThan(300);
  const menuId = Array.isArray(menuRes.data) ? menuRes.data[0].id : menuRes.data.id;

  const recRes = await insert(request, tokenA, 'recipes', { tenant_id: tenantA, name: `Cheese Pizza recipe ${ts}`, yield: 1, menu_price: 14.00, linked_menu_item_id: menuId });
  expect(recRes.status, `Recipe create failed: ${JSON.stringify(recRes.data)}`).toBeLessThan(300);
  const recipeId = Array.isArray(recRes.data) ? recRes.data[0].id : recRes.data.id;

  // 8 oz mozz = 0.5 lb;  12 oz flour = 0.75 lb
  const ingRes = await insert(request, tokenA, 'recipe_ingredients', [
    { recipe_id: recipeId, tenant_id: tenantA, name: `Mozzarella ${ts}`, qty: 0.5,  unit: 'lb', unit_cost: 4.00 },
    { recipe_id: recipeId, tenant_id: tenantA, name: `Flour ${ts}`,      qty: 0.75, unit: 'lb', unit_cost: 0.50 },
  ]);
  expect(ingRes.status, `Recipe ingredients failed: ${JSON.stringify(ingRes.data)}`).toBeLessThan(300);

  // ---- Beginning count (Day 0) ----
  const day0 = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const cAres = await insert(request, tokenA, 'inventory_counts', {
    tenant_id: tenantA, location_id: primaryId, period_label: 'Beginning', counted_at: day0, status: 'draft',
  });
  expect(cAres.status, `Count A create failed: ${JSON.stringify(cAres.data)}`).toBeLessThan(300);
  const countAId = Array.isArray(cAres.data) ? cAres.data[0].id : cAres.data.id;
  const cAlines = await insert(request, tokenA, 'inventory_count_lines', [
    { count_id: countAId, tenant_id: tenantA, inventory_item_id: mozzId,  counted_qty: 50,  unit: 'lb', unit_cost: 4.00 },
    { count_id: countAId, tenant_id: tenantA, inventory_item_id: flourId, counted_qty: 100, unit: 'lb', unit_cost: 0.50 },
  ]);
  expect(cAlines.status).toBeLessThan(300);
  // Finalize via RPC so the manager-only check is exercised.
  const finA = await rpc(request, tokenA, 'finalize_inventory_count', { p_count_id: countAId });
  expect(finA.status, `Finalize A failed: ${JSON.stringify(finA.data)}`).toBeLessThan(300);

  // ---- POS line items: 10 cheese pizzas sold mid-window ----
  const day3 = new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString();
  const posRows = Array.from({ length: 10 }, () => ({
    tenant_id: tenantA, location_id: primaryId, menu_item_id: menuId,
    item_name: `Cheese Pizza ${ts}`, quantity: 1, unit_price: 14.00, gross_amount: 14.00,
    sold_at: day3,
  }));
  const posRes = await insert(request, tokenA, 'pos_line_items', posRows);
  expect(posRes.status, `POS line items failed: ${JSON.stringify(posRes.data)}`).toBeLessThan(300);

  // ---- Invoice in window: 20 lb mozzarella received ----
  const day2 = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const invHdr = await insert(request, tokenA, 'invoices', {
    tenant_id: tenantA, vendor: 'Sysco', invoice_number: `INV-${ts}`, invoice_date: day2,
    subtotal: 80.00, total: 80.00, status: 'received',
  });
  expect(invHdr.status, `Invoice create failed: ${JSON.stringify(invHdr.data)}`).toBeLessThan(300);
  const invoiceId = Array.isArray(invHdr.data) ? invHdr.data[0].id : invHdr.data.id;
  const invLine = await insert(request, tokenA, 'invoice_lines', {
    invoice_id: invoiceId, tenant_id: tenantA, line_index: 0,
    raw_description: `Mozzarella ${ts}`, qty: 20, unit: 'lb', unit_price: 4.00, extended_price: 80.00,
    matched_inventory_id: mozzId, match_confidence: 1.0,
  });
  expect(invLine.status, `Invoice line failed: ${JSON.stringify(invLine.data)}`).toBeLessThan(300);

  // ---- Ending count (now) ----
  const cBres = await insert(request, tokenA, 'inventory_counts', {
    tenant_id: tenantA, location_id: primaryId, period_label: 'Ending', counted_at: new Date().toISOString(), status: 'draft',
  });
  expect(cBres.status).toBeLessThan(300);
  const countBId = Array.isArray(cBres.data) ? cBres.data[0].id : cBres.data.id;
  const cBlines = await insert(request, tokenA, 'inventory_count_lines', [
    { count_id: countBId, tenant_id: tenantA, inventory_item_id: mozzId,  counted_qty: 60, unit: 'lb', unit_cost: 4.00 },
    { count_id: countBId, tenant_id: tenantA, inventory_item_id: flourId, counted_qty: 91, unit: 'lb', unit_cost: 0.50 },
  ]);
  expect(cBlines.status).toBeLessThan(300);
  const finB = await rpc(request, tokenA, 'finalize_inventory_count', { p_count_id: countBId });
  expect(finB.status).toBeLessThan(300);

  // ---- Compute variance report ----
  const reportRes = await rpc(request, tokenA, 'compute_variance_report', {
    p_tenant_id: tenantA,
    p_location_id: primaryId,
    p_start_count_id: countAId,
    p_end_count_id: countBId,
  });
  expect(reportRes.status, `Variance report failed: ${JSON.stringify(reportRes.data)}`).toBeLessThan(300);
  const rows = Array.isArray(reportRes.data) ? reportRes.data : [];
  expect(rows.length).toBeGreaterThanOrEqual(2);
  const byItem = Object.fromEntries(rows.map(r => [r.inventory_item_id, r]));

  // ---- Mozzarella assertions ----
  const mozz = byItem[mozzId];
  expect(mozz, 'mozzarella row missing').toBeTruthy();
  expect(Number(mozz.beginning_qty)).toBe(50);
  expect(Number(mozz.ending_qty)).toBe(60);
  expect(Number(mozz.purchases_qty)).toBe(20);
  expect(Number(mozz.actual_used_qty)).toBe(10);   // 50 + 20 - 60 = 10
  expect(Number(mozz.theoretical_used_qty)).toBe(5); // 10 * 0.5 = 5
  expect(Number(mozz.variance_qty)).toBe(5);
  expect(Number(mozz.variance_dollars)).toBeCloseTo(20, 2); // 5 lb * $4
  expect(mozz.severity).toBe('bad'); // 100% over -> bad

  // ---- Flour assertions ----
  const flour = byItem[flourId];
  expect(flour, 'flour row missing').toBeTruthy();
  expect(Number(flour.beginning_qty)).toBe(100);
  expect(Number(flour.ending_qty)).toBe(91);
  expect(Number(flour.purchases_qty)).toBe(0);
  expect(Number(flour.actual_used_qty)).toBe(9);    // 100 + 0 - 91 = 9
  expect(Number(flour.theoretical_used_qty)).toBe(7.5); // 10 * 0.75 = 7.5
  expect(Number(flour.variance_qty)).toBeCloseTo(1.5, 3);
  expect(Number(flour.variance_pct)).toBeCloseTo(20, 0);
  expect(flour.severity).toBe('bad');

  // ---- RLS: tenant B cannot run the report against A's counts ----
  const crossRpc = await rpc(request, tokenB, 'compute_variance_report', {
    p_tenant_id: tenantA,
    p_location_id: primaryId,
    p_start_count_id: countAId,
    p_end_count_id: countBId,
  });
  expect(crossRpc.status, `Cross-tenant variance call should be blocked: ${JSON.stringify(crossRpc.data)}`).toBeGreaterThanOrEqual(400);

  // ---- RLS: tenant B cannot read A's inventory_counts rows ----
  const leak = await select(request, tokenB, 'inventory_counts', `tenant_id=eq.${tenantA}&select=id`);
  expect(Array.isArray(leak.data) ? leak.data.length : 1, 'B leaked A counts').toBe(0);
});
