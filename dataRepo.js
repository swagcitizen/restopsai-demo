// dataRepo.js — Supabase-backed data layer for Staff, Inspection, Temp/Waste Logs, Licenses.
//
// Strategy: rather than rewrite every render function in app.js, we keep the
// existing state.* shape and hydrate it from Supabase at boot time. Mutations
// call the repo, which writes to Supabase AND updates the in-memory mirror
// so the existing render functions "just work". When the user refreshes the
// page, they see server state again.
//
// Tenant isolation is enforced by RLS on the server — we just query and mutate.

import { supabase } from './supabaseClient.js';

function ctx() {
  const c = window.__RESTOPS_CTX__;
  if (!c) throw new Error('Tenant context not loaded');
  return c;
}

// -----------------------------------------------------------------------------
// STAFF
// -----------------------------------------------------------------------------
// UI shape: { id, name, role, wage, cert, cpr, expSF, expCPR, phone, email }
// DB shape: { id, tenant_id, name, role, hourly_rate, phone, email, active, ... }
// We keep cert/cpr/exp fields as UI-only extras for v1 (not yet in schema).
// Future: staff_certifications table can hold ServSafe/CPR expirations.

export async function fetchStaff() {
  const { data, error } = await supabase
    .from('staff')
    .select('id, name, role, hourly_rate, phone, email')
    .eq('active', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role,
    // Legacy field name the UI expects:
    hourly: Number(s.hourly_rate) || 0,
    wage: Number(s.hourly_rate) || 0,
    hrs: 32, // UI-only default until schedule-driven calculation lands
    phone: s.phone || '',
    email: s.email || '',
    // UI-only certification fields (not yet persisted)
    cert: 'ServSafe',
    cpr: 'Current',
    exp: '2026-12-31',
    expSF: '2026-12-31',
    expCPR: '2026-06-30',
  }));
}

export async function addStaff({ name, role, wage = 0, phone = null, email = null }) {
  const { tenantId } = ctx();
  const { data, error } = await supabase
    .from('staff')
    .insert({ tenant_id: tenantId, name, role, hourly_rate: wage, phone, email })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateStaffWage(staffId, wage) {
  const { error } = await supabase
    .from('staff')
    .update({ hourly_rate: wage })
    .eq('id', staffId);
  if (error) throw error;
}

export async function deactivateStaff(staffId) {
  const { error } = await supabase
    .from('staff')
    .update({ active: false })
    .eq('id', staffId);
  if (error) throw error;
}

// -----------------------------------------------------------------------------
// TEMP LOGS
// -----------------------------------------------------------------------------
// UI shape: state.temps is an array of equipment with { unit, last, min, max, history }.
// DB shape: temp_logs is a long journal (one row per reading).
// We aggregate: query all logs, group by equipment, take the latest reading per equipment.
// The UI list of equipment is derived from whatever equipment names have been logged;
// for a fresh tenant, we seed a reasonable starter list client-side.

const DEFAULT_EQUIPMENT = [
  { equipment: 'Walk-in Cooler',   min: 35, max: 41, last: 38 },
  { equipment: 'Reach-in Cooler',  min: 35, max: 41, last: 39 },
  { equipment: 'Freezer',          min: -5, max: 10, last: 2 },
  { equipment: 'Pizza Prep Table', min: 35, max: 41, last: 40 },
  { equipment: 'Hot Holding',      min: 135, max: 165, last: 150 },
];

export async function fetchTempLogs() {
  const { data, error } = await supabase
    .from('temp_logs')
    .select('equipment, temp_f, logged_at, within_range, notes')
    .order('logged_at', { ascending: false })
    .limit(500);
  if (error) throw error;

  const latestByEquip = new Map();
  const historyByEquip = new Map();
  for (const row of data || []) {
    if (!latestByEquip.has(row.equipment)) latestByEquip.set(row.equipment, row);
    if (!historyByEquip.has(row.equipment)) historyByEquip.set(row.equipment, []);
    historyByEquip.get(row.equipment).push({ day: row.logged_at.slice(0, 10), value: Number(row.temp_f) });
  }

  // Merge with defaults so a fresh tenant sees the standard equipment list
  const result = DEFAULT_EQUIPMENT.map((d) => {
    const latest = latestByEquip.get(d.equipment);
    return {
      unit: '°F',
      equipment: d.equipment,
      last: latest ? Number(latest.temp_f) : d.last,
      min: d.min,
      max: d.max,
      history: (historyByEquip.get(d.equipment) || []).slice(0, 14).reverse(),
    };
  });
  // Also include any equipment the user logged that isn't in defaults
  for (const [name, row] of latestByEquip) {
    if (!DEFAULT_EQUIPMENT.find((d) => d.equipment === name)) {
      result.push({
        unit: '°F',
        equipment: name,
        last: Number(row.temp_f),
        min: 35,
        max: 41,
        history: (historyByEquip.get(name) || []).slice(0, 14).reverse(),
      });
    }
  }
  return result;
}

export async function logTemperature(equipment, tempF, notes = null) {
  const { tenantId, user } = ctx();
  const within = null; // compute server-side later; for now let range be UI-only
  const { error } = await supabase
    .from('temp_logs')
    .insert({
      tenant_id: tenantId,
      equipment,
      temp_f: tempF,
      within_range: within,
      logged_by: user.id,
      notes,
    });
  if (error) throw error;
}

// -----------------------------------------------------------------------------
// WASTE LOGS
// -----------------------------------------------------------------------------
// UI shape: state.waste is an array of { date, item, qty, unit, reason, loss }.
// DB shape: waste_logs has logged_at (timestamp), item, qty, reason, dollar_loss.

export async function fetchWasteLogs() {
  const { data, error } = await supabase
    .from('waste_logs')
    .select('id, logged_at, item, qty, reason, dollar_loss')
    .order('logged_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data || []).map((w) => ({
    id: w.id,
    date: w.logged_at.slice(0, 10),
    item: w.item,
    qty: w.qty ? Number(w.qty) : 0,
    unit: 'ea',
    reason: w.reason || '',
    loss: Number(w.dollar_loss) || 0,
  }));
}

export async function logWaste({ item, qty, reason, loss }) {
  const { tenantId, user } = ctx();
  const { error } = await supabase
    .from('waste_logs')
    .insert({
      tenant_id: tenantId,
      item,
      qty: qty || 0,
      reason: reason || null,
      dollar_loss: loss || 0,
      logged_by: user.id,
    });
  if (error) throw error;
}

// -----------------------------------------------------------------------------
// INSPECTION CHECKS
// -----------------------------------------------------------------------------
// UI shape: state.inspChecks is a map { [code]: boolean } (true = passed)
// DB shape: inspection_checks has (tenant_id, code, passed, last_checked_at, checked_by, notes)
// 37 seeded per tenant.

export async function fetchInspectionChecks() {
  const { data, error } = await supabase
    .from('inspection_checks')
    .select('code, passed');
  if (error) throw error;
  const map = {};
  for (const row of data || []) map[row.code] = row.passed;
  return map;
}

export async function setInspectionCheck(code, passed) {
  const { user } = ctx();
  const { error } = await supabase
    .from('inspection_checks')
    .update({
      passed,
      last_checked_at: new Date().toISOString(),
      checked_by: user.id,
    })
    .eq('code', code);
  if (error) throw error;
}

// -----------------------------------------------------------------------------
// LICENSES
// -----------------------------------------------------------------------------
// UI shape: state.licenses is an array of { id, name, agency, number, issued, expires, status }
// DB shape: licenses has (id, tenant_id, name, agency, number, issued_on, expires_on, status, doc_url)

export async function fetchLicenses() {
  const { data, error } = await supabase
    .from('licenses')
    .select('id, name, agency, number, issued_on, expires_on, status')
    .order('expires_on', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data || []).map((l) => ({
    id: l.id,
    // Legacy UI field names (renderLicenses/complianceScore):
    doc: l.name,
    issuer: l.agency || '',
    num: l.number || '',
    issued: l.issued_on || 'N/A',
    exp: l.expires_on || 'N/A',
    // Canonical names (for future use):
    name: l.name,
    agency: l.agency || '',
    number: l.number || '',
    expires: l.expires_on || '',
    status: l.status || 'active',
  }));
}

export async function updateLicense(id, patch) {
  const dbPatch = {};
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.agency !== undefined) dbPatch.agency = patch.agency;
  if (patch.number !== undefined) dbPatch.number = patch.number;
  if (patch.issued !== undefined) dbPatch.issued_on = patch.issued || null;
  if (patch.expires !== undefined) dbPatch.expires_on = patch.expires || null;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  const { error } = await supabase.from('licenses').update(dbPatch).eq('id', id);
  if (error) throw error;
}

// -----------------------------------------------------------------------------
// INSPECTIONS (history) — optional v1, left for later
// -----------------------------------------------------------------------------
export async function fetchInspectionHistory() {
  const { data, error } = await supabase
    .from('inspections')
    .select('id, inspection_date, agency, score, violations, notes')
    .order('inspection_date', { ascending: false });
  if (error) throw error;
  return (data || []).map((i) => ({
    id: i.id,
    date: i.inspection_date,
    agency: i.agency || 'FL DBPR',
    score: i.score || 0,
    violations: Array.isArray(i.violations) ? i.violations.length : 0,
    notes: i.notes || '',
  }));
}
