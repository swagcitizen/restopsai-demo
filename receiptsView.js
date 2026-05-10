// receiptsView.js — Receipt Repository UI
// Sections: Upload zone (sticky) → Filter bar → Receipts grid → Detail modal
//
// Usage: initReceipts({ tenantId, userId })

import {
  listReceipts,
  getReceipt,
  getSignedUrl,
  uploadReceiptFile,
  triggerOcr,
  updateReceipt,
  voidReceipt,
  linkToBill,
  createDraftBill,
} from './receiptsRepo.js';

// ─── State ────────────────────────────────────────────────────────────────────

let _tenantId  = null;
let _userId    = null;
let _receipts  = [];
let _filters   = { status: '', vendor: '', dateFrom: '', dateTo: '', category: '', search: '', range: '30' };
let _detailId  = null;
let _initialized = false;
let _loadInflight = null;
let _lastErrorAt = 0;

// ─── Entry point ──────────────────────────────────────────────────────────────

export function initReceipts({ tenantId, userId }) {
  _tenantId = tenantId;
  _userId   = userId;

  if (_initialized) {
    // Already wired — just refresh the list.
    loadReceipts();
    return;
  }
  _initialized = true;

  renderShell();
  bindUpload();
  bindFilters();
  loadReceipts();
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function renderShell() {
  const container = document.getElementById('receipts-root');
  if (!container) return;

  container.innerHTML = `
    <!-- Upload zone -->
    <div class="rcpt-upload-zone" id="rcpt-drop-zone" role="region" aria-label="Upload receipts">
      <div class="rcpt-upload-inner">
        <div class="rcpt-upload-icon" aria-hidden="true">🧾</div>
        <p class="rcpt-upload-label">Drop receipts here or choose a file</p>
        <p class="rcpt-upload-sub">JPEG, PNG, HEIC, WebP, PDF · max 25 MB</p>
        <div class="rcpt-upload-btns">
          <label class="btn btn-primary rcpt-file-btn" aria-label="Choose files">
            Choose file
            <input type="file" id="rcpt-file-input" accept="image/*,application/pdf" multiple hidden>
          </label>
          <label class="btn btn-ghost rcpt-camera-btn" aria-label="Take photo with camera">
            📷 Take photo
            <input type="file" id="rcpt-camera-input" accept="image/*" capture="environment" hidden>
          </label>
        </div>
      </div>
      <div class="rcpt-progress-strip" id="rcpt-progress-strip" hidden></div>
    </div>

    <!-- Filter bar -->
    <div class="rcpt-filters" id="rcpt-filters">
      <div class="rcpt-filter-row">
        <div class="rcpt-status-chips" role="group" aria-label="Filter by status">
          <button class="chip active" data-status="">All</button>
          <button class="chip" data-status="pending">Pending OCR</button>
          <button class="chip" data-status="done">Processed</button>
          <button class="chip" data-status="failed">Failed</button>
          <button class="chip" data-status="skipped">Skipped</button>
        </div>
        <select class="rcpt-cat-select" id="rcpt-cat-select" aria-label="Filter by category">
          <option value="">All categories</option>
          <option value="food">Food</option>
          <option value="beverage">Beverage</option>
          <option value="supplies">Supplies</option>
          <option value="equipment">Equipment</option>
          <option value="utilities">Utilities</option>
          <option value="maintenance">Maintenance</option>
          <option value="other">Other</option>
        </select>
        <select class="rcpt-range-select" id="rcpt-range-select" aria-label="Date range">
          <option value="7">Last 7 days</option>
          <option value="30" selected>Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="0">All time</option>
          <option value="custom">Custom range</option>
        </select>
      </div>
      <div class="rcpt-filter-row" id="rcpt-custom-range" hidden>
        <label class="rcpt-filter-label">From
          <input type="date" id="rcpt-date-from" class="rcpt-date-input">
        </label>
        <label class="rcpt-filter-label">To
          <input type="date" id="rcpt-date-to" class="rcpt-date-input">
        </label>
      </div>
      <div class="rcpt-filter-row">
        <input type="search" id="rcpt-search" class="rcpt-search-input" placeholder="Search vendor, notes, filename…" aria-label="Search receipts">
        <input type="text" id="rcpt-vendor" class="rcpt-vendor-input" placeholder="Vendor name…" aria-label="Filter by vendor">
      </div>
    </div>

    <!-- Grid -->
    <div class="rcpt-grid" id="rcpt-grid" aria-live="polite"></div>

    <!-- Detail modal -->
    <div class="rcpt-modal" id="rcpt-modal" hidden role="dialog" aria-modal="true" aria-label="Receipt detail">
      <div class="rcpt-modal-card">
        <div class="rcpt-modal-header">
          <h3 class="rcpt-modal-title" id="rcpt-modal-title">Receipt</h3>
          <button class="rcpt-modal-close" id="rcpt-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="rcpt-modal-body" id="rcpt-modal-body"></div>
      </div>
    </div>
  `;

  document.getElementById('rcpt-modal-close')?.addEventListener('click', closeModal);
  document.getElementById('rcpt-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
}

// ─── Upload logic ─────────────────────────────────────────────────────────────

const ALLOWED_TYPES = new Set(['image/jpeg','image/png','image/heic','image/heif','image/webp','application/pdf']);
const MAX_BYTES = 25 * 1024 * 1024;

function bindUpload() {
  const zone    = document.getElementById('rcpt-drop-zone');
  const fileIn  = document.getElementById('rcpt-file-input');
  const camIn   = document.getElementById('rcpt-camera-input');
  if (!zone) return;

  // Drag & drop
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files || []);
    queueUploads(files);
  });

  fileIn?.addEventListener('change', () => queueUploads(Array.from(fileIn.files || [])));
  camIn?.addEventListener('change', () => queueUploads(Array.from(camIn.files || []), 'camera'));
}

function queueUploads(files, source = 'upload') {
  const valid = files.filter(f => {
    if (!ALLOWED_TYPES.has(f.type)) {
      showToast(`${f.name}: unsupported file type (${f.type || 'unknown'})`, 'error');
      return false;
    }
    if (f.size > MAX_BYTES) {
      showToast(`${f.name}: file exceeds 25 MB limit`, 'error');
      return false;
    }
    return true;
  });
  if (!valid.length) return;
  valid.forEach(f => uploadSingle(f, source));
}

async function uploadSingle(file, source) {
  const strip   = document.getElementById('rcpt-progress-strip');
  const itemId  = `prog-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Show progress strip item
  if (strip) {
    strip.hidden = false;
    strip.insertAdjacentHTML('beforeend', `
      <div class="rcpt-prog-item" id="${itemId}">
        <span class="rcpt-prog-name">${escHtml(file.name)}</span>
        <span class="rcpt-prog-status" id="${itemId}-status">Uploading…</span>
      </div>
    `);
  }

  // Optimistic card
  const optId = `opt-${Date.now()}`;
  addOptimisticCard(optId, file.name);

  try {
    const row = await uploadReceiptFile(_tenantId, _userId, file, source);
    updateProgStatus(itemId, '✓ Uploaded');

    // Replace optimistic card with real data
    removeOptimisticCard(optId);

    // Trigger OCR (stub — marks as skipped if not configured)
    await triggerOcr(row.id);

    showToast(`${file.name} uploaded — OCR queued`, 'ok');
    await loadReceipts();
  } catch (err) {
    console.error('Receipt upload failed:', err);
    updateProgStatus(itemId, '✗ Failed');
    removeOptimisticCard(optId);
    showToast(`Upload failed: ${err.message}`, 'error');
  } finally {
    setTimeout(() => {
      document.getElementById(itemId)?.remove();
      const strip = document.getElementById('rcpt-progress-strip');
      if (strip && !strip.children.length) strip.hidden = true;
      // Reset inputs so the same file can be re-selected
      const fi = document.getElementById('rcpt-file-input');
      const ci = document.getElementById('rcpt-camera-input');
      if (fi) fi.value = '';
      if (ci) ci.value = '';
    }, 3000);
  }
}

function addOptimisticCard(optId, fileName) {
  const grid = document.getElementById('rcpt-grid');
  if (!grid) return;
  grid.insertAdjacentHTML('afterbegin', `
    <div class="rcpt-card rcpt-card--optimistic" id="${optId}" aria-busy="true">
      <div class="rcpt-card-thumb rcpt-card-thumb--placeholder"></div>
      <div class="rcpt-card-info">
        <div class="rcpt-card-vendor">${escHtml(fileName)}</div>
        <span class="rcpt-badge rcpt-badge--processing">Processing…</span>
      </div>
    </div>
  `);
}

function removeOptimisticCard(optId) {
  document.getElementById(optId)?.remove();
}

function updateProgStatus(itemId, msg) {
  const el = document.getElementById(`${itemId}-status`);
  if (el) el.textContent = msg;
}

// ─── Filters ──────────────────────────────────────────────────────────────────

function bindFilters() {
  // Debounce helper
  let searchTimer = null;

  const rangeSelect = document.getElementById('rcpt-range-select');
  const customRow   = document.getElementById('rcpt-custom-range');
  const dateFrom    = document.getElementById('rcpt-date-from');
  const dateTo      = document.getElementById('rcpt-date-to');
  const catSelect   = document.getElementById('rcpt-cat-select');
  const searchInput = document.getElementById('rcpt-search');
  const vendorInput = document.getElementById('rcpt-vendor');

  rangeSelect?.addEventListener('change', () => {
    _filters.range = rangeSelect.value;
    if (rangeSelect.value === 'custom') {
      customRow.hidden = false;
    } else {
      customRow.hidden = true;
      _filters.dateFrom = '';
      _filters.dateTo   = '';
      applyDateRange();
      loadReceipts();
    }
  });

  dateFrom?.addEventListener('change', () => {
    _filters.dateFrom = dateFrom.value;
    loadReceipts();
  });
  dateTo?.addEventListener('change', () => {
    _filters.dateTo = dateTo.value;
    loadReceipts();
  });

  catSelect?.addEventListener('change', () => {
    _filters.category = catSelect.value;
    loadReceipts();
  });

  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      _filters.search = searchInput.value.trim();
      loadReceipts();
    }, 350);
  });

  vendorInput?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      _filters.vendor = vendorInput.value.trim();
      loadReceipts();
    }, 350);
  });

  document.querySelectorAll('#rcpt-filters .chip[data-status]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#rcpt-filters .chip[data-status]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      _filters.status = chip.dataset.status;
      loadReceipts();
    });
  });
}

function applyDateRange() {
  if (_filters.range === 'custom' || _filters.range === '0') return;
  const days = parseInt(_filters.range, 10);
  if (!days) { _filters.dateFrom = ''; _filters.dateTo = ''; return; }
  const to   = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  _filters.dateTo   = to.toISOString().slice(0, 10);
  _filters.dateFrom = from.toISOString().slice(0, 10);
}

// ─── Load & render grid ───────────────────────────────────────────────────────

async function loadReceipts() {
  // Dedupe concurrent calls — return the in-flight promise so duplicate triggers
  // (e.g. nav activation firing alongside initial init) don't double-render.
  if (_loadInflight) return _loadInflight;

  _loadInflight = (async () => {
    if (_filters.range !== 'custom' && _filters.range !== '0') applyDateRange();

    const grid = document.getElementById('rcpt-grid');
    if (!grid) return;

    // Remove existing real cards + any stale empty-state (keep optimistic uploads).
    grid.querySelectorAll('.rcpt-card:not(.rcpt-card--optimistic), .rcpt-empty')
      .forEach(n => n.remove());

    try {
      _receipts = await listReceipts(_tenantId, {
        limit:    100,
        status:   _filters.status   || undefined,
        vendor:   _filters.vendor   || undefined,
        dateFrom: _filters.dateFrom || undefined,
        dateTo:   _filters.dateTo   || undefined,
        search:   _filters.search   || undefined,
        category: _filters.category || undefined,
      });
    } catch (err) {
      console.error('Load receipts failed:', err);
      // Throttle error toasts to one per 3s so a double-fire doesn't double-toast.
      const now = Date.now();
      if (now - _lastErrorAt > 3000) {
        _lastErrorAt = now;
        showToast('Could not load receipts — check your connection', 'error');
      }
      _receipts = [];
    }

    renderGrid();
  })();

  try {
    await _loadInflight;
  } finally {
    _loadInflight = null;
  }
}

function renderGrid() {
  const grid = document.getElementById('rcpt-grid');
  if (!grid) return;

  // Remove existing real cards + any stale empty-state (keep optimistic uploads).
  grid.querySelectorAll('.rcpt-card:not(.rcpt-card--optimistic), .rcpt-empty')
    .forEach(n => n.remove());

  if (!_receipts.length) {
    if (!grid.querySelector('.rcpt-card--optimistic')) {
      grid.insertAdjacentHTML('beforeend', `
        <div class="rcpt-empty">
          <div class="rcpt-empty-icon">🧾</div>
          <p class="rcpt-empty-title">No receipts yet</p>
          <p class="rcpt-empty-sub">↑ Drop files or tap "Choose file" above to get started</p>
        </div>
      `);
    }
    return;
  }

  const fragment = document.createDocumentFragment();
  _receipts.forEach(r => {
    const card = buildCard(r);
    fragment.appendChild(card);
  });
  grid.appendChild(fragment);
}

function buildCard(r) {
  const el = document.createElement('div');
  el.className = 'rcpt-card';
  el.dataset.id = r.id;
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', `Receipt: ${r.vendor_name || r.file_name || 'Unknown vendor'}`);

  const isImage = r.mime_type && r.mime_type.startsWith('image/');
  const isPdf   = r.mime_type === 'application/pdf';

  const thumbHtml = isImage
    ? `<div class="rcpt-card-thumb rcpt-card-thumb--img" data-path="${escAttr(r.storage_path)}">
         <img src="" alt="Receipt thumbnail" loading="lazy" class="rcpt-thumb-img" data-path="${escAttr(r.storage_path)}">
       </div>`
    : `<div class="rcpt-card-thumb rcpt-card-thumb--pdf" title="PDF receipt">
         <span class="rcpt-pdf-icon" aria-hidden="true">📄</span>
       </div>`;

  const date    = r.receipt_date ? formatDate(r.receipt_date) : (r.uploaded_at ? formatDate(r.uploaded_at) : '—');
  const amount  = r.total_amount != null ? fmtCurrency(r.total_amount, r.currency) : '—';
  const catTag  = r.category ? `<span class="rcpt-cat-tag">${escHtml(capitalize(r.category))}</span>` : '';
  const lineQty = r.line_item_count ? `<span class="rcpt-line-count">${r.line_item_count} items</span>` : '';

  el.innerHTML = `
    ${thumbHtml}
    <div class="rcpt-card-info">
      <div class="rcpt-card-vendor">${escHtml(r.vendor_name || r.file_name || 'Unknown vendor')}</div>
      <div class="rcpt-card-meta">
        <span class="rcpt-card-date">${date}</span>
        <span class="rcpt-card-amount">${amount}</span>
      </div>
      <div class="rcpt-card-tags">
        ${ocrBadge(r.ocr_status)}
        ${catTag}
        ${lineQty}
      </div>
    </div>
  `;

  el.addEventListener('click', () => openDetail(r.id));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') openDetail(r.id); });

  return el;
}

// Lazy-load signed URLs for image thumbnails after render
function loadThumbnails() {
  document.querySelectorAll('.rcpt-thumb-img[data-path]').forEach(async img => {
    if (img.src && img.src !== window.location.href) return; // already loaded
    const path = img.dataset.path;
    if (!path) return;
    try {
      const url = await getSignedUrl(path, 900); // 15 min for thumbs
      img.src = url;
    } catch (_) { /* silently skip */ }
  });
}

// ─── Detail modal ─────────────────────────────────────────────────────────────

async function openDetail(id) {
  _detailId = id;
  const modal = document.getElementById('rcpt-modal');
  const body  = document.getElementById('rcpt-modal-body');
  if (!modal || !body) return;

  modal.hidden = false;
  body.innerHTML = '<div class="rcpt-modal-loading">Loading…</div>';

  try {
    const { receipt: r, lineItems } = await getReceipt(id);
    document.getElementById('rcpt-modal-title').textContent =
      r.vendor_name || r.file_name || 'Receipt';

    const isImage = r.mime_type && r.mime_type.startsWith('image/');
    const isPdf   = r.mime_type === 'application/pdf';

    let previewHtml = '';
    if (r.storage_path) {
      try {
        const signedUrl = await getSignedUrl(r.storage_path, 3600);
        if (isImage) {
          previewHtml = `<img src="${signedUrl}" alt="Receipt" class="rcpt-preview-img">`;
        } else if (isPdf) {
          previewHtml = `<embed src="${signedUrl}" type="application/pdf" class="rcpt-preview-pdf" aria-label="PDF receipt preview">`;
        } else {
          previewHtml = `<a href="${signedUrl}" target="_blank" rel="noopener" class="btn btn-ghost">Download file</a>`;
        }
      } catch (_) {
        previewHtml = `<div class="rcpt-preview-unavailable">Preview unavailable</div>`;
      }
    }

    const lineItemsHtml = lineItems.length
      ? `<table class="rcpt-li-table">
          <thead><tr>
            <th>#</th><th>Description</th><th>Qty</th><th>Unit</th><th>Total</th>
          </tr></thead>
          <tbody>
            ${lineItems.map(li => `
              <tr>
                <td>${li.position ?? ''}</td>
                <td>${escHtml(li.description)}</td>
                <td>${li.quantity ?? ''}</td>
                <td>${li.unit_price != null ? fmtCurrency(li.unit_price, r.currency) : ''}</td>
                <td>${li.total_price != null ? fmtCurrency(li.total_price, r.currency) : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`
      : '<p class="muted" style="margin:0;font-size:13px">No line items extracted yet.</p>';

    body.innerHTML = `
      <div class="rcpt-modal-layout">
        <!-- Left: preview -->
        <div class="rcpt-preview-pane">
          ${previewHtml}
          <div class="rcpt-file-meta muted">
            ${r.file_name ? `<span>${escHtml(r.file_name)}</span>` : ''}
            ${r.file_size_bytes ? `<span>${fmtBytes(r.file_size_bytes)}</span>` : ''}
            <span>Uploaded ${r.uploaded_at ? formatDate(r.uploaded_at) : '—'}${r.uploader_email ? ` by ${escHtml(r.uploader_email)}` : ''}</span>
          </div>
          <div class="rcpt-ocr-status-row">
            ${ocrBadge(r.ocr_status)}
            ${r.ocr_error ? `<span class="rcpt-ocr-err muted" title="${escAttr(r.ocr_error)}">⚠ ${escHtml(r.ocr_error)}</span>` : ''}
          </div>
        </div>

        <!-- Right: editable fields -->
        <div class="rcpt-edit-pane">
          <form id="rcpt-edit-form" class="rcpt-edit-form">
            <div class="rcpt-edit-grid">
              <label class="rcpt-field">
                <span>Vendor</span>
                <input type="text" name="vendor_name" value="${escAttr(r.vendor_name || '')}" placeholder="Vendor name">
              </label>
              <label class="rcpt-field">
                <span>Date</span>
                <input type="date" name="receipt_date" value="${r.receipt_date || ''}">
              </label>
              <label class="rcpt-field">
                <span>Total</span>
                <input type="number" name="total_amount" step="0.01" value="${r.total_amount ?? ''}" placeholder="0.00">
              </label>
              <label class="rcpt-field">
                <span>Subtotal</span>
                <input type="number" name="subtotal_amount" step="0.01" value="${r.subtotal_amount ?? ''}" placeholder="0.00">
              </label>
              <label class="rcpt-field">
                <span>Tax</span>
                <input type="number" name="tax_amount" step="0.01" value="${r.tax_amount ?? ''}" placeholder="0.00">
              </label>
              <label class="rcpt-field">
                <span>Tip</span>
                <input type="number" name="tip_amount" step="0.01" value="${r.tip_amount ?? ''}" placeholder="0.00">
              </label>
              <label class="rcpt-field">
                <span>Category</span>
                <select name="category">
                  <option value="">— Select —</option>
                  ${['food','beverage','supplies','equipment','utilities','maintenance','other'].map(c =>
                    `<option value="${c}" ${r.category === c ? 'selected' : ''}>${capitalize(c)}</option>`
                  ).join('')}
                </select>
              </label>
              <label class="rcpt-field">
                <span>Payment method</span>
                <select name="payment_method">
                  <option value="">— Select —</option>
                  ${['cash','credit','visa','mastercard','amex','check','other'].map(m =>
                    `<option value="${m}" ${r.payment_method === m ? 'selected' : ''}>${capitalize(m)}</option>`
                  ).join('')}
                </select>
              </label>
            </div>
            <label class="rcpt-field rcpt-field--full">
              <span>Notes</span>
              <textarea name="notes" rows="2" placeholder="Add notes…">${escHtml(r.notes || '')}</textarea>
            </label>
            <label class="rcpt-field rcpt-field--full">
              <span>Tags (comma-separated)</span>
              <input type="text" name="tags" value="${(r.tags || []).join(', ')}" placeholder="e.g. supplies, weekly-order">
            </label>

            <div class="rcpt-edit-actions">
              <button type="submit" class="btn btn-primary" id="rcpt-save-btn">Save changes</button>
              <button type="button" class="btn btn-ghost" id="rcpt-draft-bill-btn" ${r.bill_status !== 'unlinked' ? 'disabled' : ''}>
                ${r.bill_status === 'unlinked' ? 'Create draft bill' : capitalize(r.bill_status)}
              </button>
              <button type="button" class="btn btn-ghost rcpt-reprocess-btn" id="rcpt-reprocess-btn">Reprocess OCR</button>
              <button type="button" class="btn btn-ghost rcpt-void-btn" id="rcpt-void-btn" ${r.voided_at ? 'disabled' : ''}>
                ${r.voided_at ? 'Voided' : 'Void receipt'}
              </button>
            </div>
          </form>

          <!-- Line items -->
          <div class="rcpt-li-section">
            <h4>Line items</h4>
            ${lineItemsHtml}
          </div>
        </div>
      </div>
    `;

    // Bind actions
    document.getElementById('rcpt-edit-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      saveEdits(r.id, e.target);
    });

    document.getElementById('rcpt-void-btn')?.addEventListener('click', () => {
      if (!r.voided_at) doVoid(r.id);
    });

    document.getElementById('rcpt-draft-bill-btn')?.addEventListener('click', () => {
      if (r.bill_status === 'unlinked') doDraftBill(r.id);
    });

    document.getElementById('rcpt-reprocess-btn')?.addEventListener('click', () => {
      doReprocessOcr(r.id);
    });

  } catch (err) {
    console.error('Load receipt detail failed:', err);
    body.innerHTML = `<p class="rcpt-modal-err">Failed to load receipt: ${escHtml(err.message)}</p>`;
  }
}

function closeModal() {
  const modal = document.getElementById('rcpt-modal');
  if (modal) modal.hidden = true;
  _detailId = null;
}

// ─── Modal actions ────────────────────────────────────────────────────────────

async function saveEdits(id, form) {
  const btn = form.querySelector('#rcpt-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    const fd = new FormData(form);
    const tagsRaw = (fd.get('tags') || '').split(',').map(t => t.trim()).filter(Boolean);

    const patch = {
      vendor_name:     fd.get('vendor_name')     || null,
      receipt_date:    fd.get('receipt_date')     || null,
      total_amount:    fd.get('total_amount')     ? parseFloat(fd.get('total_amount'))    : null,
      subtotal_amount: fd.get('subtotal_amount')  ? parseFloat(fd.get('subtotal_amount')) : null,
      tax_amount:      fd.get('tax_amount')       ? parseFloat(fd.get('tax_amount'))      : null,
      tip_amount:      fd.get('tip_amount')       ? parseFloat(fd.get('tip_amount'))      : null,
      category:        fd.get('category')         || null,
      payment_method:  fd.get('payment_method')   || null,
      notes:           fd.get('notes')            || null,
      tags:            tagsRaw,
    };

    await updateReceipt(id, patch);
    showToast('Receipt saved', 'ok');
    closeModal();
    await loadReceipts();
  } catch (err) {
    console.error('Save receipt failed:', err);
    showToast(`Save failed: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save changes'; }
  }
}

async function doVoid(id) {
  const reason = prompt('Reason for voiding this receipt?', '') ?? '';
  if (reason === null) return; // cancelled
  try {
    await voidReceipt(id, reason || 'Voided');
    showToast('Receipt voided', 'ok');
    closeModal();
    await loadReceipts();
  } catch (err) {
    showToast(`Void failed: ${err.message}`, 'error');
  }
}

async function doDraftBill(id) {
  try {
    await createDraftBill(id);
    showToast('Marked as draft bill', 'ok');
    closeModal();
    await loadReceipts();
  } catch (err) {
    showToast(`Failed: ${err.message}`, 'error');
  }
}

async function doReprocessOcr(id) {
  const btn = document.getElementById('rcpt-reprocess-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Queuing…'; }
  try {
    await triggerOcr(id);
    showToast('OCR requeued', 'ok');
    closeModal();
    await loadReceipts();
  } catch (err) {
    showToast(`Reprocess failed: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Reprocess OCR'; }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ocrBadge(status) {
  const map = {
    pending:    ['rcpt-badge--pending',    'Pending OCR'],
    processing: ['rcpt-badge--processing', 'Processing…'],
    done:       ['rcpt-badge--done',       'OCR done'],
    failed:     ['rcpt-badge--failed',     'OCR failed'],
    skipped:    ['rcpt-badge--skipped',    'OCR skipped'],
  };
  const [cls, label] = map[status] || map.pending;
  return `<span class="rcpt-badge ${cls}">${label}</span>`;
}

function showToast(msg, type = 'ok') {
  const existing = document.getElementById('rcpt-toast-container');
  const container = existing || (() => {
    const el = document.createElement('div');
    el.id = 'rcpt-toast-container';
    el.className = 'rcpt-toast-container';
    document.body.appendChild(el);
    return el;
  })();

  const toast = document.createElement('div');
  toast.className = `rcpt-toast rcpt-toast--${type}`;
  toast.textContent = msg;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('rcpt-toast--visible'));
  setTimeout(() => {
    toast.classList.remove('rcpt-toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function fmtCurrency(amount, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount);
  } catch (_) {
    return `$${Number(amount).toFixed(2)}`;
  }
}

function formatDate(str) {
  if (!str) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(str));
  } catch (_) {
    return str;
  }
}

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Observe grid for image cards and lazy-load their signed URLs
const _thumbObserver = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target.querySelector('.rcpt-thumb-img[data-path]');
          if (img && !img.src) {
            getSignedUrl(img.dataset.path, 900)
              .then(url => { img.src = url; })
              .catch(() => null);
          }
        }
      });
    }, { rootMargin: '100px' })
  : null;

// Patch renderGrid to observe new cards
const _origBuildCard = buildCard;

// Wire IntersectionObserver into renderGrid after build
const _innerRenderGrid = renderGrid;
function _observeNewCards() {
  if (!_thumbObserver) return;
  document.querySelectorAll('.rcpt-card[data-id]').forEach(card => {
    _thumbObserver.observe(card);
  });
}
// Monkey-patch: after each loadReceipts cycle, observe cards for lazy thumb loading
const _origLoadReceipts = loadReceipts;
