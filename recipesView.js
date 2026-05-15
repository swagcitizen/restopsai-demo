// recipesView.js — Recipe Book: list, filters, editor modal, pizza build-card.
//
// Mounts into #recipe-book-root. Tabs in the editor:
//   Basics → Ingredients → Steps → Quiz → Training (read-only summary)
// Pizza recipes get an extra "Pizza Sizes" tab with a 3-column build-card grid.
//
// Exports: initRecipeBook({ tenantId, userId, role })
//          renderRecipeBook()
//          openRecipeInCookMode(recipeId)   — used by external triggers

import {
  ALLERGEN_CATALOG,
  RECIPE_CATEGORIES,
  RECIPE_UNITS,
  listRecipes,
  getRecipe,
  createRecipe,
  updateRecipe,
  deleteRecipe,
  upsertIngredients,
  upsertSteps,
  upsertQuiz,
  uploadRecipePhoto,
  listInventory,
  listStaff,
  allergenRollup,
  computeDirectCost,
  inferAllergensFromIngredients,
  listTrainingForRecipe,
} from './recipesRepo.js';

let _ctx = null;
let _recipes = [];
let _inventory = [];
let _staff = [];
let _filter = { status: 'all', category: 'all', q: '' };
let _editor = null; // { recipe, ingredients, steps, quiz, training, tab, dirty, saving }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
));
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const canEdit = () => _ctx?.role === 'owner' || _ctx?.role === 'manager';

// ---------------------------------------------------------------------------

export async function initRecipeBook({ tenantId, userId, role }) {
  _ctx = { tenantId, userId, role };
  await renderRecipeBook();
}

export async function renderRecipeBook() {
  const mount = document.getElementById('recipe-book-root');
  if (!mount) return;
  mount.innerHTML = `<div class="muted" style="padding:24px">Loading recipes…</div>`;

  try {
    const [recipes, inv, staff] = await Promise.all([
      listRecipes(),
      listInventory(),
      listStaff(),
    ]);
    _recipes = recipes;
    _inventory = inv;
    _staff = staff;
  } catch (err) {
    console.error('[recipes] load failed', err);
    mount.innerHTML = `<div class="card" style="padding:24px">
      <h3>Couldn't load recipes</h3>
      <p class="muted">${esc(err?.message || err)}</p>
    </div>`;
    return;
  }

  mount.innerHTML = template();
  wireListEvents(mount);
}

// ---------------------------------------------------------------------------
// LIST + FILTERS
// ---------------------------------------------------------------------------

function applyFilter(rows) {
  const q = _filter.q.trim().toLowerCase();
  return rows.filter(r => {
    if (_filter.status !== 'all' && r.status !== _filter.status) return false;
    if (_filter.category !== 'all' && r.category !== _filter.category) return false;
    if (q) {
      const hay = `${r.name || ''} ${r.description || ''} ${r.category || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function template() {
  const filtered = applyFilter(_recipes);
  const counts = {
    all: _recipes.length,
    published: _recipes.filter(r => r.status === 'published').length,
    draft: _recipes.filter(r => r.status === 'draft').length,
    archived: _recipes.filter(r => r.status === 'archived').length,
  };

  return `
  <div class="recipes-wrap">
    <div class="recipes-toolbar">
      <div class="recipes-toolbar-left">
        <div class="filter-chips" id="rb-status-chips">
          <button class="chip ${_filter.status==='all'?'active':''}" data-status="all">All <span class="chip-count">${counts.all}</span></button>
          <button class="chip ${_filter.status==='published'?'active':''}" data-status="published">Published <span class="chip-count">${counts.published}</span></button>
          <button class="chip ${_filter.status==='draft'?'active':''}" data-status="draft">Drafts <span class="chip-count">${counts.draft}</span></button>
          <button class="chip ${_filter.status==='archived'?'active':''}" data-status="archived">Archived <span class="chip-count">${counts.archived}</span></button>
        </div>
        <select id="rb-category" class="input" style="max-width:180px">
          <option value="all">All categories</option>
          ${RECIPE_CATEGORIES.map(c => `<option value="${c}" ${_filter.category===c?'selected':''}>${esc(c)}</option>`).join('')}
        </select>
        <input id="rb-search" class="input" type="search" placeholder="Search recipes…" value="${esc(_filter.q)}" style="max-width:240px" />
      </div>
      <div class="recipes-toolbar-right">
        ${canEdit() ? `<button class="btn-primary" id="rb-new">+ New recipe</button>` : ''}
      </div>
    </div>

    ${filtered.length === 0 ? emptyState() : `
      <div class="recipes-grid">
        ${filtered.map(recipeCard).join('')}
      </div>
    `}
  </div>
  `;
}

function emptyState() {
  return `
    <div class="card empty-card" style="padding:48px;text-align:center;margin-top:16px">
      <div style="font-size:48px;margin-bottom:8px">📖</div>
      <h3 style="margin:0 0 6px">No recipes yet</h3>
      <p class="muted" style="max-width:480px;margin:0 auto 16px">
        Build your recipe book so every dish comes out the same every time. Add ingredients linked to inventory, photo steps, and a short quiz to certify your team.
      </p>
      ${canEdit() ? `<button class="btn-primary" id="rb-new-empty">Create your first recipe</button>` : ''}
    </div>
  `;
}

function recipeCard(r) {
  const allergens = Array.isArray(r.allergens) ? r.allergens.slice(0, 4) : [];
  const cost = r.direct_cost != null ? Number(r.direct_cost) : null;
  const plate = r.plate_price != null ? Number(r.plate_price) : null;
  const margin = (cost != null && plate != null && plate > 0) ? Math.round(((plate - cost) / plate) * 100) : null;
  const hero = r.hero_photo_url
    ? `<div class="recipe-card-hero" style="background-image:url('${esc(r.hero_photo_url)}')"></div>`
    : `<div class="recipe-card-hero no-photo"><span>${esc(initialsOf(r.name))}</span></div>`;
  const statusBadge = r.status === 'published'
    ? `<span class="badge badge-success">Published</span>`
    : r.status === 'draft' ? `<span class="badge badge-warn">Draft</span>`
    : `<span class="badge">Archived</span>`;
  return `
    <article class="recipe-card" data-recipe-id="${esc(r.id)}">
      ${hero}
      <div class="recipe-card-body">
        <div class="recipe-card-head">
          <h4 class="recipe-card-title">${esc(r.name || 'Untitled')}</h4>
          ${statusBadge}
        </div>
        <div class="recipe-card-meta">
          ${r.category ? `<span class="meta-pill">${esc(r.category)}</span>` : ''}
          ${r.pizza_template ? `<span class="meta-pill meta-pill-accent">Pizza build-card</span>` : ''}
          ${r.is_subrecipe ? `<span class="meta-pill">Sub-recipe</span>` : ''}
        </div>
        <div class="recipe-card-numbers">
          ${cost != null ? `<div><span class="muted small">Cost</span><div class="num">${money(cost)}</div></div>` : ''}
          ${plate != null ? `<div><span class="muted small">Plate</span><div class="num">${money(plate)}</div></div>` : ''}
          ${margin != null ? `<div><span class="muted small">Margin</span><div class="num">${margin}%</div></div>` : ''}
        </div>
        ${allergens.length ? `<div class="recipe-card-allergens">
          ${allergens.map(a => `<span class="allergen-pill">${esc(a)}</span>`).join('')}
          ${r.allergens.length > 4 ? `<span class="allergen-pill more">+${r.allergens.length - 4}</span>` : ''}
        </div>` : ''}
        <div class="recipe-card-actions">
          <button class="btn-ghost btn-sm rb-open" data-id="${esc(r.id)}">Open</button>
          ${r.status === 'published' ? `<button class="btn-primary btn-sm rb-cook" data-id="${esc(r.id)}">Cook Mode</button>` : ''}
        </div>
      </div>
    </article>
  `;
}

function initialsOf(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
}

function wireListEvents(mount) {
  mount.querySelectorAll('#rb-status-chips .chip').forEach(c => {
    c.addEventListener('click', () => { _filter.status = c.dataset.status; renderRecipeBook(); });
  });
  const cat = mount.querySelector('#rb-category');
  if (cat) cat.addEventListener('change', () => { _filter.category = cat.value; renderRecipeBook(); });
  const search = mount.querySelector('#rb-search');
  if (search) {
    let t;
    search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { _filter.q = search.value; renderRecipeBook(); }, 180);
    });
  }
  mount.querySelectorAll('#rb-new, #rb-new-empty').forEach(b => {
    b.addEventListener('click', () => openEditor(null));
  });
  mount.querySelectorAll('.rb-open').forEach(b => {
    b.addEventListener('click', () => openEditor(b.dataset.id));
  });
  mount.querySelectorAll('.rb-cook').forEach(b => {
    b.addEventListener('click', () => openRecipeInCookMode(b.dataset.id));
  });
}

// ---------------------------------------------------------------------------
// EDITOR MODAL
// ---------------------------------------------------------------------------

async function openEditor(recipeId) {
  closeEditor();
  // Skeleton
  let recipe, ingredients, steps, quiz, training;
  if (recipeId) {
    try {
      const full = await getRecipe(recipeId);
      recipe = full.recipe;
      ingredients = full.ingredients || [];
      steps = full.steps || [];
      quiz = full.quiz || [];
    } catch (err) {
      console.error('[recipes] open failed', err);
      alert('Could not open recipe: ' + (err?.message || err));
      return;
    }
    try { training = await listTrainingForRecipe(recipeId); } catch { training = []; }
  } else {
    if (!canEdit()) return;
    try {
      recipe = await createRecipe({ name: 'New recipe', status: 'draft' });
      _recipes = [recipe, ..._recipes];
    } catch (err) {
      console.error('[recipes] create failed', err);
      alert('Could not create recipe: ' + (err?.message || err));
      return;
    }
    ingredients = []; steps = []; quiz = []; training = [];
  }

  _editor = {
    recipe, ingredients, steps, quiz, training,
    tab: 'basics', dirty: false, saving: false,
  };
  renderEditor();
}

function closeEditor() {
  _editor = null;
  document.getElementById('recipe-editor-modal')?.remove();
}

function markDirty() { if (_editor) _editor.dirty = true; }

function renderEditor() {
  if (!_editor) return;
  document.getElementById('recipe-editor-modal')?.remove();
  const r = _editor.recipe;
  const wrap = document.createElement('div');
  wrap.id = 'recipe-editor-modal';
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal modal-xl recipe-editor">
      <div class="modal-head">
        <div class="modal-title-wrap">
          <h2 class="modal-title">${esc(r.name || 'Untitled recipe')}</h2>
          <div class="muted small">${r.status === 'published' ? 'Published' : r.status === 'archived' ? 'Archived' : 'Draft'} · ${esc(r.category || 'uncategorized')}${r.pizza_template ? ' · Pizza build-card' : ''}</div>
        </div>
        <div class="modal-actions">
          ${r.status === 'published' ? `<button class="btn-primary btn-sm" id="re-cook">Cook Mode</button>` : ''}
          ${canEdit() ? `<button class="btn-ghost btn-sm" id="re-delete" title="Delete recipe">Delete</button>` : ''}
          <button class="btn-ghost btn-icon" id="re-close" aria-label="Close">✕</button>
        </div>
      </div>

      <div class="recipe-tabs">
        ${tabBtn('basics', 'Basics')}
        ${tabBtn('ingredients', `Ingredients (${_editor.ingredients.length})`)}
        ${tabBtn('steps', `Steps (${_editor.steps.length})`)}
        ${r.pizza_template ? tabBtn('pizza', 'Pizza Sizes') : ''}
        ${tabBtn('quiz', `Quiz (${_editor.quiz.length})`)}
        ${tabBtn('training', `Training (${_editor.training.length})`)}
      </div>

      <div class="modal-body recipe-editor-body" id="re-tab-body">
        ${renderTabBody()}
      </div>

      <div class="modal-foot">
        <span class="muted small" id="re-status">${_editor.dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <div class="modal-foot-actions">
          ${canEdit() && r.status !== 'published' ? `<button class="btn-ghost btn-sm" id="re-publish">Publish</button>` : ''}
          ${canEdit() && r.status === 'published' ? `<button class="btn-ghost btn-sm" id="re-unpublish">Unpublish</button>` : ''}
          ${canEdit() ? `<button class="btn-primary" id="re-save" ${_editor.saving ? 'disabled' : ''}>${_editor.saving ? 'Saving…' : 'Save'}</button>` : ''}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireEditorEvents(wrap);
}

function tabBtn(key, label) {
  const active = _editor.tab === key ? 'active' : '';
  return `<button class="recipe-tab ${active}" data-tab="${key}">${esc(label)}</button>`;
}

function renderTabBody() {
  switch (_editor.tab) {
    case 'basics':      return renderBasicsTab();
    case 'ingredients': return renderIngredientsTab();
    case 'steps':       return renderStepsTab();
    case 'pizza':       return renderPizzaTab();
    case 'quiz':        return renderQuizTab();
    case 'training':    return renderTrainingTab();
    default:            return '';
  }
}

function wireEditorEvents(wrap) {
  wrap.addEventListener('click', (e) => { if (e.target === wrap) confirmClose(); });
  wrap.querySelector('#re-close')?.addEventListener('click', confirmClose);

  wrap.querySelectorAll('.recipe-tab').forEach(t => {
    t.addEventListener('click', () => {
      if (_editor.tab === t.dataset.tab) return;
      _editor.tab = t.dataset.tab;
      // Re-render whole modal so tab counters update.
      renderEditor();
    });
  });

  wrap.querySelector('#re-save')?.addEventListener('click', saveEditor);
  wrap.querySelector('#re-delete')?.addEventListener('click', deleteFromEditor);
  wrap.querySelector('#re-publish')?.addEventListener('click', () => togglePublish('published'));
  wrap.querySelector('#re-unpublish')?.addEventListener('click', () => togglePublish('draft'));
  wrap.querySelector('#re-cook')?.addEventListener('click', () => openRecipeInCookMode(_editor.recipe.id));

  wireTabEvents(wrap);
}

function wireTabEvents(wrap) {
  switch (_editor.tab) {
    case 'basics':      wireBasicsEvents(wrap); break;
    case 'ingredients': wireIngredientsEvents(wrap); break;
    case 'steps':       wireStepsEvents(wrap); break;
    case 'pizza':       wirePizzaEvents(wrap); break;
    case 'quiz':        wireQuizEvents(wrap); break;
    case 'training':    /* read-only */ break;
  }
}

function confirmClose() {
  if (_editor?.dirty && !confirm('You have unsaved changes. Close anyway?')) return;
  closeEditor();
  renderRecipeBook();
}

// ---------------------------------------------------------------------------
// TAB: BASICS
// ---------------------------------------------------------------------------

function renderBasicsTab() {
  const r = _editor.recipe;
  const heroBg = r.hero_photo_url
    ? `<img src="${esc(r.hero_photo_url)}" alt="Hero" />`
    : `<div class="hero-placeholder muted">No photo yet</div>`;
  return `
    <div class="basics-grid">
      <div class="basics-left">
        <div class="form-row"><label>Name</label>
          <input id="rb-name" class="input" value="${esc(r.name || '')}" ${canEdit()?'':'disabled'} />
        </div>
        <div class="form-row"><label>Description</label>
          <textarea id="rb-desc" class="input" rows="3" ${canEdit()?'':'disabled'}>${esc(r.description || '')}</textarea>
        </div>
        <div class="form-row form-row-2">
          <div>
            <label>Category</label>
            <select id="rb-cat" class="input" ${canEdit()?'':'disabled'}>
              ${RECIPE_CATEGORIES.map(c => `<option value="${c}" ${r.category===c?'selected':''}>${esc(c)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Plate price</label>
            <input id="rb-price" class="input" type="number" step="0.01" min="0" value="${r.plate_price ?? ''}" ${canEdit()?'':'disabled'} />
          </div>
        </div>
        <div class="form-row form-row-3">
          <div>
            <label>Yield qty</label>
            <input id="rb-yield-qty" class="input" type="number" step="0.01" min="0" value="${r.yield_qty ?? 1}" ${canEdit()?'':'disabled'} />
          </div>
          <div>
            <label>Yield unit</label>
            <select id="rb-yield-unit" class="input" ${canEdit()?'':'disabled'}>
              ${RECIPE_UNITS.map(u => `<option value="${u}" ${r.yield_unit===u?'selected':''}>${esc(u)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="checkbox-row">
              <input type="checkbox" id="rb-sub" ${r.is_subrecipe?'checked':''} ${canEdit()?'':'disabled'} />
              Sub-recipe
            </label>
            <label class="checkbox-row">
              <input type="checkbox" id="rb-pizza" ${r.pizza_template?'checked':''} ${canEdit()?'':'disabled'} />
              Pizza build-card
            </label>
          </div>
        </div>
        <div class="form-row">
          <label>Allergens (auto-detected from ingredients; check any extras)</label>
          <div class="allergen-grid" id="rb-allergens">
            ${ALLERGEN_CATALOG.map(a => {
              const on = Array.isArray(r.allergens) && r.allergens.includes(a);
              return `<label class="allergen-check ${on?'on':''}">
                <input type="checkbox" value="${a}" ${on?'checked':''} ${canEdit()?'':'disabled'} />
                <span>${esc(a)}</span>
              </label>`;
            }).join('')}
          </div>
        </div>
      </div>

      <div class="basics-right">
        <label>Hero photo</label>
        <div class="hero-photo-box" id="rb-hero-box">
          ${heroBg}
        </div>
        ${canEdit() ? `
          <input type="file" id="rb-hero-file" accept="image/png,image/jpeg,image/webp,image/heic" hidden />
          <button class="btn-ghost btn-sm" id="rb-hero-btn">${r.hero_photo_url ? 'Replace photo' : 'Upload photo'}</button>
          <div class="muted small">Up to 25MB · JPG/PNG/WEBP/HEIC</div>
        ` : ''}
      </div>
    </div>
  `;
}

function wireBasicsEvents(wrap) {
  const onChange = () => markDirty();
  ['rb-name','rb-desc','rb-cat','rb-price','rb-yield-qty','rb-yield-unit','rb-sub','rb-pizza']
    .forEach(id => wrap.querySelector('#'+id)?.addEventListener('input', onChange));
  wrap.querySelectorAll('#rb-allergens input').forEach(i => i.addEventListener('change', () => {
    i.closest('.allergen-check')?.classList.toggle('on', i.checked);
    markDirty();
  }));
  // toggling pizza template re-renders so the Pizza tab appears
  wrap.querySelector('#rb-pizza')?.addEventListener('change', (e) => {
    pullBasicsIntoModel();
    _editor.recipe.pizza_template = !!e.target.checked;
    if (e.target.checked && !_editor.recipe.pizza_sizes) {
      _editor.recipe.pizza_sizes = {
        '10': { sauce_oz: 3, cheese_oz: 4, toppings: '' },
        '12': { sauce_oz: 4, cheese_oz: 6, toppings: '' },
        '16': { sauce_oz: 6, cheese_oz: 8, toppings: '' },
      };
    }
    renderEditor();
  });

  // Hero photo upload
  const file = wrap.querySelector('#rb-hero-file');
  const btn = wrap.querySelector('#rb-hero-btn');
  if (btn && file) {
    btn.addEventListener('click', () => file.click());
    file.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      btn.disabled = true; btn.textContent = 'Uploading…';
      try {
        const url = await uploadRecipePhoto(f, _editor.recipe.id, 'hero');
        _editor.recipe.hero_photo_url = url;
        // Persist immediately — file is uploaded, so save the URL too.
        await updateRecipe(_editor.recipe.id, { hero_photo_url: url });
        refreshCardInList(_editor.recipe.id, { hero_photo_url: url });
        renderEditor();
      } catch (err) {
        console.error('[recipes] hero upload failed', err);
        alert('Upload failed: ' + (err?.message || err));
        btn.disabled = false;
        btn.textContent = 'Upload photo';
      }
    });
  }
}

function pullBasicsIntoModel() {
  const wrap = document.getElementById('recipe-editor-modal');
  if (!wrap) return;
  const r = _editor.recipe;
  const get = (id) => wrap.querySelector('#'+id);
  if (get('rb-name'))   r.name = get('rb-name').value.trim();
  if (get('rb-desc'))   r.description = get('rb-desc').value.trim();
  if (get('rb-cat'))    r.category = get('rb-cat').value;
  if (get('rb-price'))  r.plate_price = get('rb-price').value ? Number(get('rb-price').value) : null;
  if (get('rb-yield-qty')) r.yield_qty = Number(get('rb-yield-qty').value || 1);
  if (get('rb-yield-unit')) r.yield_unit = get('rb-yield-unit').value;
  if (get('rb-sub'))    r.is_subrecipe = !!get('rb-sub').checked;
  if (get('rb-pizza'))  r.pizza_template = !!get('rb-pizza').checked;
  const allergenInputs = wrap.querySelectorAll('#rb-allergens input:checked');
  if (allergenInputs.length || wrap.querySelector('#rb-allergens')) {
    r.allergens = Array.from(allergenInputs).map(i => i.value);
  }
}

// ---------------------------------------------------------------------------
// TAB: INGREDIENTS
// ---------------------------------------------------------------------------

function renderIngredientsTab() {
  const rows = _editor.ingredients;
  const total = computeDirectCost(rows);
  const editable = canEdit();
  return `
    <div class="ing-toolbar">
      <div class="muted small">Linked to inventory: ${rows.filter(r => r.inventory_item_id).length}/${rows.length}</div>
      <div class="ing-total">Total direct cost: <strong>${money(total)}</strong></div>
    </div>
    <div class="ing-table-wrap">
      <table class="ing-table">
        <thead><tr>
          <th style="width:30%">Item</th>
          <th style="width:14%">Qty</th>
          <th style="width:12%">Unit</th>
          <th style="width:14%">Cost</th>
          <th>Prep note</th>
          ${editable ? '<th style="width:48px"></th>' : ''}
        </tr></thead>
        <tbody id="ing-tbody">
          ${rows.map((row, i) => ingredientRow(row, i, editable)).join('')}
        </tbody>
      </table>
    </div>
    ${editable ? `<div style="margin-top:12px"><button class="btn-ghost btn-sm" id="ing-add">+ Add ingredient</button></div>` : ''}
  `;
}

function ingredientRow(row, i, editable) {
  const invOpts = ['<option value="">— None (free text) —</option>']
    .concat(_inventory.map(inv => `<option value="${esc(inv.id)}" ${row.inventory_item_id===inv.id?'selected':''}>${esc(inv.name)} (${esc(inv.unit||'unit')})</option>`))
    .join('');
  const unit = row.unit || (row.inventory_item_id ? (_inventory.find(x=>x.id===row.inventory_item_id)?.unit || '') : '');
  const linked = !!row.inventory_item_id;
  return `
    <tr data-i="${i}">
      <td>
        <select class="input ing-inv" ${editable?'':'disabled'}>${invOpts}</select>
        <input class="input ing-name" placeholder="Or type a name" value="${esc(row.display_name || row.name || '')}" ${editable?'':'disabled'} style="margin-top:4px" />
      </td>
      <td><input class="input ing-qty" type="number" step="0.001" min="0" value="${row.qty ?? ''}" ${editable?'':'disabled'} /></td>
      <td>
        <select class="input ing-unit" ${editable?'':'disabled'}>
          ${RECIPE_UNITS.map(u => `<option value="${u}" ${unit===u?'selected':''}>${esc(u)}</option>`).join('')}
        </select>
      </td>
      <td>
        <input class="input ing-cost" type="number" step="0.0001" min="0" value="${row.cost_each ?? ''}" ${linked?'readonly':''} ${editable?'':'disabled'} title="${linked?'From inventory':'Per-unit cost'}" />
      </td>
      <td><input class="input ing-note" value="${esc(row.prep_note || '')}" placeholder="diced, room temp…" ${editable?'':'disabled'} /></td>
      ${editable ? `<td><button class="btn-icon ing-del" title="Remove">🗑</button></td>` : ''}
    </tr>
  `;
}

function wireIngredientsEvents(wrap) {
  const tbody = wrap.querySelector('#ing-tbody');
  const onAnyChange = () => { pullIngredientsIntoModel(); markDirty(); refreshIngredientsHeader(); };

  wrap.querySelector('#ing-add')?.addEventListener('click', () => {
    pullIngredientsIntoModel();
    _editor.ingredients.push({ display_name: '', qty: 1, unit: 'g', cost_each: 0 });
    markDirty();
    // Re-render just the ingredients tab
    document.getElementById('re-tab-body').innerHTML = renderIngredientsTab();
    wireIngredientsEvents(wrap);
  });

  tbody?.querySelectorAll('tr').forEach(tr => {
    const i = Number(tr.dataset.i);
    const invSel = tr.querySelector('.ing-inv');
    const nameInp = tr.querySelector('.ing-name');
    const unitSel = tr.querySelector('.ing-unit');
    const costInp = tr.querySelector('.ing-cost');
    const qtyInp = tr.querySelector('.ing-qty');
    const noteInp = tr.querySelector('.ing-note');

    invSel?.addEventListener('change', () => {
      const inv = _inventory.find(x => x.id === invSel.value);
      if (inv) {
        if (nameInp) nameInp.value = inv.name;
        if (unitSel && inv.unit) {
          // Keep custom unit if it's in our list
          const opt = Array.from(unitSel.options).find(o => o.value === inv.unit);
          if (opt) unitSel.value = inv.unit;
        }
        if (costInp && inv.cost_per_unit != null) {
          costInp.value = inv.cost_per_unit;
          costInp.readOnly = true;
        }
      } else if (costInp) {
        costInp.readOnly = false;
      }
      onAnyChange();
    });

    [nameInp, qtyInp, unitSel, costInp, noteInp].forEach(el => el?.addEventListener('input', onAnyChange));

    tr.querySelector('.ing-del')?.addEventListener('click', () => {
      pullIngredientsIntoModel();
      _editor.ingredients.splice(i, 1);
      markDirty();
      document.getElementById('re-tab-body').innerHTML = renderIngredientsTab();
      wireIngredientsEvents(wrap);
    });
  });
}

function pullIngredientsIntoModel() {
  const wrap = document.getElementById('recipe-editor-modal');
  if (!wrap) return;
  const rows = [];
  wrap.querySelectorAll('#ing-tbody tr').forEach(tr => {
    const invId = tr.querySelector('.ing-inv')?.value || null;
    rows.push({
      inventory_item_id: invId || null,
      display_name: tr.querySelector('.ing-name')?.value.trim() || null,
      name: tr.querySelector('.ing-name')?.value.trim() || null,
      qty: Number(tr.querySelector('.ing-qty')?.value || 0),
      unit: tr.querySelector('.ing-unit')?.value || null,
      cost_each: tr.querySelector('.ing-cost')?.value ? Number(tr.querySelector('.ing-cost').value) : 0,
      prep_note: tr.querySelector('.ing-note')?.value.trim() || null,
    });
  });
  _editor.ingredients = rows;
}

function refreshIngredientsHeader() {
  const total = computeDirectCost(_editor.ingredients);
  const wrap = document.getElementById('recipe-editor-modal');
  const totalEl = wrap?.querySelector('.ing-total');
  if (totalEl) totalEl.innerHTML = `Total direct cost: <strong>${money(total)}</strong>`;
}

// ---------------------------------------------------------------------------
// TAB: STEPS
// ---------------------------------------------------------------------------

function renderStepsTab() {
  const editable = canEdit();
  const rows = _editor.steps;
  return `
    <div class="muted small" style="margin-bottom:8px">
      Photo steps make Cook Mode foolproof. Mark critical steps (cook temp, allergen handling). Timers chime when complete.
    </div>
    <div class="steps-list" id="steps-list">
      ${rows.map((s, i) => stepRow(s, i, editable)).join('')}
      ${rows.length === 0 ? `<div class="muted" style="padding:16px;border:1px dashed var(--line);border-radius:8px;text-align:center">No steps yet. Add the first step below.</div>` : ''}
    </div>
    ${editable ? `<div style="margin-top:12px"><button class="btn-ghost btn-sm" id="step-add">+ Add step</button></div>` : ''}
  `;
}

function stepRow(s, i, editable) {
  return `
    <div class="step-row" data-i="${i}">
      <div class="step-num">${i+1}</div>
      <div class="step-body">
        <textarea class="input step-text" rows="2" placeholder="Instruction (large, plain language)" ${editable?'':'disabled'}>${esc(s.instruction || '')}</textarea>
        <div class="step-photo">
          ${s.photo_url ? `<img src="${esc(s.photo_url)}" alt="Step ${i+1}" />` : `<div class="step-photo-empty muted">No photo</div>`}
          ${editable ? `<input type="file" class="step-file" accept="image/png,image/jpeg,image/webp,image/heic" hidden /><button class="btn-ghost btn-sm step-upload">${s.photo_url?'Replace':'Upload photo'}</button>` : ''}
        </div>
        <div class="step-meta">
          <label class="step-meta-field">
            <span class="muted small">Timer (sec)</span>
            <input class="input step-timer" type="number" min="0" step="1" value="${s.timer_seconds ?? ''}" ${editable?'':'disabled'} />
          </label>
          <label class="step-meta-field">
            <span class="muted small">Tip</span>
            <input class="input step-tip" value="${esc(s.tip || '')}" placeholder="Optional helper text" ${editable?'':'disabled'} />
          </label>
          <label class="step-meta-field checkbox-row">
            <input type="checkbox" class="step-critical" ${s.critical?'checked':''} ${editable?'':'disabled'} />
            <span>Critical step</span>
          </label>
        </div>
      </div>
      ${editable ? `<div class="step-actions">
        <button class="btn-icon step-up" title="Move up">↑</button>
        <button class="btn-icon step-down" title="Move down">↓</button>
        <button class="btn-icon step-del" title="Remove">🗑</button>
      </div>` : ''}
    </div>
  `;
}

function wireStepsEvents(wrap) {
  wrap.querySelector('#step-add')?.addEventListener('click', () => {
    pullStepsIntoModel();
    _editor.steps.push({ instruction: '', timer_seconds: null, critical: false, tip: '' });
    markDirty();
    document.getElementById('re-tab-body').innerHTML = renderStepsTab();
    wireStepsEvents(wrap);
  });

  wrap.querySelectorAll('.step-row').forEach(row => {
    const i = Number(row.dataset.i);
    const refresh = () => { pullStepsIntoModel(); markDirty(); };

    ['step-text','step-timer','step-tip'].forEach(cls => {
      row.querySelector('.'+cls)?.addEventListener('input', refresh);
    });
    row.querySelector('.step-critical')?.addEventListener('change', refresh);

    row.querySelector('.step-up')?.addEventListener('click', () => {
      if (i === 0) return;
      pullStepsIntoModel();
      const a = _editor.steps;
      [a[i-1], a[i]] = [a[i], a[i-1]];
      markDirty();
      document.getElementById('re-tab-body').innerHTML = renderStepsTab();
      wireStepsEvents(wrap);
    });
    row.querySelector('.step-down')?.addEventListener('click', () => {
      pullStepsIntoModel();
      const a = _editor.steps;
      if (i >= a.length-1) return;
      [a[i+1], a[i]] = [a[i], a[i+1]];
      markDirty();
      document.getElementById('re-tab-body').innerHTML = renderStepsTab();
      wireStepsEvents(wrap);
    });
    row.querySelector('.step-del')?.addEventListener('click', () => {
      pullStepsIntoModel();
      _editor.steps.splice(i, 1);
      markDirty();
      document.getElementById('re-tab-body').innerHTML = renderStepsTab();
      wireStepsEvents(wrap);
    });

    const uploadBtn = row.querySelector('.step-upload');
    const file = row.querySelector('.step-file');
    if (uploadBtn && file) {
      uploadBtn.addEventListener('click', () => file.click());
      file.addEventListener('change', async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        uploadBtn.disabled = true; uploadBtn.textContent = 'Uploading…';
        try {
          const url = await uploadRecipePhoto(f, _editor.recipe.id, `step-${i+1}`);
          pullStepsIntoModel();
          _editor.steps[i].photo_url = url;
          markDirty();
          document.getElementById('re-tab-body').innerHTML = renderStepsTab();
          wireStepsEvents(wrap);
        } catch (err) {
          console.error('[recipes] step upload failed', err);
          alert('Upload failed: ' + (err?.message || err));
          uploadBtn.disabled = false;
          uploadBtn.textContent = 'Upload photo';
        }
      });
    }
  });
}

function pullStepsIntoModel() {
  const wrap = document.getElementById('recipe-editor-modal');
  if (!wrap) return;
  const rows = [];
  wrap.querySelectorAll('.step-row').forEach((r, i) => {
    rows.push({
      step_no: i + 1,
      instruction: r.querySelector('.step-text')?.value.trim() || '',
      timer_seconds: r.querySelector('.step-timer')?.value ? Number(r.querySelector('.step-timer').value) : null,
      tip: r.querySelector('.step-tip')?.value.trim() || null,
      critical: !!r.querySelector('.step-critical')?.checked,
      photo_url: _editor.steps[i]?.photo_url || null,
    });
  });
  _editor.steps = rows;
}

// ---------------------------------------------------------------------------
// TAB: PIZZA SIZES (build-card)
// ---------------------------------------------------------------------------

const PIZZA_SIZES = ['10', '12', '16'];

function renderPizzaTab() {
  const editable = canEdit();
  const sizes = _editor.recipe.pizza_sizes || {};
  return `
    <div class="muted small" style="margin-bottom:12px">
      Build-card per pizza size — ounces of sauce and cheese, plus standard toppings layout.
      Use this on the make-line so every pizza of the same size comes out identical.
    </div>
    <div class="pizza-grid">
      ${PIZZA_SIZES.map(sz => {
        const s = sizes[sz] || {};
        return `
          <div class="pizza-col" data-size="${sz}">
            <div class="pizza-col-head"><span class="pizza-size">${sz}"</span></div>
            <div class="form-row">
              <label>Sauce (oz)</label>
              <input class="input pz-sauce" type="number" step="0.1" min="0" value="${s.sauce_oz ?? ''}" ${editable?'':'disabled'} />
            </div>
            <div class="form-row">
              <label>Cheese (oz)</label>
              <input class="input pz-cheese" type="number" step="0.1" min="0" value="${s.cheese_oz ?? ''}" ${editable?'':'disabled'} />
            </div>
            <div class="form-row">
              <label>Toppings layout</label>
              <textarea class="input pz-toppings" rows="6" placeholder="One per line, e.g.&#10;Pepperoni (28 slices)&#10;Mushroom (1.5 oz)" ${editable?'':'disabled'}>${esc(s.toppings || '')}</textarea>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function wirePizzaEvents(wrap) {
  wrap.querySelectorAll('.pizza-col').forEach(col => {
    col.querySelectorAll('input,textarea').forEach(el => {
      el.addEventListener('input', () => { pullPizzaIntoModel(); markDirty(); });
    });
  });
}

function pullPizzaIntoModel() {
  const wrap = document.getElementById('recipe-editor-modal');
  if (!wrap) return;
  const out = {};
  wrap.querySelectorAll('.pizza-col').forEach(col => {
    const sz = col.dataset.size;
    out[sz] = {
      sauce_oz: Number(col.querySelector('.pz-sauce')?.value || 0),
      cheese_oz: Number(col.querySelector('.pz-cheese')?.value || 0),
      toppings: col.querySelector('.pz-toppings')?.value || '',
    };
  });
  _editor.recipe.pizza_sizes = out;
}

// ---------------------------------------------------------------------------
// TAB: QUIZ
// ---------------------------------------------------------------------------

function renderQuizTab() {
  const editable = canEdit();
  const rows = _editor.quiz;
  return `
    <div class="muted small" style="margin-bottom:12px">
      Short quiz to certify line cooks on this recipe. Passing score is 80%. 3–5 questions works best.
    </div>
    <div class="quiz-list" id="quiz-list">
      ${rows.map((q, i) => quizRow(q, i, editable)).join('')}
      ${rows.length === 0 ? `<div class="muted" style="padding:16px;border:1px dashed var(--line);border-radius:8px;text-align:center">No questions yet.</div>` : ''}
    </div>
    ${editable ? `<div style="margin-top:12px"><button class="btn-ghost btn-sm" id="quiz-add">+ Add question</button></div>` : ''}
  `;
}

function quizRow(q, i, editable) {
  const choices = Array.isArray(q.choices) ? q.choices : ['', '', '', ''];
  // Ensure 4 slots
  while (choices.length < 4) choices.push('');
  return `
    <div class="quiz-row" data-i="${i}">
      <div class="quiz-row-head">
        <div class="quiz-num">Q${i+1}</div>
        ${editable ? `<button class="btn-icon quiz-del" title="Remove">🗑</button>` : ''}
      </div>
      <div class="form-row">
        <label>Question</label>
        <input class="input quiz-q" value="${esc(q.question || '')}" ${editable?'':'disabled'} />
      </div>
      <div class="quiz-choices">
        ${choices.map((c, ci) => `
          <label class="quiz-choice">
            <input type="radio" name="quiz-correct-${i}" class="quiz-correct" value="${ci}" ${q.correct_idx===ci?'checked':''} ${editable?'':'disabled'} />
            <input class="input quiz-choice-text" data-ci="${ci}" value="${esc(c)}" placeholder="Choice ${ci+1}" ${editable?'':'disabled'} />
          </label>
        `).join('')}
      </div>
      <div class="muted small">Select the correct choice on the left.</div>
    </div>
  `;
}

function wireQuizEvents(wrap) {
  wrap.querySelector('#quiz-add')?.addEventListener('click', () => {
    pullQuizIntoModel();
    _editor.quiz.push({ question: '', choices: ['','','',''], correct_idx: 0, sort_order: _editor.quiz.length });
    markDirty();
    document.getElementById('re-tab-body').innerHTML = renderQuizTab();
    wireQuizEvents(wrap);
  });

  wrap.querySelectorAll('.quiz-row').forEach(row => {
    const i = Number(row.dataset.i);
    const refresh = () => { pullQuizIntoModel(); markDirty(); };
    row.querySelector('.quiz-q')?.addEventListener('input', refresh);
    row.querySelectorAll('.quiz-choice-text').forEach(el => el.addEventListener('input', refresh));
    row.querySelectorAll('.quiz-correct').forEach(el => el.addEventListener('change', refresh));
    row.querySelector('.quiz-del')?.addEventListener('click', () => {
      pullQuizIntoModel();
      _editor.quiz.splice(i, 1);
      markDirty();
      document.getElementById('re-tab-body').innerHTML = renderQuizTab();
      wireQuizEvents(wrap);
    });
  });
}

function pullQuizIntoModel() {
  const wrap = document.getElementById('recipe-editor-modal');
  if (!wrap) return;
  const rows = [];
  wrap.querySelectorAll('.quiz-row').forEach((r, i) => {
    const choices = [];
    r.querySelectorAll('.quiz-choice-text').forEach(el => choices.push(el.value || ''));
    const correct = r.querySelector('.quiz-correct:checked');
    rows.push({
      question: r.querySelector('.quiz-q')?.value.trim() || '',
      choices,
      correct_idx: correct ? Number(correct.value) : 0,
      sort_order: i,
    });
  });
  _editor.quiz = rows;
}

// ---------------------------------------------------------------------------
// TAB: TRAINING (read-only summary; full UI lives in trainingView.js)
// ---------------------------------------------------------------------------

function renderTrainingTab() {
  const t = _editor.training || [];
  if (t.length === 0) {
    return `<div class="muted" style="padding:16px;border:1px dashed var(--line);border-radius:8px;text-align:center">
      No staff have walked through this recipe yet.
    </div>`;
  }
  const certified = t.filter(x => x.certified).length;
  return `
    <div class="muted small" style="margin-bottom:8px">
      ${certified} of ${t.length} staff certified on this recipe. Use the Training section for the full dashboard.
    </div>
    <table class="ing-table">
      <thead><tr><th>Staff</th><th>Walked through</th><th>Quiz</th><th>Status</th></tr></thead>
      <tbody>
      ${t.map(row => {
        const staff = _staff.find(s => s.id === row.staff_id);
        const name = staff?.name || row.staff_id;
        const score = row.quiz_score != null && row.quiz_total ? `${row.quiz_score}/${row.quiz_total}` : '—';
        const walked = row.walked_through_at ? new Date(row.walked_through_at).toLocaleDateString() : '—';
        const status = row.certified
          ? `<span class="badge badge-success">Certified</span>`
          : `<span class="badge badge-warn">In progress</span>`;
        return `<tr><td>${esc(name)}</td><td>${walked}</td><td>${score}</td><td>${status}</td></tr>`;
      }).join('')}
      </tbody>
    </table>
  `;
}

// ---------------------------------------------------------------------------
// SAVE / DELETE / PUBLISH
// ---------------------------------------------------------------------------

async function saveEditor() {
  if (!_editor || _editor.saving) return;
  // Pull whatever tab is currently visible
  if (_editor.tab === 'basics')      pullBasicsIntoModel();
  if (_editor.tab === 'ingredients') pullIngredientsIntoModel();
  if (_editor.tab === 'steps')       pullStepsIntoModel();
  if (_editor.tab === 'pizza')       pullPizzaIntoModel();
  if (_editor.tab === 'quiz')        pullQuizIntoModel();

  _editor.saving = true;
  setStatus('Saving…');

  try {
    const r = _editor.recipe;
    // Auto-merge inferred allergens with user-checked.
    const inferred = inferAllergensFromIngredients(_editor.ingredients);
    const merged = Array.from(new Set([...(r.allergens || []), ...inferred])).sort();
    r.allergens = merged;

    const patch = {
      name: r.name,
      description: r.description,
      category: r.category,
      plate_price: r.plate_price,
      yield_qty: r.yield_qty,
      yield_unit: r.yield_unit,
      is_subrecipe: !!r.is_subrecipe,
      pizza_template: !!r.pizza_template,
      pizza_sizes: r.pizza_template ? (r.pizza_sizes || null) : null,
      allergens: r.allergens,
      hero_photo_url: r.hero_photo_url || null,
    };

    await updateRecipe(r.id, patch);
    await upsertIngredients(r.id, _editor.ingredients);
    await upsertSteps(r.id, _editor.steps);
    await upsertQuiz(r.id, _editor.quiz);

    _editor.dirty = false;
    _editor.saving = false;
    setStatus('All changes saved');

    // Refresh the card data in the underlying list
    refreshCardInList(r.id, patch);
    // Reload steps to pick up step_no normalization
    try {
      const full = await getRecipe(r.id);
      _editor.recipe = full.recipe;
      _editor.ingredients = full.ingredients || [];
      _editor.steps = full.steps || [];
      _editor.quiz = full.quiz || [];
    } catch { /* non-fatal */ }
    renderEditor();
  } catch (err) {
    console.error('[recipes] save failed', err);
    _editor.saving = false;
    setStatus('Save failed: ' + (err?.message || err));
    alert('Save failed: ' + (err?.message || err));
  }
}

async function deleteFromEditor() {
  if (!_editor || !canEdit()) return;
  if (!confirm(`Delete "${_editor.recipe.name || 'this recipe'}"? This cannot be undone.`)) return;
  try {
    await deleteRecipe(_editor.recipe.id);
    _recipes = _recipes.filter(r => r.id !== _editor.recipe.id);
    closeEditor();
    renderRecipeBook();
  } catch (err) {
    console.error('[recipes] delete failed', err);
    alert('Delete failed: ' + (err?.message || err));
  }
}

async function togglePublish(newStatus) {
  if (!_editor || !canEdit()) return;
  // Save current edits first
  if (_editor.dirty) await saveEditor();
  try {
    await updateRecipe(_editor.recipe.id, { status: newStatus });
    _editor.recipe.status = newStatus;
    refreshCardInList(_editor.recipe.id, { status: newStatus });
    renderEditor();
  } catch (err) {
    console.error('[recipes] publish toggle failed', err);
    alert('Publish failed: ' + (err?.message || err));
  }
}

function setStatus(msg) {
  const el = document.getElementById('re-status');
  if (el) el.textContent = msg;
}

function refreshCardInList(id, patch) {
  const idx = _recipes.findIndex(r => r.id === id);
  if (idx >= 0) _recipes[idx] = { ..._recipes[idx], ...patch };
}

// ---------------------------------------------------------------------------
// COOK MODE handoff
// ---------------------------------------------------------------------------

export async function openRecipeInCookMode(recipeId) {
  // Hand off to cookModeView (lazy-loaded by app.js).
  if (window.__cookModeOpen) {
    window.__cookModeOpen(recipeId);
  } else {
    try {
      const mod = await import('./cookModeView.js');
      mod.openCookMode({ recipeId, tenantId: _ctx?.tenantId, userId: _ctx?.userId, role: _ctx?.role });
    } catch (err) {
      console.error('[recipes] could not open cook mode', err);
      alert('Cook Mode failed to load.');
    }
  }
  closeEditor();
}
