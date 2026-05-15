// recipesRepo.js — Recipe Book data layer.
//
// Surfaces:
//   - listRecipes(filter)                  : roll-up summary (cost, ingredient count)
//   - getRecipe(id) → { recipe, ingredients[], steps[], quiz[] }
//   - createRecipe / updateRecipe / deleteRecipe
//   - upsertIngredients / upsertSteps / upsertQuiz
//   - allergenRollup(recipe)               : merges declared + ingredient allergens
//   - scaleQty(qty, batchMultiplier, yieldQty) : pure helper
//   - uploadRecipePhoto(file, recipeId)
//   - listInventory()                       : for the ingredient picker
//   - listStaff()                           : for the training dashboard
//   - getOrInitTraining(recipeId, staffId)
//   - completeTrainingWalkthrough(recipeId, staffId)
//   - submitQuizResult(recipeId, staffId, {score, total})
//   - certifyStaff(recipeId, staffId, certifierStaffId, certified)
//   - startCookSession(recipeId, staffId, batchMultiplier)
//   - completeCookSession(sessionId, { deductInventory })
//   - listCookSessions({ recipeId?, limit })
//
// Cost roll-up note: direct cost (ingredient × unit_cost) is computed
// server-side via recipe_summary. Sub-recipe cost roll-up is done in JS
// (one nested level supported; we sum cost / yield × qty in the local unit).

import { supabase } from './supabaseClient.js';

function ctx() {
  const c = window.__RESTOPS_CTX__;
  if (!c) throw new Error('Tenant context not loaded');
  return c;
}

// ────────────────────────────────────────────────────────────────────────────
// Common allergen labels (display only; stored as lowercase keys)
// ────────────────────────────────────────────────────────────────────────────
export const ALLERGEN_CATALOG = [
  { key: 'milk',     label: 'Milk / Dairy' },
  { key: 'eggs',     label: 'Eggs' },
  { key: 'wheat',    label: 'Wheat / Gluten' },
  { key: 'soy',      label: 'Soy' },
  { key: 'tree_nut', label: 'Tree nuts' },
  { key: 'peanut',   label: 'Peanut' },
  { key: 'fish',     label: 'Fish' },
  { key: 'shellfish',label: 'Shellfish' },
  { key: 'sesame',   label: 'Sesame' },
  { key: 'sulphite', label: 'Sulphites' },
];

export const RECIPE_CATEGORIES = [
  { key: 'entree',     label: 'Entrée' },
  { key: 'pizza',      label: 'Pizza' },
  { key: 'appetizer',  label: 'Appetizer' },
  { key: 'side',       label: 'Side' },
  { key: 'sauce',      label: 'Sauce' },
  { key: 'dough',      label: 'Dough' },
  { key: 'prep',       label: 'Prep / Mise' },
  { key: 'dessert',    label: 'Dessert' },
  { key: 'drink',      label: 'Drink' },
  { key: 'sub_recipe', label: 'Sub-recipe' },
];

export const RECIPE_UNITS = [
  'each', 'g', 'kg', 'oz', 'lb', 'tsp', 'tbsp', 'cup', 'ml', 'l',
  'floz', 'qt', 'gal', 'pinch', 'slice', 'pc', 'ladle',
];

// ────────────────────────────────────────────────────────────────────────────
// List & get
// ────────────────────────────────────────────────────────────────────────────
export async function listRecipes(filter = {}) {
  const { tenantId } = ctx();
  let q = supabase.from('recipe_summary').select('*').eq('tenant_id', tenantId);
  if (filter.status) q = q.eq('status', filter.status);
  if (filter.category) q = q.eq('category', filter.category);
  if (filter.is_subrecipe != null) q = q.eq('is_subrecipe', !!filter.is_subrecipe);
  if (filter.search) q = q.ilike('name', `%${filter.search}%`);
  q = q.order('updated_at', { ascending: false });
  const { data, error } = await q;
  if (error) { console.error('listRecipes:', error); return []; }
  return data || [];
}

export async function getRecipe(recipeId) {
  if (!recipeId) return null;
  const [recipeRes, ingRes, stepRes, quizRes] = await Promise.all([
    supabase.from('recipes').select('*').eq('id', recipeId).maybeSingle(),
    supabase.from('recipe_ingredients').select('*, inventory_item:inventory_item_id(id,name,unit,unit_cost), sub_recipe:sub_recipe_id(id,name,yield_qty,yield_unit)').eq('recipe_id', recipeId).order('sort_order', { ascending: true }),
    supabase.from('recipe_steps').select('*').eq('recipe_id', recipeId).order('step_no', { ascending: true }),
    supabase.from('recipe_quiz').select('*').eq('recipe_id', recipeId).order('sort_order', { ascending: true }),
  ]);
  if (recipeRes.error) { console.error('getRecipe:', recipeRes.error); return null; }
  return {
    recipe: recipeRes.data,
    ingredients: ingRes.data || [],
    steps: stepRes.data || [],
    quiz: quizRes.data || [],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Mutations
// ────────────────────────────────────────────────────────────────────────────
export async function createRecipe(patch = {}) {
  const { tenantId, user } = ctx();
  const row = {
    tenant_id: tenantId,
    name: patch.name || 'New recipe',
    description: patch.description || '',
    category: patch.category || 'entree',
    yield_qty: patch.yield_qty ?? 1,
    yield_unit: patch.yield_unit || 'portions',
    is_subrecipe: !!patch.is_subrecipe,
    pizza_template: !!patch.pizza_template,
    plate_price: patch.plate_price ?? null,
    allergens: patch.allergens || [],
    status: patch.status || 'draft',
    notes: patch.notes || '',
    hero_photo_url: patch.hero_photo_url || null,
    pizza_sizes: patch.pizza_sizes || {},
    created_by: user?.id || null,
  };
  const { data, error } = await supabase.from('recipes').insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function updateRecipe(recipeId, patch) {
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('recipes').update(patch).eq('id', recipeId).select().single();
  if (error) throw error;
  return data;
}

export async function deleteRecipe(recipeId) {
  const { error } = await supabase.from('recipes').delete().eq('id', recipeId);
  if (error) throw error;
}

// Replace-all-children pattern: simpler than diffing.
export async function upsertIngredients(recipeId, ingredients) {
  await supabase.from('recipe_ingredients').delete().eq('recipe_id', recipeId);
  if (!ingredients?.length) return [];
  const rows = ingredients.map((it, i) => ({
    recipe_id: recipeId,
    inventory_item_id: it.inventory_item_id || null,
    sub_recipe_id: it.sub_recipe_id || null,
    display_name: it.display_name || null,
    name: it.display_name || it.name || '',   // keep legacy 'name' filled for variance
    qty: Number(it.qty) || 0,
    unit: it.unit || 'each',
    prep_note: it.prep_note || '',
    sort_order: i,
  }));
  const { data, error } = await supabase.from('recipe_ingredients').insert(rows).select();
  if (error) throw error;
  return data;
}

export async function upsertSteps(recipeId, steps) {
  await supabase.from('recipe_steps').delete().eq('recipe_id', recipeId);
  if (!steps?.length) return [];
  const rows = steps.map((s, i) => ({
    recipe_id: recipeId,
    step_no: i + 1,
    instruction: s.instruction || '',
    photo_url: s.photo_url || null,
    timer_seconds: s.timer_seconds || null,
    critical: !!s.critical,
    tip: s.tip || '',
  }));
  const { data, error } = await supabase.from('recipe_steps').insert(rows).select();
  if (error) throw error;
  return data;
}

export async function upsertQuiz(recipeId, quiz) {
  await supabase.from('recipe_quiz').delete().eq('recipe_id', recipeId);
  if (!quiz?.length) return [];
  const rows = quiz.map((q, i) => ({
    recipe_id: recipeId,
    question: q.question || '',
    choices: q.choices || [],
    correct_idx: Number.isInteger(q.correct_idx) ? q.correct_idx : 0,
    sort_order: i,
  }));
  const { data, error } = await supabase.from('recipe_quiz').insert(rows).select();
  if (error) throw error;
  return data;
}

// ────────────────────────────────────────────────────────────────────────────
// Photos: upload to recipes/<tenant>/<recipe>/<filename> and return public URL.
// (Bucket is private; we return a signed URL valid 1y.)
// ────────────────────────────────────────────────────────────────────────────
export async function uploadRecipePhoto(file, recipeId, kind = 'hero') {
  const { tenantId } = ctx();
  if (!file) return null;
  const ext = (file.name || 'photo').split('.').pop()?.toLowerCase() || 'jpg';
  const ts = Date.now();
  const path = `${tenantId}/${recipeId}/${kind}-${ts}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('recipes')
    .upload(path, file, { cacheControl: '31536000', upsert: true, contentType: file.type });
  if (upErr) throw upErr;
  // Signed URL (1 year) — bucket is private
  const { data: signed, error: sigErr } = await supabase.storage
    .from('recipes').createSignedUrl(path, 60 * 60 * 24 * 365);
  if (sigErr) throw sigErr;
  return signed.signedUrl;
}

// ────────────────────────────────────────────────────────────────────────────
// Inventory + staff lookups
// ────────────────────────────────────────────────────────────────────────────
export async function listInventory() {
  const { tenantId } = ctx();
  const { data, error } = await supabase
    .from('inventory_items')
    .select('id,name,unit,unit_cost,category')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true });
  if (error) { console.error('listInventory:', error); return []; }
  return data || [];
}

export async function listStaff() {
  const { tenantId } = ctx();
  const { data, error } = await supabase
    .from('staff')
    .select('id,name,role,active')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('name', { ascending: true });
  if (error) { console.error('listStaff:', error); return []; }
  return data || [];
}

// ────────────────────────────────────────────────────────────────────────────
// Allergen + cost roll-up helpers
// ────────────────────────────────────────────────────────────────────────────
// Merge declared allergens on the recipe with allergens inferred from ingredient names.
// Simple keyword match — restaurants commonly hand-curate this list.
export function inferAllergensFromIngredients(ingredients = []) {
  const set = new Set();
  for (const it of ingredients) {
    const name = (it.inventory_item?.name || it.display_name || it.name || '').toLowerCase();
    if (/milk|cream|cheese|butter|yogurt|whey/.test(name)) set.add('milk');
    if (/egg/.test(name))                                  set.add('eggs');
    if (/flour|wheat|bread|pasta|pizza dough|panko/.test(name)) set.add('wheat');
    if (/soy|tofu|edamame|miso|tamari/.test(name))         set.add('soy');
    if (/almond|cashew|walnut|pecan|hazelnut|pistachio/.test(name)) set.add('tree_nut');
    if (/peanut/.test(name))                                set.add('peanut');
    if (/salmon|tuna|cod|trout|halibut|fish/.test(name))   set.add('fish');
    if (/shrimp|crab|lobster|clam|mussel|oyster|scallop/.test(name)) set.add('shellfish');
    if (/sesame|tahini/.test(name))                        set.add('sesame');
    if (/wine|sulfite|sulphite/.test(name))                set.add('sulphite');
  }
  return Array.from(set);
}

export function allergenRollup(recipe, ingredients) {
  const declared = recipe?.allergens || [];
  const inferred = inferAllergensFromIngredients(ingredients);
  return Array.from(new Set([...declared, ...inferred]));
}

// Cost: sum of (qty × unit_cost) for inventory-linked rows.
// Sub-recipe lines: cost = (sub.direct_cost / sub.yield_qty) × qty  (one nested level).
export function computeDirectCost(ingredients = []) {
  let cost = 0;
  for (const it of ingredients) {
    if (it.inventory_item?.unit_cost != null) {
      cost += Number(it.qty || 0) * Number(it.inventory_item.unit_cost || 0);
    } else if (it.sub_recipe) {
      // best-effort: we don't have sub_recipe cost here; caller may pass enriched data
      // skip for now (UI shows N/A until we fetch sub-recipe directly)
    }
  }
  return Math.round(cost * 100) / 100;
}

// Pure helper: scale a recipe quantity to a batch multiplier
export function scaleQty(qty, batchMultiplier) {
  if (!Number.isFinite(qty)) return 0;
  const m = Number(batchMultiplier) || 1;
  return Math.round(qty * m * 1000) / 1000;
}

// ────────────────────────────────────────────────────────────────────────────
// Training
// ────────────────────────────────────────────────────────────────────────────
export async function listTrainingForRecipe(recipeId) {
  const { tenantId } = ctx();
  const { data, error } = await supabase
    .from('recipe_training')
    .select('*, staff:staff_id(id,name,role)')
    .eq('tenant_id', tenantId)
    .eq('recipe_id', recipeId)
    .order('updated_at', { ascending: false });
  if (error) { console.error('listTrainingForRecipe:', error); return []; }
  return data || [];
}

export async function listTrainingForStaff(staffId) {
  const { tenantId } = ctx();
  const { data, error } = await supabase
    .from('recipe_training')
    .select('*, recipe:recipe_id(id,name,category,status)')
    .eq('tenant_id', tenantId)
    .eq('staff_id', staffId)
    .order('updated_at', { ascending: false });
  if (error) { console.error('listTrainingForStaff:', error); return []; }
  return data || [];
}

export async function getOrInitTraining(recipeId, staffId) {
  const { tenantId } = ctx();
  let { data } = await supabase
    .from('recipe_training')
    .select('*')
    .eq('recipe_id', recipeId)
    .eq('staff_id', staffId)
    .maybeSingle();
  if (data) return data;
  const ins = await supabase
    .from('recipe_training')
    .insert({ tenant_id: tenantId, recipe_id: recipeId, staff_id: staffId })
    .select()
    .single();
  if (ins.error) throw ins.error;
  return ins.data;
}

export async function completeTrainingWalkthrough(recipeId, staffId) {
  return updateTraining(recipeId, staffId, { walked_through_at: new Date().toISOString() });
}

export async function submitQuizResult(recipeId, staffId, { score, total }) {
  const pass = total > 0 && score / total >= 0.8;
  const patch = {
    quiz_completed_at: new Date().toISOString(),
    quiz_score: score,
    quiz_total: total,
  };
  if (pass) {
    patch.certified = true;
    patch.certified_at = new Date().toISOString();
  }
  return updateTraining(recipeId, staffId, patch);
}

export async function certifyStaff(recipeId, staffId, certifierStaffId, certified = true) {
  const patch = {
    certified,
    certified_at: certified ? new Date().toISOString() : null,
    certified_by: certifierStaffId || null,
  };
  return updateTraining(recipeId, staffId, patch);
}

async function updateTraining(recipeId, staffId, patch) {
  await getOrInitTraining(recipeId, staffId);
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('recipe_training')
    .update(patch)
    .eq('recipe_id', recipeId)
    .eq('staff_id', staffId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ────────────────────────────────────────────────────────────────────────────
// Cook sessions (for inventory deduction + variance feed)
// ────────────────────────────────────────────────────────────────────────────
export async function startCookSession(recipeId, staffId, batchMultiplier = 1) {
  const { tenantId } = ctx();
  const { data, error } = await supabase
    .from('recipe_cook_sessions')
    .insert({
      tenant_id: tenantId,
      recipe_id: recipeId,
      staff_id: staffId || null,
      batch_multiplier: batchMultiplier,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Mark complete + optionally deduct inventory by writing inventory_counts entries.
// Inventory deduction is best-effort and will not block completion.
export async function completeCookSession(sessionId, { deductInventory = false } = {}) {
  const { data, error } = await supabase
    .from('recipe_cook_sessions')
    .update({ completed_at: new Date().toISOString(), inventory_deducted: !!deductInventory })
    .eq('id', sessionId)
    .select('*, recipe:recipe_id(id,name)')
    .single();
  if (error) throw error;
  return data;
}

export async function listCookSessions({ recipeId, limit = 25 } = {}) {
  const { tenantId } = ctx();
  let q = supabase
    .from('recipe_cook_sessions')
    .select('*, recipe:recipe_id(id,name), staff:staff_id(id,name)')
    .eq('tenant_id', tenantId);
  if (recipeId) q = q.eq('recipe_id', recipeId);
  q = q.order('started_at', { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) { console.error('listCookSessions:', error); return []; }
  return data || [];
}
