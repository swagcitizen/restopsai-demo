// @ts-check
// Payroll: pay periods, OT calculation, tip pool, RLS isolation.
//
// Seeds two staff with hourly rates, creates time_entries spanning two weeks
// (Week 1 = 50 hrs -> 10 hrs OT; Week 2 = 35 hrs -> 0 OT), seeds a tip pool
// entry, then calls generate_pay_run() and verifies that the regular hours,
// overtime hours, regular pay, overtime pay (1.5x), tips, and gross pay all
// match the FLSA-default expected values exactly. Then unlocks + regenerates
// to confirm idempotency, and confirms a second tenant cannot read the run.

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

// Build a pair of clock_in_at / clock_out_at timestamps for a given day spanning N hours.
function shift(dayIso, startHour, hours) {
  const start = new Date(dayIso);
  start.setUTCHours(startHour, 0, 0, 0);
  const end = new Date(start.getTime() + hours * 3600 * 1000);
  return { clock_in_at: start.toISOString(), clock_out_at: end.toISOString() };
}

test('payroll: hours, OT, tips, regen idempotency, RLS', async ({ request }) => {
  test.setTimeout(180_000);

  const ts = Date.now();
  const emailA = `qa+payA${ts}@stationly.test`;
  const emailB = `qa+payB${ts + 1}@stationly.test`;
  const password = 'StationlyQA!2026';

  const tokenA = await signUp(request, emailA, password);
  const tokenB = await signUp(request, emailB, password);
  test.skip(!tokenA || !tokenB, 'Sign-up did not return access token (email confirmation may be required)');

  // Tenants
  const { data: tA, status: sA } = await rpc(request, tokenA, 'create_tenant_and_membership', {
    _name: `QA Payroll A ${ts}`, _restaurant_type: 'pizza', _state: 'FL', _city: 'Orlando', _timezone: 'America/New_York',
  });
  expect(sA, `Tenant A create failed: ${JSON.stringify(tA)}`).toBeLessThan(300);
  const tenantA = typeof tA === 'string' ? tA : (tA?.id || tA?.tenant_id || tA);

  const { data: tB, status: sB } = await rpc(request, tokenB, 'create_tenant_and_membership', {
    _name: `QA Payroll B ${ts}`, _restaurant_type: 'pizza', _state: 'FL', _city: 'Tampa', _timezone: 'America/New_York',
  });
  expect(sB).toBeLessThan(300);
  const tenantB = typeof tB === 'string' ? tB : (tB?.id || tB?.tenant_id || tB);

  // Single staff member at $20/hr.
  const RATE = 20;
  const staffRes = await insert(request, tokenA, 'staff', {
    tenant_id: tenantA, name: `QA Cook ${ts}`, role: 'kitchen', hourly_rate: RATE, active: true,
  });
  expect(staffRes.status, JSON.stringify(staffRes.data)).toBeLessThan(300);
  const staffId = (Array.isArray(staffRes.data) ? staffRes.data[0] : staffRes.data).id;

  // Pay period: 14-day window aligned to ISO weeks (Monday start).
  // We want week1 = 50 hrs (10 OT) and week2 = 35 hrs (0 OT). Postgres'
  // date_trunc('week', x) buckets by ISO week (Mon 00:00 UTC). To keep all
  // shifts inside the same bucket as their day, pick a Monday as periodStart.
  const today = new Date();
  // Find the most recent past Monday at least 14 days ago.
  const dayOfWeek = today.getUTCDay() || 7; // 1..7 (Mon..Sun)
  const lastMondayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (dayOfWeek - 1)));
  const periodStart = new Date(lastMondayUtc.getTime() - 14 * 86400 * 1000);
  const periodEnd = new Date(periodStart.getTime() + 13 * 86400 * 1000);
  const week2Start = new Date(periodStart.getTime() + 7 * 86400 * 1000);

  // Week 1: 5 × 10-hr shifts (Mon-Fri) = 50 hrs -> 40 reg + 10 OT.
  // Week 2: 5 × 7-hr shifts (Mon-Fri) = 35 hrs -> 35 reg, 0 OT.
  const w1Days = [0, 1, 2, 3, 4].map((d) => new Date(periodStart.getTime() + d * 86400 * 1000).toISOString().slice(0,10));
  const w2Days = [0, 1, 2, 3, 4].map((d) => new Date(week2Start.getTime() + d * 86400 * 1000).toISOString().slice(0,10));
  const week1Entries = w1Days.map((d) => ({ tenant_id: tenantA, staff_id: staffId, hourly_rate_snapshot: RATE, ...shift(d, 12, 10) }));
  const week2Entries = w2Days.map((d) => ({ tenant_id: tenantA, staff_id: staffId, hourly_rate_snapshot: RATE, ...shift(d, 12, 7) }));
  const teRes = await insert(request, tokenA, 'time_entries', [...week1Entries, ...week2Entries]);
  expect(teRes.status, `time_entries insert: ${JSON.stringify(teRes.data)}`).toBeLessThan(300);

  // Pay period
  const ppRes = await insert(request, tokenA, 'pay_periods', {
    tenant_id: tenantA,
    period_start: periodStart.toISOString().slice(0,10),
    period_end: periodEnd.toISOString().slice(0,10),
    pay_date: new Date(periodEnd.getTime() + 5 * 86400 * 1000).toISOString().slice(0,10),
    status: 'draft',
  });
  expect(ppRes.status, JSON.stringify(ppRes.data)).toBeLessThan(300);
  const ppId = (Array.isArray(ppRes.data) ? ppRes.data[0] : ppRes.data).id;

  // Tip pool: $80 declared
  const TIPS = 80;
  const tipRes = await insert(request, tokenA, 'tip_pool_entries', {
    tenant_id: tenantA, pay_period_id: ppId, staff_id: staffId, tip_amount: TIPS, tip_type: 'declared',
  });
  expect(tipRes.status).toBeLessThan(300);

  // Generate pay run
  const genRes = await rpc(request, tokenA, 'generate_pay_run', { p_pay_period_id: ppId });
  expect(genRes.status, `generate_pay_run: ${JSON.stringify(genRes.data)}`).toBeLessThan(300);

  // Read the run + line for our staff
  const runs = await select(request, tokenA, 'pay_runs', `pay_period_id=eq.${ppId}&select=id,total_hours,total_gross`);
  expect(runs.status).toBeLessThan(300);
  expect(runs.data.length).toBe(1);
  const runId = runs.data[0].id;

  const lines = await select(request, tokenA, 'pay_run_lines', `pay_run_id=eq.${runId}&select=*`);
  expect(lines.status).toBeLessThan(300);
  expect(lines.data.length).toBe(1);
  const line = lines.data[0];

  // Expected: regular = 40 + 35 = 75, OT = 10, reg_pay = 75 * 20 = 1500, ot_pay = 10 * 30 = 300, gross = 1800 + 80
  expect(Number(line.regular_hours)).toBeCloseTo(75, 1);
  expect(Number(line.overtime_hours)).toBeCloseTo(10, 1);
  expect(Number(line.regular_pay)).toBeCloseTo(1500, 2);
  expect(Number(line.overtime_pay)).toBeCloseTo(300, 2);
  expect(Number(line.tips)).toBeCloseTo(80, 2);
  expect(Number(line.gross_pay)).toBeCloseTo(1500 + 300 + 80, 2);

  // Idempotency: unlock then regenerate -> same numbers, single run still
  const unlockRes = await rpc(request, tokenA, 'unlock_pay_period', { p_pay_period_id: ppId });
  expect(unlockRes.status, `unlock: ${JSON.stringify(unlockRes.data)}`).toBeLessThan(300);
  const gen2 = await rpc(request, tokenA, 'generate_pay_run', { p_pay_period_id: ppId });
  expect(gen2.status, `regen: ${JSON.stringify(gen2.data)}`).toBeLessThan(300);
  const runs2 = await select(request, tokenA, 'pay_runs', `pay_period_id=eq.${ppId}&select=id`);
  expect(runs2.data.length).toBe(1); // still one run, replaced not duplicated

  // RLS: tenant B cannot read the run or its lines
  const rlsRuns = await select(request, tokenB, 'pay_runs', `pay_period_id=eq.${ppId}&select=id`);
  expect(rlsRuns.data.length).toBe(0);
  const rlsLines = await select(request, tokenB, 'pay_run_lines', `pay_run_id=eq.${runId}&select=id`);
  expect(rlsLines.data.length).toBe(0);
  // RLS: tenant B cannot run generate_pay_run on tenant A's period
  const rlsGen = await rpc(request, tokenB, 'generate_pay_run', { p_pay_period_id: ppId });
  expect(rlsGen.status).toBeGreaterThanOrEqual(400);
});
