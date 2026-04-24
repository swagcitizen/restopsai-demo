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
  { equipment: 'Walk-in Cooler',         min: 35,  max: 41,  last: 38,  kind: 'cold' },
  { equipment: 'Reach-in Cooler',        min: 35,  max: 41,  last: 39,  kind: 'cold' },
  { equipment: 'Freezer',                min: -5,  max: 10,  last: 2,   kind: 'cold' },
  { equipment: 'Pizza Prep Table',       min: 35,  max: 41,  last: 40,  kind: 'cold' },
  { equipment: 'Hot line - Steam table', min: 135, max: 175, last: 142, kind: 'hot' },
  { equipment: 'Hot line - Sauté pickup',min: 135, max: 175, last: 145, kind: 'hot' },
  { equipment: 'Pizza oven hold',        min: 135, max: 180, last: 150, kind: 'hot' },
  { equipment: 'Soup well',              min: 135, max: 180, last: 158, kind: 'hot' },
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
      label: d.equipment,
      kind: d.kind,
      last: latest ? Number(latest.temp_f) : d.last,
      lastLoggedAt: latest ? latest.logged_at : null,
      min: d.min,
      max: d.max,
      history: (historyByEquip.get(d.equipment) || []).slice(0, 14).reverse(),
    };
  });
  // Also include any equipment the user logged that isn't in defaults
  for (const [name, row] of latestByEquip) {
    if (!DEFAULT_EQUIPMENT.find((d) => d.equipment === name)) {
      const kind = Number(row.temp_f) >= 100 ? 'hot' : 'cold';
      result.push({
        unit: '°F',
        equipment: name,
        label: name,
        kind,
        last: Number(row.temp_f),
        lastLoggedAt: row.logged_at,
        min: kind === 'hot' ? 135 : 35,
        max: kind === 'hot' ? 175 : 41,
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

// -----------------------------------------------------------------------------
// MENU ITEMS
// -----------------------------------------------------------------------------
// UI shape: state.menu = [{ name, price, cost, units }, ...]
// DB shape: menu_items (id, tenant_id, name, price, food_cost, category, active, sort_order)
// Units sold come from daily_sales aggregation; for v1 we store units in-memory
// only (not per-item). When a tenant imports POS data, units can be derived.

export async function fetchMenu() {
  const { data, error } = await supabase
    .from('menu_items')
    .select('id, name, price, food_cost, category, active, sort_order')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data || []).map((m) => ({
    id: m.id,
    name: m.name,
    price: Number(m.price) || 0,
    cost: Number(m.food_cost) || 0,
    category: m.category || '',
    // Units are a UI-only best-guess until POS imports land:
    units: 0,
  }));
}

export async function updateMenuItem(id, patch) {
  const dbPatch = {};
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.price !== undefined) dbPatch.price = patch.price;
  if (patch.cost !== undefined) dbPatch.food_cost = patch.cost;
  if (patch.category !== undefined) dbPatch.category = patch.category;
  if (patch.active !== undefined) dbPatch.active = patch.active;
  if (Object.keys(dbPatch).length === 0) return;
  const { error } = await supabase.from('menu_items').update(dbPatch).eq('id', id);
  if (error) throw error;
}

export async function addMenuItem({ name, price = 0, cost = 0, category = null }) {
  const { tenantId } = ctx();
  const { data, error } = await supabase
    .from('menu_items')
    .insert({ tenant_id: tenantId, name, price, food_cost: cost, category, active: true, sort_order: 999 })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function seedMenuFromSample(sampleMenu) {
  // Idempotent-ish: only seeds if the tenant has no menu items yet.
  const existing = await fetchMenu();
  if (existing.length > 0) return existing;
  const { tenantId } = ctx();
  const rows = sampleMenu.map((m, i) => ({
    tenant_id: tenantId,
    name: m.name,
    price: m.price,
    food_cost: m.cost,
    category: null,
    active: true,
    sort_order: i,
  }));
  const { error } = await supabase.from('menu_items').insert(rows);
  if (error) throw error;
  return await fetchMenu();
}

// -----------------------------------------------------------------------------
// INVENTORY ITEMS
// -----------------------------------------------------------------------------
// UI shape: state.inv = [{ item, unit, onHand, par, reorder, cost, vendor }, ...]
// DB shape: inventory_items (id, tenant_id, name, unit, on_hand, par, unit_cost, supplier)
// Note: DB doesn't have a `reorder` threshold column — UI derives it as par * 0.6.

export async function fetchInventory() {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, name, unit, on_hand, par, unit_cost, supplier')
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []).map((i) => ({
    id: i.id,
    item: i.name,
    unit: i.unit,
    onHand: Number(i.on_hand) || 0,
    par: Number(i.par) || 0,
    reorder: Math.round((Number(i.par) || 0) * 0.6),
    cost: Number(i.unit_cost) || 0,
    vendor: i.supplier || '',
  }));
}

export async function updateInventoryItem(id, patch) {
  const dbPatch = {};
  if (patch.item !== undefined) dbPatch.name = patch.item;
  if (patch.unit !== undefined) dbPatch.unit = patch.unit;
  if (patch.onHand !== undefined) dbPatch.on_hand = patch.onHand;
  if (patch.par !== undefined) dbPatch.par = patch.par;
  if (patch.cost !== undefined) dbPatch.unit_cost = patch.cost;
  if (patch.vendor !== undefined) dbPatch.supplier = patch.vendor;
  if (Object.keys(dbPatch).length === 0) return;
  const { error } = await supabase.from('inventory_items').update(dbPatch).eq('id', id);
  if (error) throw error;
}

export async function seedInventoryFromSample(sampleInv) {
  const existing = await fetchInventory();
  if (existing.length > 0) return existing;
  const { tenantId } = ctx();
  const rows = sampleInv.map((i) => ({
    tenant_id: tenantId,
    name: i.item,
    unit: i.unit,
    on_hand: i.onHand,
    par: i.par,
    unit_cost: i.cost,
    supplier: i.vendor || null,
  }));
  const { error } = await supabase.from('inventory_items').insert(rows);
  if (error) throw error;
  return await fetchInventory();
}

// -----------------------------------------------------------------------------
// RECIPES + INGREDIENTS
// -----------------------------------------------------------------------------
// UI shape: state.recipes = [{ id, name, yield, menuPrice, ingredients: [{item,qty,unit,cost},...] }]
// DB shape: recipes (id, tenant_id, name, yield, menu_price, linked_menu_item_id)
//           recipe_ingredients (id, recipe_id, tenant_id, name, qty, unit, unit_cost, sort_order)

export async function fetchRecipes() {
  const { data: recipes, error: err1 } = await supabase
    .from('recipes')
    .select('id, name, yield, menu_price')
    .order('name', { ascending: true });
  if (err1) throw err1;
  if (!recipes || recipes.length === 0) return [];
  const ids = recipes.map(r => r.id);
  const { data: ings, error: err2 } = await supabase
    .from('recipe_ingredients')
    .select('id, recipe_id, name, qty, unit, unit_cost, sort_order')
    .in('recipe_id', ids)
    .order('sort_order', { ascending: true });
  if (err2) throw err2;
  const byRecipe = new Map();
  for (const ing of (ings || [])) {
    if (!byRecipe.has(ing.recipe_id)) byRecipe.set(ing.recipe_id, []);
    byRecipe.get(ing.recipe_id).push({
      id: ing.id,
      item: ing.name,
      qty: Number(ing.qty) || 0,
      unit: ing.unit || '',
      cost: Number(ing.unit_cost) || 0,
    });
  }
  return recipes.map((r) => ({
    id: r.id,
    name: r.name,
    yield: r.yield || 1,
    menuPrice: Number(r.menu_price) || 0,
    ingredients: byRecipe.get(r.id) || [],
  }));
}

export async function updateRecipeMenuPrice(id, menuPrice) {
  const { error } = await supabase
    .from('recipes')
    .update({ menu_price: menuPrice })
    .eq('id', id);
  if (error) throw error;
}

export async function updateRecipeIngredient(ingId, patch) {
  const dbPatch = {};
  if (patch.qty !== undefined) dbPatch.qty = patch.qty;
  if (patch.cost !== undefined) dbPatch.unit_cost = patch.cost;
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.unit !== undefined) dbPatch.unit = patch.unit;
  if (Object.keys(dbPatch).length === 0) return;
  const { error } = await supabase
    .from('recipe_ingredients')
    .update(dbPatch)
    .eq('id', ingId);
  if (error) throw error;
}

export async function seedRecipesFromSample(sampleRecipes) {
  const existing = await fetchRecipes();
  if (existing.length > 0) return existing;
  const { tenantId } = ctx();
  for (const r of sampleRecipes) {
    const { data: inserted, error: rErr } = await supabase
      .from('recipes')
      .insert({
        tenant_id: tenantId,
        name: r.name,
        yield: r.yield || 1,
        menu_price: r.menuPrice || 0,
      })
      .select('id')
      .single();
    if (rErr) throw rErr;
    const ings = (r.ingredients || []).map((ing, i) => ({
      recipe_id: inserted.id,
      tenant_id: tenantId,
      name: ing.item,
      qty: ing.qty,
      unit: ing.unit || '',
      unit_cost: ing.cost,
      sort_order: i,
    }));
    if (ings.length > 0) {
      const { error: iErr } = await supabase.from('recipe_ingredients').insert(ings);
      if (iErr) throw iErr;
    }
  }
  return await fetchRecipes();
}

// -----------------------------------------------------------------------------
// CUSTOMERS (CRM)
// -----------------------------------------------------------------------------
// UI shape: state.customers = [{ name, phone, orders, spent, last, tags }, ...]
// DB shape: customers (id, tenant_id, name, phone, email, orders, total_spent, last_order_date, tags, notes)

export async function fetchCustomers() {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, phone, email, orders, total_spent, last_order_date, tags, notes')
    .order('total_spent', { ascending: false });
  if (error) throw error;
  return (data || []).map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone || '',
    email: c.email || '',
    orders: c.orders || 0,
    spent: Number(c.total_spent) || 0,
    last: c.last_order_date || '2000-01-01',
    tags: Array.isArray(c.tags) ? c.tags : [],
    notes: c.notes || '',
  }));
}

export async function addCustomer({ name, phone = null, email = null, tags = [] }) {
  const { tenantId } = ctx();
  const { data, error } = await supabase
    .from('customers')
    .insert({ tenant_id: tenantId, name, phone, email, tags, orders: 0, total_spent: 0 })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCustomer(id, patch) {
  const dbPatch = {};
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.phone !== undefined) dbPatch.phone = patch.phone;
  if (patch.email !== undefined) dbPatch.email = patch.email;
  if (patch.tags !== undefined) dbPatch.tags = patch.tags;
  if (patch.notes !== undefined) dbPatch.notes = patch.notes;
  if (Object.keys(dbPatch).length === 0) return;
  const { error } = await supabase.from('customers').update(dbPatch).eq('id', id);
  if (error) throw error;
}

export async function seedCustomersFromSample(sampleCustomers) {
  const existing = await fetchCustomers();
  if (existing.length > 0) return existing;
  const { tenantId } = ctx();
  const rows = sampleCustomers.map((c) => ({
    tenant_id: tenantId,
    name: c.name,
    phone: c.phone || null,
    email: c.email || null,
    orders: c.orders || 0,
    total_spent: c.spent || 0,
    last_order_date: c.last || null,
    tags: c.tags || [],
  }));
  const { error } = await supabase.from('customers').insert(rows);
  if (error) throw error;
  return await fetchCustomers();
}

// -----------------------------------------------------------------------------
// DAILY SALES
// -----------------------------------------------------------------------------
// UI shape: state.sales30 = [{ day, dinein, takeout, delivery, catering, total }, ...]
// DB shape: daily_sales (id, tenant_id, sales_date, gross_revenue, net_revenue, transactions, food_cost, labor_cost, occupancy_cost, other_cost, source, raw)
// Channel breakdown (dinein/takeout/delivery/catering) lives in `raw` jsonb until POS imports split it out.

export async function fetchDailySales(days = 30) {
  const { data, error } = await supabase
    .from('daily_sales')
    .select('sales_date, gross_revenue, transactions, food_cost, labor_cost, raw')
    .order('sales_date', { ascending: true })
    .limit(days);
  if (error) throw error;
  return (data || []).map((d) => {
    const ch = (d.raw && d.raw.channels) || {};
    const total = Number(d.gross_revenue) || 0;
    return {
      day: d.sales_date,
      dinein:   Number(ch.dinein)   || total * 0.32,
      takeout:  Number(ch.takeout)  || total * 0.42,
      delivery: Number(ch.delivery) || total * 0.20,
      catering: Number(ch.catering) || total * 0.06,
      total,
    };
  });
}

export async function seedDailySalesFromSample(sampleSales) {
  const existing = await fetchDailySales(1);
  if (existing.length > 0) return existing;
  const { tenantId } = ctx();
  const rows = sampleSales.map((s) => ({
    tenant_id: tenantId,
    sales_date: s.day,
    gross_revenue: s.total,
    transactions: Math.round(s.total / 22), // rough $22 ticket
    food_cost: s.total * 0.30,
    labor_cost: s.total * 0.24,
    occupancy_cost: s.total * 0.08,
    other_cost: s.total * 0.06,
    source: 'manual',
    raw: { channels: { dinein: s.dinein, takeout: s.takeout, delivery: s.delivery, catering: s.catering } },
  }));
  const { error } = await supabase.from('daily_sales').insert(rows);
  if (error) throw error;
  return await fetchDailySales(sampleSales.length);
}

// ---------------------------------------------------------------------------
// Prep labels (day-dot / use-by)
// ---------------------------------------------------------------------------

// Default shelf-life hours by prep_type; override per-item at create time.
const DEFAULT_SHELF_HOURS = { prep: 72, open: 72, thaw: 24 };

export async function fetchPrepLabels({ includeVoided = false, limit = 200 } = {}) {
  let q = supabase
    .from('prep_labels')
    .select('id, item, prep_type, prepped_by, prepped_at, use_by, allergens, station, notes, voided_at, voided_reason')
    .order('use_by', { ascending: true })
    .limit(limit);
  if (!includeVoided) q = q.is('voided_at', null);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function createPrepLabel({ item, prepType = 'prep', preppedBy = null, shelfHours = null, allergens = [], station = null, notes = null }) {
  const ctx = await getTenantContext();
  if (!ctx) throw new Error('No tenant context');
  const hours = Number.isFinite(shelfHours) ? shelfHours : (DEFAULT_SHELF_HOURS[prepType] || 72);
  const now = new Date();
  const useBy = new Date(now.getTime() + hours * 3600 * 1000);
  const { data, error } = await supabase
    .from('prep_labels')
    .insert({
      tenant_id: ctx.tenant.id,
      item,
      prep_type: prepType,
      prepped_by: preppedBy,
      prepped_by_user: ctx.user?.id || null,
      prepped_at: now.toISOString(),
      use_by: useBy.toISOString(),
      allergens: Array.isArray(allergens) ? allergens : [],
      station,
      notes,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function voidPrepLabel(id, reason = 'Used') {
  const { data, error } = await supabase
    .from('prep_labels')
    .update({ voided_at: new Date().toISOString(), voided_reason: reason })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Lazy-import to avoid circular ref with tenantContext
async function getTenantContext() {
  const mod = await import('./tenantContext.js');
  return mod.getTenantContext();
}

