// prepLabelsView.js — Food Prep Labels (FDA Food Code 3-501.17 compliant)
// Integrated into the Food Safety view's "Prep Labels" tab.
// Exports: initPrepLabels({ tenantId, userId, userEmail })

import {
  listTemplates,
  createTemplate,
  listActiveLabels,
  createLabel,
  markPrinted,
  voidLabel,
  seedCommonTemplates,
} from './prepLabelsRepo.js';
import { getPrinterSettings } from './printerSettingsRepo.js';
import { printLabel as nativePrint, applyPrintCSS } from './printerDriver.js';

let _printerSettings = null;
async function ensurePrinterSettings() {
  if (_printerSettings) return _printerSettings;
  try { _printerSettings = await getPrinterSettings(); }
  catch (err) { console.warn('Could not load printer settings, using defaults:', err); _printerSettings = null; }
  return _printerSettings;
}

// ─── Day-dot colors (NCCO/Saffron industry standard) ─────────────────────────
const DAY_DOT = {
  0: { color: '#1a1a1a', label: 'Sun' },
  1: { color: '#1e88e5', label: 'Mon' },
  2: { color: '#fbc02d', label: 'Tue' },
  3: { color: '#d32f2f', label: 'Wed' },
  4: { color: '#6d4c41', label: 'Thu' },
  5: { color: '#43a047', label: 'Fri' },
  6: { color: '#f57c00', label: 'Sat' },
};

// FDA Big 9 allergens
const ALLERGENS = [
  { key: 'dairy',     label: 'Dairy' },
  { key: 'gluten',    label: 'Gluten' },
  { key: 'egg',       label: 'Egg' },
  { key: 'soy',       label: 'Soy' },
  { key: 'tree nut',  label: 'Tree Nut' },
  { key: 'peanut',    label: 'Peanut' },
  { key: 'fish',      label: 'Fish' },
  { key: 'shellfish', label: 'Shellfish' },
  { key: 'sesame',    label: 'Sesame' },
];

// ─── Module state ─────────────────────────────────────────────────────────────
let _ctx = null;            // { tenantId, userId, userEmail }
let _templates = [];        // all templates for this tenant
let _labels = [];           // current active labels from view
let _filterStatus = 'all';  // 'all' | 'fresh' | 'warning' | 'expiring' | 'expired'
let _searchQuery = '';
let _selectedTemplate = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initPrepLabels({ tenantId, userId, userEmail }) {
  _ctx = { tenantId, userId, userEmail };

  // Wire up section if it's already in the DOM (tab may not be active yet)
  const panel = document.querySelector('.tab-panel[data-tab="labels"]');
  if (!panel) return;

  // Replace the legacy tab panel contents with our enhanced version
  renderPanelShell(panel);
  wireHandlers(panel);

  // Load data in parallel
  try {
    [_templates, _labels] = await Promise.all([
      listTemplates(tenantId),
      listActiveLabels(tenantId),
    ]);

    // If no templates, seed the common ones silently
    if (_templates.length === 0) {
      seedCommonTemplates(tenantId).then((seeded) => {
        _templates = seeded;
        renderTemplateDatalist();
      }).catch(() => null); // non-blocking
    } else {
      renderTemplateDatalist();
    }
  } catch (e) {
    console.warn('[prepLabelsView] init fetch failed', e);
  }

  renderKpis();
  renderLabelList();
  updateFormFromTemplate(null); // clear
}

// ─── Panel shell (replaces the legacy HTML content) ──────────────────────────

function renderPanelShell(panel) {
  panel.innerHTML = `
    <!-- KPI row -->
    <div class="kpi-grid kpi-4" id="pl-kpi-row">
      <div class="kpi"><div class="kpi-label">Active labels</div><div class="kpi-value" id="pl-active">—</div></div>
      <div class="kpi"><div class="kpi-label">Expiring &lt;24h</div><div class="kpi-value" id="pl-soon">—</div><div class="kpi-foot">Use first</div></div>
      <div class="kpi"><div class="kpi-label">Past use-by</div><div class="kpi-value" id="pl-expired">—</div><div class="kpi-foot">Discard</div></div>
      <div class="kpi"><div class="kpi-label">Printed today</div><div class="kpi-value" id="pl-today">—</div></div>
    </div>

    <!-- Two-column layout -->
    <div class="pl-columns">

      <!-- LEFT: Create label form -->
      <div class="pl-left">
        <div class="card pl-form-card">
          <div class="card-head">
            <h3>Create prep label</h3>
            <span class="muted">FDA Food Code 3-501.17</span>
          </div>

          <form id="pl-create-form" autocomplete="off" novalidate>

            <!-- Item picker -->
            <div class="field">
              <label for="pl-item">Item name</label>
              <div style="position:relative">
                <input type="text" id="pl-item" list="pl-template-list"
                  placeholder="e.g. Marinara Sauce" autocomplete="off" required />
                <datalist id="pl-template-list"></datalist>
              </div>
              <div class="pl-template-hint" id="pl-tpl-hint" style="display:none"></div>
            </div>

            <!-- Prepped by initials + Storage -->
            <div class="pl-row-2">
              <div class="field">
                <label for="pl-initials">Prepped by (initials)</label>
                <input type="text" id="pl-initials" placeholder="ZB" maxlength="3"
                  style="text-transform:uppercase" required />
              </div>
              <div class="field">
                <label>Storage</label>
                <div class="pl-storage-radios" id="pl-storage-radios">
                  <label class="pl-radio"><input type="radio" name="pl-storage" value="refrigerated" checked /> Refrigerated</label>
                  <label class="pl-radio"><input type="radio" name="pl-storage" value="frozen" /> Frozen</label>
                  <label class="pl-radio"><input type="radio" name="pl-storage" value="hot_hold" /> Hot hold</label>
                  <label class="pl-radio"><input type="radio" name="pl-storage" value="dry" /> Dry</label>
                </div>
              </div>
            </div>

            <!-- Shelf life -->
            <div class="field">
              <label for="pl-hours">Shelf life (hours)</label>
              <div class="pl-hours-row">
                <input type="number" id="pl-hours" min="1" max="720" step="1" placeholder="96" />
                <div class="pl-quick-hours">
                  <button type="button" class="ghost-btn pl-quick" data-h="24">+24h</button>
                  <button type="button" class="ghost-btn pl-quick" data-h="48">+48h</button>
                  <button type="button" class="ghost-btn pl-quick" data-h="72">+72h</button>
                  <button type="button" class="ghost-btn pl-quick" data-h="168">+1 wk</button>
                </div>
              </div>
            </div>

            <!-- Allergens -->
            <div class="field">
              <label>Allergens (FDA Big 9)</label>
              <div class="pl-allergen-chips" id="pl-allergen-chips">
                ${ALLERGENS.map(a => `<button type="button" class="pl-allergen-chip" data-key="${a.key}">${a.label}</button>`).join('')}
              </div>
            </div>

            <!-- Optional fields (collapsed) -->
            <details class="pl-optional">
              <summary class="pl-optional-toggle">Optional fields</summary>
              <div class="pl-optional-body">
                <div class="pl-row-2">
                  <div class="field">
                    <label for="pl-lot">Lot number</label>
                    <input type="text" id="pl-lot" placeholder="Batch #" />
                  </div>
                  <div class="field">
                    <label for="pl-station">Station</label>
                    <input type="text" id="pl-station" placeholder="Sauce, Fry…" />
                  </div>
                </div>
                <div class="pl-row-2">
                  <div class="field">
                    <label for="pl-qty">Batch qty</label>
                    <input type="number" id="pl-qty" min="0" step="0.1" placeholder="0" />
                  </div>
                  <div class="field">
                    <label for="pl-unit">Unit</label>
                    <select id="pl-unit">
                      <option value="">—</option>
                      <option value="gal">gal</option>
                      <option value="qt">qt</option>
                      <option value="lbs">lbs</option>
                      <option value="oz">oz</option>
                      <option value="kg">kg</option>
                      <option value="L">L</option>
                      <option value="cups">cups</option>
                      <option value="each">each</option>
                    </select>
                  </div>
                </div>
                <div class="field">
                  <label for="pl-notes">Notes / instructions</label>
                  <textarea id="pl-notes" rows="2" placeholder="Recipe notes, special handling…"></textarea>
                </div>
              </div>
            </details>

            <div class="pl-form-actions">
              <button type="submit" class="btn" id="pl-print-btn">Print label</button>
              <button type="button" class="ghost-btn" id="pl-save-btn">Save only</button>
              <button type="button" class="ghost-btn" id="pl-reset-btn">Reset</button>
            </div>

          </form>
        </div>
      </div>

      <!-- RIGHT: Active labels list -->
      <div class="pl-right">
        <div class="card">
          <div class="card-head">
            <h3>Active labels</h3>
            <span class="muted" id="pl-count-label">0 active</span>
          </div>

          <!-- Filter chips -->
          <div class="pl-filter-chips" id="pl-filter-chips">
            <button class="pl-filter-chip active" data-status="all">All</button>
            <button class="pl-filter-chip" data-status="fresh">Fresh</button>
            <button class="pl-filter-chip" data-status="warning">Expiring &lt;24h</button>
            <button class="pl-filter-chip" data-status="expiring">Expiring &lt;6h</button>
            <button class="pl-filter-chip" data-status="expired">Expired</button>
          </div>

          <!-- Search -->
          <div class="pl-search-wrap">
            <input type="search" id="pl-search" placeholder="Search labels…" />
          </div>

          <div id="pl-label-list" class="pl-label-list"></div>
        </div>
      </div>

    </div>

    <!-- Print target: visually offscreen, revealed only @media print -->
    <div id="pl-print-target" class="prep-label-print" aria-hidden="true"></div>

    <!-- Detail modal -->
    <div id="pl-detail-modal" class="pl-modal" style="display:none">
      <div class="pl-modal-backdrop"></div>
      <div class="pl-modal-card">
        <div class="pl-modal-head">
          <span class="pl-modal-title" id="pl-modal-item-name"></span>
          <button class="pl-modal-close" id="pl-modal-close" aria-label="Close">&times;</button>
        </div>
        <div id="pl-modal-body"></div>
        <div class="pl-modal-actions">
          <button class="btn" id="pl-modal-reprint">Reprint</button>
          <button class="ghost-btn" id="pl-modal-void">Void label</button>
        </div>
      </div>
    </div>
  `;
}

// ─── Render helpers ───────────────────────────────────────────────────────────

function renderKpis() {
  const now = Date.now();
  const active = _labels.length;
  const soon = _labels.filter(l => {
    const ms = new Date(l.use_by_at).getTime() - now;
    return ms > 0 && ms < 24 * 3600 * 1000;
  }).length;
  const expired = _labels.filter(l => new Date(l.use_by_at).getTime() < now).length;
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const today = _labels.filter(l => l.printed_at && new Date(l.printed_at) >= todayStart).length;

  setText('pl-active', active);
  setText('pl-soon', soon);
  setText('pl-expired', expired);
  setText('pl-today', today);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function renderTemplateDatalist() {
  const dl = document.getElementById('pl-template-list');
  if (!dl) return;
  dl.innerHTML = _templates.map(t =>
    `<option value="${esc(t.name)}" data-id="${t.id}">${esc(t.category ? `${t.name} (${t.category})` : t.name)}</option>`
  ).join('');
}

function renderLabelList() {
  const container = document.getElementById('pl-label-list');
  const countEl = document.getElementById('pl-count-label');
  if (!container) return;

  let filtered = _labels;

  // Status filter
  if (_filterStatus !== 'all') {
    filtered = filtered.filter(l => l.status === _filterStatus);
  }

  // Search filter
  if (_searchQuery.trim()) {
    const q = _searchQuery.toLowerCase();
    filtered = filtered.filter(l =>
      (l.item_name || '').toLowerCase().includes(q) ||
      (l.station || '').toLowerCase().includes(q) ||
      (l.prepped_by_initials || '').toLowerCase().includes(q)
    );
  }

  if (countEl) countEl.textContent = `${filtered.length} active`;

  if (filtered.length === 0) {
    container.innerHTML = `<div class="pl-empty">No labels found.</div>`;
    return;
  }

  container.innerHTML = filtered.map(l => labelCardHTML(l)).join('');
}

function labelCardHTML(l) {
  const prepped = new Date(l.prepped_at);
  const useBy = new Date(l.use_by_at);
  const dow = prepped.getDay();
  const dot = DAY_DOT[dow];
  const hoursLeft = Math.round((useBy - Date.now()) / 3600000);
  const statusClass = l.status === 'expired' ? 'pl-status-expired'
    : l.status === 'expiring' ? 'pl-status-expiring'
    : l.status === 'warning' ? 'pl-status-warning'
    : 'pl-status-fresh';

  const timeLeft = hoursLeft < 0
    ? `<span class="${statusClass}">${Math.abs(hoursLeft)}h overdue</span>`
    : hoursLeft < 24
    ? `<span class="${statusClass}">${hoursLeft}h left</span>`
    : `<span class="${statusClass}">${Math.round(hoursLeft / 24)}d left</span>`;

  const allergenBadges = (l.allergens || []).length > 0
    ? `<div class="pl-card-allergens">${(l.allergens).map(a => `<span class="pl-allergen-badge">${a}</span>`).join('')}</div>`
    : '';

  return `
    <div class="pl-label-card" data-id="${l.id}" data-status="${l.status}">
      <div class="pl-day-stripe" style="background:${dot.color}" title="${dot.label}"></div>
      <div class="pl-card-body">
        <div class="pl-card-name">${esc(l.item_name)}</div>
        <div class="pl-card-meta">
          <span>Prepped: ${fmtDt(prepped)} by <strong>${esc(l.prepped_by_initials)}</strong></span>
        </div>
        <div class="pl-card-meta">
          <span>Use by: ${fmtDt(useBy)} — ${timeLeft}</span>
        </div>
        ${allergenBadges}
        <div class="pl-card-actions">
          <button class="ghost-btn pl-reprint-btn" data-label-reprint="${l.id}">Reprint</button>
          <button class="ghost-btn pl-void-btn"   data-label-void="${l.id}">Void</button>
        </div>
      </div>
    </div>
  `;
}

// ─── Form helpers ─────────────────────────────────────────────────────────────

function getFormValues() {
  const item = document.getElementById('pl-item')?.value.trim() || '';
  const initials = (document.getElementById('pl-initials')?.value.trim() || '').toUpperCase();
  const hours = parseFloat(document.getElementById('pl-hours')?.value) || null;
  const storage = document.querySelector('input[name="pl-storage"]:checked')?.value || 'refrigerated';
  const allergens = Array.from(document.querySelectorAll('#pl-allergen-chips .pl-allergen-chip.active'))
    .map(b => b.dataset.key);
  const lot = document.getElementById('pl-lot')?.value.trim() || null;
  const station = document.getElementById('pl-station')?.value.trim() || null;
  const qty = parseFloat(document.getElementById('pl-qty')?.value) || null;
  const unit = document.getElementById('pl-unit')?.value || null;
  const notes = document.getElementById('pl-notes')?.value.trim() || null;
  return { item, initials, hours, storage, allergens, lot, station, qty, unit, notes };
}

function resetForm() {
  const form = document.getElementById('pl-create-form');
  if (!form) return;
  form.reset();
  // De-activate allergen chips
  document.querySelectorAll('#pl-allergen-chips .pl-allergen-chip').forEach(b => b.classList.remove('active'));
  // Re-check refrigerated
  const refRadio = document.querySelector('input[name="pl-storage"][value="refrigerated"]');
  if (refRadio) refRadio.checked = true;
  _selectedTemplate = null;
  document.getElementById('pl-tpl-hint').style.display = 'none';
  document.getElementById('pl-hours').placeholder = '96';
  document.getElementById('pl-item').focus();
}

function updateFormFromTemplate(tpl) {
  _selectedTemplate = tpl;
  const hint = document.getElementById('pl-tpl-hint');
  if (!tpl) {
    if (hint) hint.style.display = 'none';
    return;
  }
  // Auto-fill shelf-life
  const hoursInput = document.getElementById('pl-hours');
  if (hoursInput && tpl.default_shelf_life_hours) {
    hoursInput.value = tpl.default_shelf_life_hours;
    hoursInput.placeholder = tpl.default_shelf_life_hours;
  }
  // Auto-fill storage
  const storageRadio = document.querySelector(`input[name="pl-storage"][value="${tpl.storage || 'refrigerated'}"]`);
  if (storageRadio) storageRadio.checked = true;
  // Auto-fill allergens
  document.querySelectorAll('#pl-allergen-chips .pl-allergen-chip').forEach(b => {
    b.classList.toggle('active', (tpl.allergens || []).includes(b.dataset.key));
  });
  // Show hint
  if (hint) {
    hint.style.display = 'block';
    hint.textContent = `Template: ${tpl.default_shelf_life_hours}h shelf-life · ${tpl.storage || 'refrigerated'}${tpl.category ? ` · ${tpl.category}` : ''}`;
  }
}

// ─── Print ────────────────────────────────────────────────────────────────────

function buildPrintHTML(label) {
  const prepped = new Date(label.prepped_at || label.created_at);
  const useBy = new Date(label.use_by_at);
  const dow = prepped.getDay();
  const dot = DAY_DOT[dow];

  const allergenStr = (label.allergens || []).join(', ');
  const showDot = !_printerSettings || _printerSettings.print_day_dot !== false;
  const showAllergens = !_printerSettings || _printerSettings.print_allergens !== false;

  return `
    <div class="prep-label-print">
      <div class="pl-print-inner">
        ${showDot ? `<div class="pl-print-stripe" style="background:${dot.color}"></div>` : ''}
        <div class="pl-print-content">
          <div class="pl-print-name">${esc(label.item_name)}</div>
          <div class="pl-print-row"><span class="pl-print-lbl">Prepped:</span> ${fmtDt(prepped)} by ${esc(label.prepped_by_initials)}</div>
          <div class="pl-print-row"><span class="pl-print-lbl">Use by:</span> ${fmtDt(useBy)}</div>
          ${label.storage && label.storage !== 'refrigerated' ? `<div class="pl-print-row"><span class="pl-print-lbl">Storage:</span> ${label.storage.replace('_', ' ')}</div>` : ''}
          ${showAllergens && allergenStr ? `<div class="pl-print-allergens">${(label.allergens).map(a => `<span class="pl-print-allergen">${a.toUpperCase()}</span>`).join('')}</div>` : ''}
          ${label.lot_number ? `<div class="pl-print-row pl-print-small"><span class="pl-print-lbl">Lot:</span> ${esc(label.lot_number)}</div>` : ''}
          ${label.station ? `<div class="pl-print-row pl-print-small"><span class="pl-print-lbl">Station:</span> ${esc(label.station)}</div>` : ''}
        </div>
      </div>
    </div>
  `;
}

async function doPrint(label) {
  const target = document.getElementById('pl-print-target');
  if (!target) return;
  target.innerHTML = buildPrintHTML(label);
  const settings = await ensurePrinterSettings();
  // Honor 'auto_open_dialog' — if user disabled it (rare), skip the dialog.
  if (settings && settings.auto_open_dialog === false) return;
  if (settings) {
    // Native driver path (Brother USB / Star BT) or browser fallback w/ correct @page
    const node = target.querySelector('.prep-label-print') || target;
    await nativePrint(node, settings);
    return;
  }
  // No settings yet — inject default CSS and open the print dialog.
  applyPrintCSS({ label_preset: 'dymo_30252', orientation: 'landscape', margin_mm: 0 });
  setTimeout(() => window.print(), 50);
}

// ─── Detail modal ─────────────────────────────────────────────────────────────

let _modalLabelId = null;

function openDetailModal(label) {
  _modalLabelId = label.id;
  const modal = document.getElementById('pl-detail-modal');
  const titleEl = document.getElementById('pl-modal-item-name');
  const bodyEl = document.getElementById('pl-modal-body');
  if (!modal) return;

  titleEl.textContent = label.item_name;

  const prepped = new Date(label.prepped_at || label.created_at);
  const useBy = new Date(label.use_by_at);
  const hoursLeft = Math.round((useBy - Date.now()) / 3600000);

  bodyEl.innerHTML = `
    <div class="pl-modal-details">
      <div class="pl-modal-row"><span>Status</span><span class="pl-status-${label.status}">${label.status}</span></div>
      <div class="pl-modal-row"><span>Prepped</span><span>${fmtDt(prepped)} by <strong>${esc(label.prepped_by_initials)}</strong></span></div>
      <div class="pl-modal-row"><span>Use by</span><span>${fmtDt(useBy)} (${hoursLeft > 0 ? hoursLeft + 'h left' : Math.abs(hoursLeft) + 'h overdue'})</span></div>
      <div class="pl-modal-row"><span>Storage</span><span>${(label.storage || 'refrigerated').replace('_', ' ')}</span></div>
      ${label.allergens?.length ? `<div class="pl-modal-row"><span>Allergens</span><span>${label.allergens.join(', ')}</span></div>` : ''}
      ${label.station ? `<div class="pl-modal-row"><span>Station</span><span>${esc(label.station)}</span></div>` : ''}
      ${label.lot_number ? `<div class="pl-modal-row"><span>Lot #</span><span>${esc(label.lot_number)}</span></div>` : ''}
      ${label.batch_quantity ? `<div class="pl-modal-row"><span>Batch</span><span>${label.batch_quantity} ${label.batch_unit || ''}</span></div>` : ''}
      ${label.notes ? `<div class="pl-modal-row"><span>Notes</span><span>${esc(label.notes)}</span></div>` : ''}
      ${label.printed_at ? `<div class="pl-modal-row"><span>Printed</span><span>${fmtDt(new Date(label.printed_at))}</span></div>` : ''}
    </div>
  `;

  modal.style.display = 'flex';
}

function closeDetailModal() {
  const modal = document.getElementById('pl-detail-modal');
  if (modal) modal.style.display = 'none';
  _modalLabelId = null;
}

// ─── Wire handlers ────────────────────────────────────────────────────────────

function wireHandlers(panel) {
  // Form submit
  panel.addEventListener('submit', async (e) => {
    if (e.target.id !== 'pl-create-form') return;
    e.preventDefault();
    await handleCreateLabel(true);
  });

  // Save-only button
  panel.addEventListener('click', async (e) => {
    if (e.target.id === 'pl-save-btn') {
      await handleCreateLabel(false);
      return;
    }

    // Reset
    if (e.target.id === 'pl-reset-btn') {
      resetForm();
      return;
    }

    // Quick-hour buttons
    if (e.target.classList.contains('pl-quick')) {
      const h = parseInt(e.target.dataset.h, 10);
      const inp = document.getElementById('pl-hours');
      if (inp) { inp.value = h; inp.placeholder = h; }
      return;
    }

    // Allergen chip toggles
    if (e.target.classList.contains('pl-allergen-chip')) {
      e.target.classList.toggle('active');
      return;
    }

    // Label card click -> open modal
    const card = e.target.closest('.pl-label-card');
    if (card && !e.target.closest('button')) {
      const id = card.dataset.id;
      const label = _labels.find(l => l.id === id);
      if (label) openDetailModal(label);
      return;
    }

    // Reprint button on card
    if (e.target.dataset.labelReprint) {
      const id = e.target.dataset.labelReprint;
      const label = _labels.find(l => l.id === id);
      if (label) {
        doPrint(label);
        markPrinted(id).catch(console.warn);
      }
      return;
    }

    // Void button on card
    if (e.target.dataset.labelVoid) {
      const id = e.target.dataset.labelVoid;
      const reason = prompt('Void reason (optional):') ?? 'Voided';
      if (reason === null) return; // cancelled
      try {
        await voidLabel(id, reason || 'Voided');
        _labels = _labels.filter(l => l.id !== id);
        renderKpis();
        renderLabelList();
      } catch (err) {
        alert('Could not void label: ' + err.message);
      }
      return;
    }

    // Filter chips
    if (e.target.classList.contains('pl-filter-chip')) {
      document.querySelectorAll('.pl-filter-chip').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
      _filterStatus = e.target.dataset.status;
      renderLabelList();
      return;
    }

    // Modal close
    if (e.target.id === 'pl-modal-close' || e.target.classList.contains('pl-modal-backdrop')) {
      closeDetailModal();
      return;
    }

    // Modal reprint
    if (e.target.id === 'pl-modal-reprint') {
      const label = _labels.find(l => l.id === _modalLabelId);
      if (label) {
        doPrint(label);
        markPrinted(label.id).catch(console.warn);
      }
      closeDetailModal();
      return;
    }

    // Modal void
    if (e.target.id === 'pl-modal-void') {
      const reason = prompt('Void reason (optional):') ?? '';
      if (reason === null) return;
      try {
        await voidLabel(_modalLabelId, reason || 'Voided');
        _labels = _labels.filter(l => l.id !== _modalLabelId);
        closeDetailModal();
        renderKpis();
        renderLabelList();
      } catch (err) {
        alert('Could not void: ' + err.message);
      }
      return;
    }
  });

  // Item input: detect template selection
  panel.addEventListener('input', (e) => {
    if (e.target.id === 'pl-item') {
      const val = e.target.value.trim();
      const tpl = _templates.find(t => t.name.toLowerCase() === val.toLowerCase());
      updateFormFromTemplate(tpl || null);
    }
    if (e.target.id === 'pl-search') {
      _searchQuery = e.target.value;
      renderLabelList();
    }
  });
}

async function handleCreateLabel(andPrint) {
  const vals = getFormValues();
  if (!vals.item) { alert('Please enter an item name.'); return; }
  if (!vals.initials || vals.initials.length < 2) { alert('Please enter 2-3 character initials.'); return; }

  const printBtn = document.getElementById('pl-print-btn');
  const saveBtn = document.getElementById('pl-save-btn');
  if (printBtn) { printBtn.disabled = true; printBtn.textContent = 'Saving…'; }
  if (saveBtn) { saveBtn.disabled = true; }

  try {
    const shelfHours = vals.hours
      || _selectedTemplate?.default_shelf_life_hours
      || 96;

    const payload = {
      item_name: vals.item,
      prepped_by_initials: vals.initials,
      prepped_by_user_id: _ctx?.userId || null,
      storage: vals.storage,
      allergens: vals.allergens,
      shelf_life_hours: shelfHours,
      template_id: _selectedTemplate?.id || null,
      lot_number: vals.lot,
      station: vals.station,
      batch_quantity: vals.qty,
      batch_unit: vals.unit,
      notes: vals.notes,
      prep_type: 'prep',
    };

    const newLabel = await createLabel(_ctx.tenantId, payload);

    // Normalise the returned row to the view shape
    const viewRow = {
      ...newLabel,
      item_name: newLabel.item_name || newLabel.item,
      use_by_at: newLabel.use_by_at || newLabel.use_by,
      prepped_by_initials: newLabel.prepped_by_initials || newLabel.prepped_by,
      expires_in_hours: shelfHours,
      status: shelfHours > 24 ? 'fresh' : shelfHours > 6 ? 'warning' : 'expiring',
    };

    _labels = [viewRow, ..._labels];
    renderKpis();
    renderLabelList();

    if (andPrint) {
      doPrint(viewRow);
      markPrinted(newLabel.id).then(updated => {
        const idx = _labels.findIndex(l => l.id === newLabel.id);
        if (idx >= 0) _labels[idx] = { ..._labels[idx], printed_at: updated.printed_at };
      }).catch(console.warn);
    }

    // Reset form but keep initials
    const initials = document.getElementById('pl-initials')?.value || '';
    resetForm();
    if (initials) {
      const el = document.getElementById('pl-initials');
      if (el) el.value = initials;
    }

    if (printBtn) printBtn.textContent = andPrint ? '✓ Printed' : '✓ Saved';
    setTimeout(() => {
      if (printBtn) { printBtn.textContent = 'Print label'; printBtn.disabled = false; }
      if (saveBtn) saveBtn.disabled = false;
      document.getElementById('pl-item')?.focus();
    }, 1200);

  } catch (err) {
    console.error('[prepLabelsView] create label failed', err);
    alert('Could not create label: ' + err.message);
    if (printBtn) { printBtn.textContent = 'Print label'; printBtn.disabled = false; }
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function fmtDt(d) {
  if (!d || isNaN(d)) return '—';
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
