// prepLabelsRepo.js — Supabase-backed prep labels module.
// Manages prep_label_templates and prep_labels tables.
// RLS handles all tenant isolation — no manual auth.uid() checks here.
//
// Column notes (existing prep_labels table has legacy columns):
//   Legacy → New alias used by this repo:
//   item          → item_name   (new col; legacy col kept for backwards compat)
//   use_by        → use_by_at   (new col; legacy col kept for backwards compat)
//   prepped_by    → prepped_by_initials (new col)

import { supabase } from './supabaseClient.js';

// ─── Helper ──────────────────────────────────────────────────────────────────

function wrapError(e, msg) {
  const friendly = new Error(`${msg}: ${e?.message || e}`);
  friendly.original = e;
  return friendly;
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 3600 * 1000);
}

// ─── Templates ───────────────────────────────────────────────────────────────

/**
 * List all prep label templates for a tenant.
 * @param {string} tenantId
 * @returns {Promise<Array>}
 */
export async function listTemplates(tenantId) {
  const { data, error } = await supabase
    .from('prep_label_templates')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true });
  if (error) throw wrapError(error, 'Failed to load label templates');
  return data || [];
}

/**
 * Create a new template.
 * @param {string} tenantId
 * @param {object} payload
 */
export async function createTemplate(tenantId, payload) {
  const row = {
    tenant_id: tenantId,
    name: payload.name,
    category: payload.category || null,
    default_shelf_life_hours: payload.default_shelf_life_hours ?? 96,
    storage: payload.storage || 'refrigerated',
    allergens: payload.allergens || [],
    instructions: payload.instructions || null,
    inventory_item_id: payload.inventory_item_id || null,
    created_by: payload.created_by || null,
  };
  const { data, error } = await supabase
    .from('prep_label_templates')
    .insert(row)
    .select()
    .single();
  if (error) throw wrapError(error, 'Failed to create template');
  return data;
}

/**
 * Update a template by id.
 * @param {string} id
 * @param {object} patch
 */
export async function updateTemplate(id, patch) {
  const { data, error } = await supabase
    .from('prep_label_templates')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw wrapError(error, 'Failed to update template');
  return data;
}

/**
 * Delete a template by id.
 * @param {string} id
 */
export async function deleteTemplate(id) {
  const { error } = await supabase
    .from('prep_label_templates')
    .delete()
    .eq('id', id);
  if (error) throw wrapError(error, 'Failed to delete template');
}

// ─── Labels ──────────────────────────────────────────────────────────────────

/**
 * List active (non-voided) labels from the prep_labels_active view.
 * @param {string} tenantId
 * @param {{ limit?: number, status?: 'fresh'|'warning'|'expiring'|'expired' }} opts
 * @returns {Promise<Array>}
 */
export async function listActiveLabels(tenantId, opts = {}) {
  let q = supabase
    .from('prep_labels_active')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('prepped_at', { ascending: false });

  if (opts.status) {
    q = q.eq('status', opts.status);
  }
  if (opts.limit) {
    q = q.limit(opts.limit);
  }

  const { data, error } = await q;
  if (error) throw wrapError(error, 'Failed to load active labels');
  return data || [];
}

/**
 * Create a new prep label.
 * If use_by_at is not provided, it's computed from template default_shelf_life_hours (default 96h).
 * @param {string} tenantId
 * @param {object} payload
 */
export async function createLabel(tenantId, payload) {
  const now = new Date();
  const shelfHours = payload.shelf_life_hours ?? payload.default_shelf_life_hours ?? 96;
  const useByAt = payload.use_by_at
    ? new Date(payload.use_by_at)
    : addHours(now, shelfHours);

  const itemName = payload.item_name || payload.item || '';

  const row = {
    tenant_id: tenantId,
    template_id: payload.template_id || null,
    // New canonical columns
    item_name: itemName,
    use_by_at: useByAt.toISOString(),
    prepped_by_initials: payload.prepped_by_initials || payload.prepped_by || '??',
    prepped_by_user_id: payload.prepped_by_user_id || null,
    storage: payload.storage || 'refrigerated',
    allergens: payload.allergens || [],
    lot_number: payload.lot_number || null,
    batch_quantity: payload.batch_quantity ?? null,
    batch_unit: payload.batch_unit || null,
    notes: payload.notes || null,
    station: payload.station || null,
    prepped_at: payload.prepped_at || now.toISOString(),
    // Legacy columns (kept for backwards compat with existing app.js code)
    item: itemName,
    use_by: useByAt.toISOString(),
    prepped_by: payload.prepped_by_initials || payload.prepped_by || '??',
    prepped_by_user: payload.prepped_by_user_id || null,
    prep_type: payload.prep_type || 'prep',
  };

  const { data, error } = await supabase
    .from('prep_labels')
    .insert(row)
    .select()
    .single();
  if (error) throw wrapError(error, 'Failed to create prep label');
  return data;
}

/**
 * Mark a label as printed (set printed_at = now).
 * @param {string} id
 */
export async function markPrinted(id) {
  const { data, error } = await supabase
    .from('prep_labels')
    .update({ printed_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw wrapError(error, 'Failed to mark label as printed');
  return data;
}

/**
 * Void a label.
 * @param {string} id
 * @param {string} reason
 */
export async function voidLabel(id, reason) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('prep_labels')
    .update({
      voided_at: now,
      void_reason: reason || 'Voided',
      voided_reason: reason || 'Voided', // legacy column alias
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw wrapError(error, 'Failed to void label');
  return data;
}

// ─── Seed common templates ────────────────────────────────────────────────────

const COMMON_TEMPLATES = [
  { name: 'Marinara Sauce',      category: 'Sauce',    default_shelf_life_hours: 96,  storage: 'refrigerated', allergens: [] },
  { name: 'Pizza Dough',         category: 'Prep',     default_shelf_life_hours: 48,  storage: 'refrigerated', allergens: ['gluten'] },
  { name: 'Pizza Sauce',         category: 'Sauce',    default_shelf_life_hours: 96,  storage: 'refrigerated', allergens: [] },
  { name: 'Caesar Dressing',     category: 'Dressing', default_shelf_life_hours: 72,  storage: 'refrigerated', allergens: ['egg', 'fish'] },
  { name: 'Ranch Dressing',      category: 'Dressing', default_shelf_life_hours: 120, storage: 'refrigerated', allergens: ['dairy', 'egg'] },
  { name: 'Balsamic Vinaigrette',category: 'Dressing', default_shelf_life_hours: 240, storage: 'refrigerated', allergens: [] },
  { name: 'Cooked Chicken',      category: 'Protein',  default_shelf_life_hours: 96,  storage: 'refrigerated', allergens: [] },
  { name: 'Grilled Vegetables',  category: 'Prep',     default_shelf_life_hours: 72,  storage: 'refrigerated', allergens: [] },
  { name: 'Cut Lettuce',         category: 'Produce',  default_shelf_life_hours: 72,  storage: 'refrigerated', allergens: [] },
  { name: 'Diced Tomatoes',      category: 'Produce',  default_shelf_life_hours: 48,  storage: 'refrigerated', allergens: [] },
  { name: 'Sliced Onions',       category: 'Produce',  default_shelf_life_hours: 96,  storage: 'refrigerated', allergens: [] },
  { name: 'Garlic Confit',       category: 'Prep',     default_shelf_life_hours: 336, storage: 'refrigerated', allergens: [] },
  { name: 'Pesto',               category: 'Sauce',    default_shelf_life_hours: 72,  storage: 'refrigerated', allergens: ['tree nut'] },
  { name: 'Alfredo Sauce',       category: 'Sauce',    default_shelf_life_hours: 48,  storage: 'refrigerated', allergens: ['dairy'] },
  { name: 'Meatballs Cooked',    category: 'Protein',  default_shelf_life_hours: 96,  storage: 'refrigerated', allergens: ['gluten', 'egg'] },
];

/**
 * Seed ~15 common templates for a tenant. Idempotent (ON CONFLICT DO NOTHING
 * via the unique(tenant_id, name) constraint).
 * @param {string} tenantId
 */
export async function seedCommonTemplates(tenantId) {
  const rows = COMMON_TEMPLATES.map((t) => ({
    tenant_id: tenantId,
    name: t.name,
    category: t.category,
    default_shelf_life_hours: t.default_shelf_life_hours,
    storage: t.storage,
    allergens: t.allergens,
  }));

  const { data, error } = await supabase
    .from('prep_label_templates')
    .upsert(rows, { onConflict: 'tenant_id,name', ignoreDuplicates: true })
    .select();

  if (error) throw wrapError(error, 'Failed to seed common templates');
  return data || [];
}
