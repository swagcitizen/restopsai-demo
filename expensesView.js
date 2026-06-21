// expensesView.js — Owner Expenses Hub UI
//
// Renders a single Expenses view that unifies every expense source via the
// v_expense_ledger view. Owners and managers can:
//   * Filter by category, source, and date range
//   * Add a one-off misc expense
//   * Import a vendor PDF or CSV (delegates to parse-invoice-doc edge fn)
//
// All data is loaded through expensesRepo.js. Use initExpenses({ tenantId, role }).

import {
  listExpenseLedger,
  addMiscExpense,
  CATEGORY_LABELS,
  SOURCE_LABELS,
  categoryLabel,
  sourceLabel,
  fmtCurrency,
} from './expensesRepo.js';

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient.js';

// ─── State ────────────────────────────────────────────────────────────────────

let _tenantId = null;
let _role     = 'staff';
let _filters  = { range: '30', category: '', source: '', vendor: '' };
let _rows     = [];
let _initialized = false;
let _loadInflight = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initExpenses(opts = {}) {
  _tenantId = opts.tenantId || _tenantId;
  _role     = opts.role || _role;

  const root = document.getElementById('expenses-root');
  if (!root) return;

  if (!_initialized) {
    root.innerHTML = template();
    bindEvents(root);
    _initialized = true;
  }

  return loadAndRender();
}

// Re-export so callers can refresh without re-init.
export function refreshExpenses() {
  return loadAndRender();
}

// ─── Template ─────────────────────────────────────────────────────────────────

function template() {
  const categoryOptions = ['', ...Object.keys(CATEGORY_LABELS)]
    .map(k => `<option value="${k}">${k ? categoryLabel(k) : 'All categories'}</option>`)
    .join('');
  const sourceOptions = ['', ...Object.keys(SOURCE_LABELS)]
    .map(k => `<option value="${k}">${k ? sourceLabel(k) : 'All sources'}</option>`)
    .join('');

  return `
    <div class="expenses-hub">
      <!-- Summary strip -->
      <div class="kpi-row" id="expenses-kpis" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px">
        <div class="card kpi"><div class="kpi-label">Total expenses</div><div class="kpi-value" id="exp-kpi-total">$0</div></div>
        <div class="card kpi"><div class="kpi-label">Food + waste</div><div class="kpi-value" id="exp-kpi-food">$0</div></div>
        <div class="card kpi"><div class="kpi-label">Labor</div><div class="kpi-value" id="exp-kpi-labor">$0</div></div>
        <div class="card kpi"><div class="kpi-label">Other ops</div><div class="kpi-value" id="exp-kpi-ops">$0</div></div>
      </div>

      <!-- Filter / action bar -->
      <div class="card" style="padding:12px 14px;margin-bottom:14px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
          <label class="sub" style="margin:0">Range
            <select id="exp-f-range" class="select">
              <option value="7">7 days</option>
              <option value="30" selected>30 days</option>
              <option value="90">90 days</option>
              <option value="365">365 days</option>
            </select>
          </label>
          <label class="sub" style="margin:0">Category
            <select id="exp-f-category" class="select">${categoryOptions}</select>
          </label>
          <label class="sub" style="margin:0">Source
            <select id="exp-f-source" class="select">${sourceOptions}</select>
          </label>
          <label class="sub" style="margin:0">Vendor
            <input id="exp-f-vendor" class="input" type="search" placeholder="Vendor contains…" />
          </label>
        </div>

        <div style="display:flex;gap:8px;align-items:center" data-write-area>
          <button class="btn ghost" id="exp-import-btn" data-write-action>Import PDF / CSV</button>
          <button class="btn" id="exp-add-btn" data-write-action>+ Add expense</button>
        </div>
      </div>

      <!-- Ledger table -->
      <div class="card" style="padding:0">
        <div class="card-head" style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px">
          <div>
            <h3 style="margin:0">Expense ledger</h3>
            <p class="sub" style="margin:4px 0 0" id="exp-ledger-sub">Every bill, invoice, receipt, pay run, waste log, and one-off expense in one place.</p>
          </div>
          <span class="badge" id="exp-row-count">0 rows</span>
        </div>
        <div style="overflow:auto">
          <table class="data-table" id="exp-table" style="width:100%;border-collapse:collapse">
            <thead>
              <tr>
                <th style="text-align:left;padding:10px 14px">Date</th>
                <th style="text-align:left;padding:10px 14px">Vendor</th>
                <th style="text-align:left;padding:10px 14px">Category</th>
                <th style="text-align:left;padding:10px 14px">Source</th>
                <th style="text-align:left;padding:10px 14px">Status</th>
                <th style="text-align:right;padding:10px 14px">Amount</th>
              </tr>
            </thead>
            <tbody id="exp-tbody">
              <tr><td colspan="6" style="padding:24px;text-align:center" class="sub">Loading expenses…</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Add expense modal -->
      <div class="modal" id="exp-add-modal" hidden role="dialog" aria-modal="true" aria-labelledby="exp-add-title" data-close-modal>
        <div class="modal-card" style="max-width:480px" onclick="event.stopPropagation()">
          <h3 id="exp-add-title" style="margin-top:0">Add one-off expense</h3>
          <p class="sub" style="margin-top:0">Use this for true one-offs like rent, license fees, or a cash purchase that doesn't fit an invoice or receipt.</p>
          <form id="exp-add-form" class="form-grid" style="display:grid;gap:10px">
            <label>Date <input class="input" type="date" name="occurred_on" required></label>
            <label>Vendor <input class="input" type="text" name="vendor" placeholder="e.g. Property Management LLC"></label>
            <label>Category
              <select class="select" name="category">
                ${Object.keys(CATEGORY_LABELS).map(k => `<option value="${k}">${categoryLabel(k)}</option>`).join('')}
              </select>
            </label>
            <label>Amount <input class="input" type="number" step="0.01" min="0" name="amount" required></label>
            <label>Notes <textarea class="input" name="notes" rows="2" placeholder="Optional"></textarea></label>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
              <button class="btn ghost" type="button" data-close-modal>Cancel</button>
              <button class="btn" type="submit">Save expense</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Import modal -->
      <div class="modal" id="exp-import-modal" hidden role="dialog" aria-modal="true" aria-labelledby="exp-import-title" data-close-modal>
        <div class="modal-card" style="max-width:520px" onclick="event.stopPropagation()">
          <h3 id="exp-import-title" style="margin-top:0">Import a vendor PDF or CSV</h3>
          <p class="sub" style="margin-top:0">Drop in an invoice PDF (Sysco, Publix, Restaurant Depot, utility bill, etc.) or a CSV exported from your bank or vendor portal. We'll parse it and let you review every row before it hits your books.</p>
          <input type="file" id="exp-import-file" accept=".pdf,.csv,application/pdf,text/csv" />
          <div id="exp-import-status" class="sub" style="min-height:20px;margin-top:10px"></div>
          <div id="exp-import-preview" style="margin-top:10px"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
            <button class="btn ghost" type="button" data-close-modal>Cancel</button>
            <button class="btn" type="button" id="exp-import-commit" disabled>Commit staged rows</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── Wiring ───────────────────────────────────────────────────────────────────

function bindEvents(root) {
  root.querySelector('#exp-f-range').addEventListener('change', e => {
    _filters.range = e.target.value;
    loadAndRender();
  });
  root.querySelector('#exp-f-category').addEventListener('change', e => {
    _filters.category = e.target.value;
    loadAndRender();
  });
  root.querySelector('#exp-f-source').addEventListener('change', e => {
    _filters.source = e.target.value;
    loadAndRender();
  });
  let vendorTimer = null;
  root.querySelector('#exp-f-vendor').addEventListener('input', e => {
    _filters.vendor = e.target.value.trim().toLowerCase();
    clearTimeout(vendorTimer);
    vendorTimer = setTimeout(() => renderTable(), 200);
  });

  root.querySelector('#exp-add-btn').addEventListener('click', () => openAddModal());
  root.querySelector('#exp-import-btn').addEventListener('click', () => openImportModal());

  // Modal close handlers
  root.querySelectorAll('[data-close-modal]').forEach(el => {
    el.addEventListener('click', () => closeAllModals());
  });

  // Add form submit
  root.querySelector('#exp-add-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!hasWriteAccess()) {
      alert('Only owners and managers can add expenses.');
      return;
    }
    const fd = new FormData(e.target);
    const payload = {
      occurred_on: fd.get('occurred_on') || null,
      vendor:      (fd.get('vendor') || '').toString().trim() || null,
      category:    fd.get('category') || 'other',
      amount:      Number(fd.get('amount') || 0),
      notes:       (fd.get('notes') || '').toString().trim() || null,
    };
    if (!payload.amount || payload.amount <= 0) {
      alert('Enter an amount greater than 0.');
      return;
    }
    try {
      await addMiscExpense(_tenantId, payload);
      e.target.reset();
      closeAllModals();
      await loadAndRender();
    } catch (err) {
      console.error('add expense failed', err);
      alert(err.message || 'Failed to save expense');
    }
  });

  // Import file selection
  const importFile = root.querySelector('#exp-import-file');
  const importStatus = root.querySelector('#exp-import-status');
  const importPreview = root.querySelector('#exp-import-preview');
  const importCommit = root.querySelector('#exp-import-commit');
  let stagedRows = [];

  importFile.addEventListener('change', async e => {
    stagedRows = [];
    importCommit.disabled = true;
    importPreview.innerHTML = '';
    const file = e.target.files && e.target.files[0];
    if (!file) { importStatus.textContent = ''; return; }
    importStatus.textContent = 'Parsing…';
    try {
      stagedRows = await parseImport(file);
      importStatus.textContent = `Parsed ${stagedRows.length} row${stagedRows.length === 1 ? '' : 's'}. Review and edit below, then commit.`;
      importPreview.innerHTML = renderStagedRows(stagedRows);
      bindStagedEdits(importPreview, stagedRows);
      importCommit.disabled = stagedRows.length === 0;
    } catch (err) {
      console.error('parse import failed', err);
      importStatus.textContent = err.message || 'Could not parse this file.';
    }
  });

  importCommit.addEventListener('click', async () => {
    if (!hasWriteAccess() || stagedRows.length === 0) return;
    importStatus.textContent = 'Saving…';
    try {
      for (const r of stagedRows) {
        await addMiscExpense(_tenantId, r);
      }
      importStatus.textContent = `Committed ${stagedRows.length} expense${stagedRows.length === 1 ? '' : 's'}.`;
      stagedRows = [];
      importPreview.innerHTML = '';
      importFile.value = '';
      importCommit.disabled = true;
      await loadAndRender();
      setTimeout(closeAllModals, 600);
    } catch (err) {
      console.error('commit import failed', err);
      importStatus.textContent = err.message || 'Failed to commit some rows.';
    }
  });
}

function hasWriteAccess() {
  return _role === 'owner' || _role === 'manager';
}

function openAddModal() {
  if (!hasWriteAccess()) { alert('Only owners and managers can add expenses.'); return; }
  const modal = document.getElementById('exp-add-modal');
  if (!modal) return;
  // Default the date input to today
  const dateInput = modal.querySelector('input[name="occurred_on"]');
  if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
  modal.hidden = false;
}

function openImportModal() {
  if (!hasWriteAccess()) { alert('Only owners and managers can import expenses.'); return; }
  const modal = document.getElementById('exp-import-modal');
  if (!modal) return;
  modal.hidden = false;
}

function closeAllModals() {
  document.querySelectorAll('.expenses-hub .modal').forEach(m => { m.hidden = true; });
}

// ─── Load & render ────────────────────────────────────────────────────────────

async function loadAndRender() {
  if (!_tenantId) return;
  const days = parseInt(_filters.range, 10) || 30;
  const today = new Date();
  const from  = new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10);
  const to    = today.toISOString().slice(0, 10);

  if (_loadInflight) return _loadInflight;
  _loadInflight = (async () => {
    try {
      _rows = await listExpenseLedger(_tenantId, {
        from, to,
        category:   _filters.category || null,
        sourceKind: _filters.source   || null,
        limit:      500,
      });
    } catch (err) {
      console.error('expenses load failed', err);
      _rows = [];
    } finally {
      _loadInflight = null;
    }
    renderTable();
    renderKpis();
  })();
  return _loadInflight;
}

function visibleRows() {
  if (!_filters.vendor) return _rows;
  const q = _filters.vendor;
  return _rows.filter(r => (r.vendor || '').toLowerCase().includes(q));
}

function renderTable() {
  const tbody = document.getElementById('exp-tbody');
  const count = document.getElementById('exp-row-count');
  if (!tbody) return;
  const rows = visibleRows();
  count.textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}`;

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:24px;text-align:center" class="sub">No expenses match these filters. Add one with the + Add expense button, or import a vendor PDF/CSV.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td style="padding:10px 14px">${r.occurred_on || ''}</td>
      <td style="padding:10px 14px">${escapeHtml(r.vendor || '')}</td>
      <td style="padding:10px 14px"><span class="badge">${escapeHtml(categoryLabel(r.category))}</span></td>
      <td style="padding:10px 14px" class="sub">${escapeHtml(sourceLabel(r.source_kind))}</td>
      <td style="padding:10px 14px" class="sub">${escapeHtml(r.status || '')}</td>
      <td style="padding:10px 14px;text-align:right;font-variant-numeric:tabular-nums">${fmtCurrency(r.amount)}</td>
    </tr>
  `).join('');
}

function renderKpis() {
  const rows = visibleRows();
  let total = 0, food = 0, labor = 0, ops = 0;
  for (const r of rows) {
    const v = Number(r.amount || 0);
    total += v;
    if (r.category === 'food' || r.category === 'waste') food += v;
    else if (r.category === 'labor') labor += v;
    else ops += v;
  }
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = fmtCurrency(val);
  };
  set('exp-kpi-total', total);
  set('exp-kpi-food',  food);
  set('exp-kpi-labor', labor);
  set('exp-kpi-ops',   ops);
}

// ─── Import parsing ───────────────────────────────────────────────────────────

async function parseImport(file) {
  const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
  if (isCsv) return parseCsv(await file.text());

  // PDF path: send the file to the parse-invoice-doc edge function.
  const fd = new FormData();
  fd.append('file', file);
  fd.append('tenant_id', _tenantId);

  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token || '';

  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/parse-invoice-doc`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: fd,
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Parser failed (${res.status}): ${text || 'unknown error'}`);
  }
  const json = await res.json();
  if (!json || !Array.isArray(json.rows)) {
    throw new Error('Parser returned no rows.');
  }
  return json.rows.map(normalizeStagedRow);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];

  // Try to detect a header. If first row has any non-numeric cell, treat as header.
  const firstCells = splitCsvLine(lines[0]);
  const firstHasText = firstCells.some(c => isNaN(parseFloat(c)) && c.length > 0);

  let header = null;
  let dataLines = lines;
  if (firstHasText) { header = firstCells.map(s => s.toLowerCase().trim()); dataLines = lines.slice(1); }

  return dataLines.map(line => {
    const cells = splitCsvLine(line);
    const obj = {};
    if (header) {
      header.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
    } else {
      // Heuristic positional: date, vendor, amount, [category, notes]
      obj.date = cells[0]; obj.vendor = cells[1]; obj.amount = cells[2]; obj.category = cells[3]; obj.notes = cells[4];
    }
    return normalizeStagedRow(obj);
  }).filter(r => r.amount > 0);
}

function splitCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function normalizeStagedRow(r) {
  const date   = r.occurred_on || r.date || r['transaction date'] || r['posted date'] || '';
  const vendor = r.vendor || r['description'] || r['merchant'] || '';
  const amountRaw = r.amount ?? r.total ?? r['amount (usd)'] ?? r['debit'] ?? '';
  const amount = parseFloat(String(amountRaw).replace(/[$,]/g, '')) || 0;
  const cat    = (r.category || '').toString().toLowerCase().trim() || guessCategory(vendor);
  const notes  = r.notes || r['memo'] || '';

  return {
    occurred_on: normalizeDate(date) || new Date().toISOString().slice(0, 10),
    vendor: (vendor || '').toString().trim() || null,
    category: cat || 'other',
    amount: Math.abs(amount),
    notes: notes ? notes.toString().trim() : null,
  };
}

function normalizeDate(s) {
  if (!s) return '';
  // YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // M/D/YYYY or MM/DD/YYYY
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let y = m[3]; if (y.length === 2) y = '20' + y;
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  // Try Date parser as fallback
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return '';
}

function guessCategory(vendor) {
  const v = (vendor || '').toLowerCase();
  if (/publix|sysco|us foods|restaurant depot|produce|meat|dairy|bakery|cheese/.test(v)) return 'food';
  if (/duke energy|electric|water|gas company|utility|comcast|verizon|internet/.test(v))  return 'utilities';
  if (/rent|landlord|property|lease/.test(v))                                              return 'rent';
  if (/insurance/.test(v))                                                                 return 'insurance';
  if (/doordash|ubereats|grubhub|toast|square|stripe|pos/.test(v))                         return 'fees';
  return 'other';
}

function renderStagedRows(rows) {
  if (rows.length === 0) return '<p class="sub">No rows parsed.</p>';
  const opts = Object.keys(CATEGORY_LABELS).map(k => `<option value="${k}">${categoryLabel(k)}</option>`).join('');
  return `
    <div style="max-height:240px;overflow:auto;border:1px solid var(--border,#2a2a2a);border-radius:8px">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr>
          <th style="text-align:left;padding:6px 8px">Date</th>
          <th style="text-align:left;padding:6px 8px">Vendor</th>
          <th style="text-align:left;padding:6px 8px">Category</th>
          <th style="text-align:right;padding:6px 8px">Amount</th>
        </tr></thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr data-staged-i="${i}">
              <td style="padding:4px 8px"><input class="input" type="date" data-field="occurred_on" value="${escapeHtml(r.occurred_on || '')}"></td>
              <td style="padding:4px 8px"><input class="input" type="text" data-field="vendor" value="${escapeHtml(r.vendor || '')}"></td>
              <td style="padding:4px 8px"><select class="select" data-field="category">${opts.replace(`value="${r.category}"`, `value="${r.category}" selected`)}</select></td>
              <td style="padding:4px 8px;text-align:right"><input class="input" type="number" step="0.01" min="0" data-field="amount" value="${Number(r.amount || 0).toFixed(2)}" style="text-align:right;width:90px"></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function bindStagedEdits(container, rows) {
  container.querySelectorAll('tr[data-staged-i]').forEach(tr => {
    const i = parseInt(tr.getAttribute('data-staged-i'), 10);
    tr.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener('change', () => {
        const f = el.getAttribute('data-field');
        let v = el.value;
        if (f === 'amount') v = parseFloat(v) || 0;
        rows[i][f] = v;
      });
    });
  });
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
