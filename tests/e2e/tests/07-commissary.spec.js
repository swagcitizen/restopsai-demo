// @ts-check
// Multi-location commissary end-to-end flow.
//
// Verifies the locations + commissary_transfers stack:
//   1. A new tenant gets a default primary location (backfill).
//   2. The owner can create a 2nd location and mark it commissary.
//   3. The owner can create a transfer with 2 line items and walk it
//      through draft -> sent -> received.
//   4. On receive, inventory at the destination is incremented (or created
//      mirrored from the source) by the line quantities.
//   5. RLS isolation: a different tenant's owner cannot read those locations
//      or transfers.
//
// Uses raw fetch against the Supabase REST + RPC API (no supabase-js, matching
// the rest of this suite to avoid the websocket bundling issue).

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
  // Fall back to password grant in case email confirmation auto-flipped.
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
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: args,
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
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status(), data: json };
}

async function patch(request, token, table, query, body) {
  const res = await request.patch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    data: body,
    failOnStatusCode: false,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status(), data: json };
}

test('multi-location commissary: locations, transfers, RLS', async ({ request }) => {
  test.setTimeout(180_000);

  const ts = Date.now();
  const emailA = `qa+commA${ts}@stationly.test`;
  const emailB = `qa+commB${ts + 1}@stationly.test`;
  const password = 'StationlyQA!2026';

  const tokenA = await signUp(request, emailA, password);
  const tokenB = await signUp(request, emailB, password);
  test.skip(!tokenA || !tokenB, 'Sign-up did not return access token (email confirmation may be required)');

  // Tenant A
  const { data: tA, status: sA } = await rpc(request, tokenA, 'create_tenant_and_membership', {
    _name: `QA Commissary A ${ts}`, _restaurant_type: 'pizza', _state: 'FL', _city: 'Orlando', _timezone: 'America/New_York',
  });
  expect(sA, `Tenant A create failed: ${JSON.stringify(tA)}`).toBeLessThan(300);
  const tenantA = typeof tA === 'string' ? tA : (tA?.id || tA?.tenant_id || tA);

  // Tenant B (used to assert RLS isolation)
  const { data: tB, status: sB } = await rpc(request, tokenB, 'create_tenant_and_membership', {
    _name: `QA Commissary B ${ts}`, _restaurant_type: 'pizza', _state: 'FL', _city: 'Tampa', _timezone: 'America/New_York',
  });
  expect(sB, `Tenant B create failed: ${JSON.stringify(tB)}`).toBeLessThan(300);
  const tenantB = typeof tB === 'string' ? tB : (tB?.id || tB?.tenant_id || tB);

  // ---------------------------------------------------------------------
  // 1. Tenant A should already have a primary location (backfill).
  // ---------------------------------------------------------------------
  const locsRes = await select(request, tokenA, 'locations', `select=id,name,is_primary,is_commissary&order=created_at.asc`);
  expect(locsRes.status).toBeLessThan(300);
  const primary = (locsRes.data || []).find(l => l.is_primary);
  expect(primary, 'Primary location should exist for new tenant').toBeTruthy();

  // ---------------------------------------------------------------------
  // 2. Create a 2nd location and mark it as the commissary.
  // ---------------------------------------------------------------------
  const loc2Res = await insert(request, tokenA, 'locations', {
    tenant_id: tenantA,
    name: 'Commissary Kitchen',
    is_commissary: true,
  });
  expect(loc2Res.status, `Location create failed: ${JSON.stringify(loc2Res.data)}`).toBeLessThan(300);
  const commissaryId = Array.isArray(loc2Res.data) ? loc2Res.data[0]?.id : loc2Res.data?.id;
  expect(commissaryId).toBeTruthy();
  const primaryId = primary.id;

  // ---------------------------------------------------------------------
  // 3. Seed two inventory items at the commissary so we have something
  //    to transfer.
  // ---------------------------------------------------------------------
  const seedItems = [
    { tenant_id: tenantA, name: `Mozzarella ${ts}`, unit: 'lb', on_hand: 100, par: 60, unit_cost: 3.95, location_id: commissaryId },
    { tenant_id: tenantA, name: `Tomato sauce ${ts}`, unit: 'qt', on_hand: 50, par: 20, unit_cost: 2.10, location_id: commissaryId },
  ];
  const seedRes = await insert(request, tokenA, 'inventory_items', seedItems);
  expect(seedRes.status, `Seed inventory failed: ${JSON.stringify(seedRes.data)}`).toBeLessThan(300);
  const seeded = Array.isArray(seedRes.data) ? seedRes.data : [seedRes.data];
  expect(seeded.length).toBe(2);

  // ---------------------------------------------------------------------
  // 4. Create a draft transfer + 2 lines.
  // ---------------------------------------------------------------------
  const transferRes = await insert(request, tokenA, 'commissary_transfers', {
    tenant_id: tenantA,
    from_location_id: commissaryId,
    to_location_id: primaryId,
    status: 'draft',
    notes: 'QA test transfer',
  });
  expect(transferRes.status, `Transfer create failed: ${JSON.stringify(transferRes.data)}`).toBeLessThan(300);
  const transfer = Array.isArray(transferRes.data) ? transferRes.data[0] : transferRes.data;
  const transferId = transfer.id;
  expect(transferId).toBeTruthy();

  const lineRows = seeded.map((s, i) => ({
    transfer_id: transferId,
    tenant_id: tenantA,
    inventory_item_id: s.id,
    description: s.name,
    quantity: i === 0 ? 12 : 8,
    unit: s.unit,
    unit_cost: s.unit_cost,
  }));
  const linesRes = await insert(request, tokenA, 'commissary_transfer_lines', lineRows);
  expect(linesRes.status, `Lines create failed: ${JSON.stringify(linesRes.data)}`).toBeLessThan(300);

  // ---------------------------------------------------------------------
  // 5. Mark sent then received via RPC.
  // ---------------------------------------------------------------------
  const sentRes = await rpc(request, tokenA, 'mark_transfer_sent', { p_transfer_id: transferId });
  expect(sentRes.status, `mark_transfer_sent failed: ${JSON.stringify(sentRes.data)}`).toBeLessThan(300);
  const recvRes = await rpc(request, tokenA, 'mark_transfer_received', { p_transfer_id: transferId });
  expect(recvRes.status, `mark_transfer_received failed: ${JSON.stringify(recvRes.data)}`).toBeLessThan(300);

  // ---------------------------------------------------------------------
  // 6. Inventory at the destination should now reflect the transfer.
  //    Either the source rows were mirrored to the destination location
  //    with on_hand = qty, or pre-existing rows there were incremented.
  // ---------------------------------------------------------------------
  const destInv = await select(
    request, tokenA, 'inventory_items',
    `tenant_id=eq.${tenantA}&location_id=eq.${primaryId}&select=name,on_hand,location_id`
  );
  expect(destInv.status).toBeLessThan(300);
  const destByName = Object.fromEntries((destInv.data || []).map(r => [r.name, Number(r.on_hand)]));
  expect(destByName[`Mozzarella ${ts}`], `Mozzarella was not received at primary: ${JSON.stringify(destInv.data)}`).toBeGreaterThanOrEqual(12);
  expect(destByName[`Tomato sauce ${ts}`], `Tomato sauce was not received at primary: ${JSON.stringify(destInv.data)}`).toBeGreaterThanOrEqual(8);

  // ---------------------------------------------------------------------
  // 7. RLS: tenant B cannot see tenant A's locations or transfers.
  // ---------------------------------------------------------------------
  const leakLocs = await select(request, tokenB, 'locations', `tenant_id=eq.${tenantA}&select=id`);
  expect(Array.isArray(leakLocs.data) ? leakLocs.data.length : 1, 'B leaked A locations').toBe(0);

  const leakTrans = await select(request, tokenB, 'commissary_transfers', `tenant_id=eq.${tenantA}&select=id`);
  expect(Array.isArray(leakTrans.data) ? leakTrans.data.length : 1, 'B leaked A transfers').toBe(0);

  // Cross-tenant write should also be blocked.
  const crossWrite = await insert(request, tokenB, 'commissary_transfers', {
    tenant_id: tenantA,
    from_location_id: commissaryId,
    to_location_id: primaryId,
    status: 'draft',
  });
  expect(crossWrite.status, `Cross-tenant transfer write should be blocked: ${JSON.stringify(crossWrite.data)}`).toBeGreaterThanOrEqual(400);

  // RPC by non-member should fail too.
  const crossRpc = await rpc(request, tokenB, 'mark_transfer_received', { p_transfer_id: transferId });
  expect(crossRpc.status, `Cross-tenant RPC should fail: ${JSON.stringify(crossRpc.data)}`).toBeGreaterThanOrEqual(400);
});
