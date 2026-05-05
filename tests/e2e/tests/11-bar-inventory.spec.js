// @ts-check
// Bar / liquor inventory: bottle-level tracking, pour_oz variance, pour log,
// reorder flag, and RLS isolation.

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

test('bar inventory: pour_oz variance, pours, reorder flag, RLS', async ({ request }) => {
  test.setTimeout(180_000);

  const ts = Date.now();
  const emailA = `qa+barA${ts}@stationly.test`;
  const emailB = `qa+barB${ts + 1}@stationly.test`;
  const password = 'StationlyQA!2026';

  const tokenA = await signUp(request, emailA, password);
  const tokenB = await signUp(request, emailB, password);
  test.skip(!tokenA || !tokenB, 'Sign-up did not return access token (email confirmation may be required)');

  const tA = await rpc(request, tokenA, 'create_tenant_and_membership', {
    _name: `QA Bar A ${ts}`, _restaurant_type: 'bar', _state: 'FL', _city: 'Orlando', _timezone: 'America/New_York',
  });
  expect(tA.status, JSON.stringify(tA.data)).toBeLessThan(300);
  const tenantA = typeof tA.data === 'string' ? tA.data : (tA.data?.id || tA.data?.tenant_id || tA.data);

  const tB = await rpc(request, tokenB, 'create_tenant_and_membership', {
    _name: `QA Bar B ${ts}`, _restaurant_type: 'bar', _state: 'FL', _city: 'Tampa', _timezone: 'America/New_York',
  });
  expect(tB.status).toBeLessThan(300);
  const tenantB = typeof tB.data === 'string' ? tB.data : (tB.data?.id || tB.data?.tenant_id || tB.data);

  const locsRes = await select(request, tokenA, 'locations', `tenant_id=eq.${tenantA}&select=id,is_primary&order=created_at.asc`);
  expect(locsRes.status).toBeLessThan(300);
  const primaryId = (locsRes.data || []).find(l => l.is_primary)?.id;
  expect(primaryId).toBeTruthy();

  // 1. Create a spirits bottle: Tito's Vodka — 1000 mL, $25/bottle, par 5, on_hand 4
  // bottle_size_oz is GENERATED from bottle_size_ml — 1000 / 29.5735 ≈ 33.81 oz
  const titoRes = await insert(request, tokenA, 'inventory_items', {
    tenant_id: tenantA, name: `Titos Vodka ${ts}`, unit: 'bottle', on_hand: 4, par: 5,
    unit_cost: 25, location_id: primaryId,
    category: 'spirits', bottle_size_ml: 1000, unit_yield_oz: 32, abv: 40,
  });
  expect(titoRes.status, JSON.stringify(titoRes.data)).toBeLessThan(300);
  const titoId = (Array.isArray(titoRes.data) ? titoRes.data[0] : titoRes.data).id;
  // Verify generated column populated
  const verifyTito = await select(request, tokenA, 'inventory_items', `id=eq.${titoId}&select=bottle_size_oz`);
  expect(verifyTito.data.length).toBe(1);
  const bottleOz = Number(verifyTito.data[0].bottle_size_oz);
  expect(bottleOz).toBeGreaterThan(33);
  expect(bottleOz).toBeLessThan(34);

  // 2. Drink recipe — Vodka Soda, pour_oz=1.5
  const menuRes = await insert(request, tokenA, 'menu_items', {
    tenant_id: tenantA, name: `Vodka Soda ${ts}`, price: 9, food_cost: 1.50, category: 'cocktails',
  });
  expect(menuRes.status).toBeLessThan(300);
  const menuId = (Array.isArray(menuRes.data) ? menuRes.data[0] : menuRes.data).id;

  const recRes = await insert(request, tokenA, 'recipes', {
    tenant_id: tenantA, name: `Vodka Soda recipe ${ts}`, yield: 1, menu_price: 9, linked_menu_item_id: menuId,
  });
  expect(recRes.status).toBeLessThan(300);
  const recipeId = (Array.isArray(recRes.data) ? recRes.data[0] : recRes.data).id;

  const ingRes = await insert(request, tokenA, 'recipe_ingredients', {
    recipe_id: recipeId, tenant_id: tenantA, name: `Titos Vodka ${ts}`,
    qty: 0, unit: 'oz', unit_cost: 25, pour_oz: 1.5,
  });
  expect(ingRes.status, JSON.stringify(ingRes.data)).toBeLessThan(300);

  // 3. Beginning count (Day 0)
  const day0 = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const cA = await insert(request, tokenA, 'inventory_counts', {
    tenant_id: tenantA, location_id: primaryId, period_label: 'Beg', counted_at: day0, status: 'draft',
  });
  expect(cA.status).toBeLessThan(300);
  const countAId = (Array.isArray(cA.data) ? cA.data[0] : cA.data).id;
  await insert(request, tokenA, 'inventory_count_lines', {
    count_id: countAId, tenant_id: tenantA, inventory_item_id: titoId, counted_qty: 4, unit: 'bottle', unit_cost: 25,
  });
  const finA = await rpc(request, tokenA, 'finalize_inventory_count', { p_count_id: countAId });
  expect(finA.status).toBeLessThan(300);

  // 4. 10 sales of Vodka Soda
  const day3 = new Date(Date.now() - 4 * 86400 * 1000).toISOString();
  const posRows = Array.from({ length: 10 }, () => ({
    tenant_id: tenantA, location_id: primaryId, menu_item_id: menuId,
    item_name: `Vodka Soda ${ts}`, quantity: 1, unit_price: 9, gross_amount: 9, sold_at: day3,
  }));
  const posRes = await insert(request, tokenA, 'pos_line_items', posRows);
  expect(posRes.status, JSON.stringify(posRes.data)).toBeLessThan(300);

  // 5. Ending count — assume 3.5 bottles remaining (we used ~0.5 bottles for theoretical math)
  const cB = await insert(request, tokenA, 'inventory_counts', {
    tenant_id: tenantA, location_id: primaryId, period_label: 'End', counted_at: new Date().toISOString(), status: 'draft',
  });
  expect(cB.status).toBeLessThan(300);
  const countBId = (Array.isArray(cB.data) ? cB.data[0] : cB.data).id;
  await insert(request, tokenA, 'inventory_count_lines', {
    count_id: countBId, tenant_id: tenantA, inventory_item_id: titoId, counted_qty: 3.5, unit: 'bottle', unit_cost: 25,
  });
  const finB = await rpc(request, tokenA, 'finalize_inventory_count', { p_count_id: countBId });
  expect(finB.status).toBeLessThan(300);

  // 6. Run variance report — theoretical = 10 * 1.5 / bottle_size_oz ≈ 15 / 33.814 ≈ 0.4436 bottles
  const reportRes = await rpc(request, tokenA, 'compute_variance_report', {
    p_tenant_id: tenantA, p_location_id: primaryId, p_start_count_id: countAId, p_end_count_id: countBId,
  });
  expect(reportRes.status, JSON.stringify(reportRes.data)).toBeLessThan(300);
  const rows = Array.isArray(reportRes.data) ? reportRes.data : [];
  const byItem = Object.fromEntries(rows.map(r => [r.inventory_item_id, r]));
  const tito = byItem[titoId];
  expect(tito, 'tito row missing from variance report').toBeTruthy();
  // Theoretical (in bottles) = (10 * 1.5) / bottle_size_oz
  const expectedTheoretical = (10 * 1.5) / bottleOz;
  expect(Number(tito.theoretical_used_qty)).toBeCloseTo(expectedTheoretical, 3);
  // Actual = beginning + purchases - ending = 4 + 0 - 3.5 = 0.5 bottles
  expect(Number(tito.actual_used_qty)).toBeCloseTo(0.5, 3);

  // 7. Log a bar pour (0.5 oz spill) via direct insert
  const pourRes = await insert(request, tokenA, 'bar_pours', {
    tenant_id: tenantA, location_id: primaryId, inventory_item_id: titoId,
    poured_oz: 0.5, reason: 'spill',
  });
  expect(pourRes.status, JSON.stringify(pourRes.data)).toBeLessThan(300);
  const pours = await select(request, tokenA, 'bar_pours', `inventory_item_id=eq.${titoId}&select=id,poured_oz,reason`);
  expect(pours.data.length).toBe(1);
  expect(Number(pours.data[0].poured_oz)).toBeCloseTo(0.5, 2);
  expect(pours.data[0].reason).toBe('spill');

  // 8. v_bar_inventory_status — on_hand 4 < par 5 → reorder_flag true
  const statusRes = await select(request, tokenA, 'v_bar_inventory_status', `inventory_item_id=eq.${titoId}&select=name,on_hand_bottles,par_bottles,reorder_flag`);
  expect(statusRes.status).toBeLessThan(300);
  expect(statusRes.data.length).toBe(1);
  expect(statusRes.data[0].reorder_flag).toBe(true);
  expect(Number(statusRes.data[0].on_hand_bottles)).toBeCloseTo(4, 2);
  expect(Number(statusRes.data[0].par_bottles)).toBeCloseTo(5, 2);

  // 9. RLS — tenant B cannot see tenant A's inventory item, pour, or status row
  const rlsItem = await select(request, tokenB, 'inventory_items', `id=eq.${titoId}&select=id`);
  expect(rlsItem.data.length).toBe(0);
  const rlsPour = await select(request, tokenB, 'bar_pours', `inventory_item_id=eq.${titoId}&select=id`);
  expect(rlsPour.data.length).toBe(0);
  const rlsStatus = await select(request, tokenB, 'v_bar_inventory_status', `inventory_item_id=eq.${titoId}&select=name`);
  expect(rlsStatus.data.length).toBe(0);
});
