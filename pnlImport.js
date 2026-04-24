// pnlImport.js — P&L document upload + AI-assisted mapping.
// Exposes mountPnlImport(tenantId, onConfirmed) which wires up the "Import P&L" button
// and its modal. On confirmed import it calls onConfirmed(totals, period) so the
// calling view can populate its inputs.

import { supabase } from './supabaseClient.js';

const FN_BASE = 'https://vmnhizmibdtlizigbzks.supabase.co/functions/v1';

const CATEGORIES = [
  { value: 'revenue', label: 'Revenue' },
  { value: 'food_cost', label: 'Food cost' },
  { value: 'beverage_cost', label: 'Beverage cost' },
  { value: 'labor', label: 'Labor' },
  { value: 'rent', label: 'Rent' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'other_opex', label: 'Other OpEx' },
  { value: 'ignore', label: 'Ignore (total/subtotal)' },
];

const ACCEPT = '.pdf,.csv,.xlsx,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function fileTypeFor(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.csv')) return 'csv';
  if (name.endsWith('.xlsx')) return 'xlsx';
  return null;
}

function fmt(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function mountPnlImport(tenantId, onConfirmed) {
  // Inject button (idempotent)
  const cardHead = document.querySelector('section[data-view="costs"] .card .card-head');
  if (!cardHead || cardHead.querySelector('#pnl-import-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'pnl-import-btn';
  btn.className = 'btn-amber-sm';
  btn.type = 'button';
  btn.innerHTML = '<span aria-hidden="true">⤴</span>&nbsp; Import P&amp;L';
  btn.style.cssText = 'margin-left:auto;background:#e8a33d;color:#1c1a15;border:0;border-radius:10px;padding:8px 14px;font-weight:600;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:4px';
  cardHead.style.display = 'flex';
  cardHead.style.alignItems = 'center';
  cardHead.style.gap = '12px';
  cardHead.appendChild(btn);

  btn.addEventListener('click', () => openModal(tenantId, onConfirmed));
}

function openModal(tenantId, onConfirmed) {
  document.querySelector('#pnl-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'pnl-modal';
  modal.innerHTML = `
    <style>
      #pnl-modal{position:fixed;inset:0;background:rgba(28,26,21,.58);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;font-family:Inter,system-ui,sans-serif}
      #pnl-modal .pnl-shell{background:#faf5ea;border-radius:18px;width:100%;max-width:920px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 30px 80px rgba(28,26,21,.35);overflow:hidden}
      #pnl-modal .pnl-head{padding:20px 24px;border-bottom:1px solid #ece3cf;display:flex;align-items:center;justify-content:space-between;gap:16px}
      #pnl-modal .pnl-head h2{margin:0;font-family:Fraunces,Georgia,serif;font-weight:500;font-size:22px;color:#1c1a15;letter-spacing:-.3px}
      #pnl-modal .pnl-head .sub{color:#6b6459;font-size:13px;margin-top:2px}
      #pnl-modal .pnl-x{background:none;border:0;font-size:22px;line-height:1;color:#6b6459;cursor:pointer;padding:4px 8px;border-radius:6px}
      #pnl-modal .pnl-x:hover{background:#ece3cf;color:#1c1a15}
      #pnl-modal .pnl-body{padding:24px;overflow:auto;flex:1}
      #pnl-modal .drop{border:2px dashed #d9ccaf;border-radius:14px;padding:44px 20px;text-align:center;cursor:pointer;transition:background .15s,border-color .15s;background:#fffdf7}
      #pnl-modal .drop.hover{border-color:#e8a33d;background:#fdf3dc}
      #pnl-modal .drop h3{margin:0 0 6px;font-family:Fraunces,Georgia,serif;font-weight:500;font-size:20px;color:#1c1a15}
      #pnl-modal .drop p{margin:0;color:#6b6459;font-size:13px}
      #pnl-modal .drop .types{margin-top:14px;font-size:12px;color:#8a8275}
      #pnl-modal input[type=file]{display:none}
      #pnl-modal .status{padding:18px 0;font-size:14px;color:#1c1a15;display:flex;align-items:center;gap:10px}
      #pnl-modal .spin{width:16px;height:16px;border:2px solid #e8a33d;border-right-color:transparent;border-radius:50%;animation:pnl-spin .8s linear infinite}
      @keyframes pnl-spin{to{transform:rotate(360deg)}}
      #pnl-modal .error{background:#fdecea;border:1px solid #f4c7c5;color:#8b1f1b;padding:12px 14px;border-radius:10px;font-size:13px;margin-top:12px}
      #pnl-modal table{width:100%;border-collapse:collapse;font-size:13px;margin-top:14px}
      #pnl-modal thead th{text-align:left;padding:8px 10px;background:#f6efdf;color:#4a443b;font-weight:600;font-size:12px;letter-spacing:.03em;text-transform:uppercase;border-bottom:1px solid #ece3cf}
      #pnl-modal tbody td{padding:8px 10px;border-bottom:1px solid #ece3cf;vertical-align:middle}
      #pnl-modal tbody tr:hover{background:#fffdf7}
      #pnl-modal td.amt{text-align:right;font-variant-numeric:tabular-nums;color:#1c1a15;font-weight:500}
      #pnl-modal td select{width:100%;padding:6px 8px;border:1px solid #d9ccaf;border-radius:7px;background:#fff;font-size:13px;color:#1c1a15}
      #pnl-modal td .conf{font-size:11px;color:#8a8275}
      #pnl-modal td .conf.low{color:#c9302c;font-weight:600}
      #pnl-modal .period-row{display:flex;gap:14px;margin-bottom:14px;align-items:center;flex-wrap:wrap}
      #pnl-modal .period-row label{font-size:12px;color:#6b6459;display:flex;flex-direction:column;gap:4px}
      #pnl-modal .period-row input{padding:7px 10px;border:1px solid #d9ccaf;border-radius:8px;background:#fff;font-size:13px;color:#1c1a15}
      #pnl-modal .totals{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:18px;padding:14px;background:#1c1a15;border-radius:12px}
      #pnl-modal .totals .tile{color:#faf5ea}
      #pnl-modal .totals .lbl{font-size:11px;color:#8a8275;text-transform:uppercase;letter-spacing:.04em}
      #pnl-modal .totals .val{font-family:Fraunces,Georgia,serif;font-size:18px;font-weight:500;margin-top:2px}
      #pnl-modal .totals .val.rev{color:#e8a33d}
      #pnl-modal .pnl-foot{padding:16px 24px;border-top:1px solid #ece3cf;display:flex;justify-content:flex-end;gap:10px;background:#fffdf7}
      #pnl-modal .btn{padding:10px 18px;border-radius:10px;border:0;font-weight:600;font-size:14px;cursor:pointer}
      #pnl-modal .btn.ghost{background:transparent;color:#6b6459}
      #pnl-modal .btn.ghost:hover{background:#ece3cf;color:#1c1a15}
      #pnl-modal .btn.primary{background:#e8a33d;color:#1c1a15}
      #pnl-modal .btn.primary:hover{background:#d79020}
      #pnl-modal .btn:disabled{opacity:.5;cursor:not-allowed}
      @media (max-width: 640px){
        #pnl-modal .totals{grid-template-columns:repeat(2,1fr)}
      }
    </style>
    <div class="pnl-shell" role="dialog" aria-modal="true" aria-labelledby="pnl-title">
      <div class="pnl-head">
        <div>
          <h2 id="pnl-title">Import P&amp;L</h2>
          <div class="sub">Upload a P&amp;L from QuickBooks, Xero, or your accountant. We'll map it to your categories.</div>
        </div>
        <button class="pnl-x" aria-label="Close">×</button>
      </div>
      <div class="pnl-body" id="pnl-body"></div>
      <div class="pnl-foot" id="pnl-foot"></div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('.pnl-x').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });

  renderUpload(tenantId, onConfirmed);
}

function body() { return document.getElementById('pnl-body'); }
function foot() { return document.getElementById('pnl-foot'); }

function renderUpload(tenantId, onConfirmed) {
  body().innerHTML = `
    <label class="drop" id="pnl-drop">
      <input type="file" id="pnl-file" accept="${ACCEPT}" />
      <h3>Drop your P&amp;L here, or click to pick a file</h3>
      <p>We'll extract line items and suggest a category for each.</p>
      <div class="types">Supported: PDF · CSV · Excel (.xlsx) · up to 10 MB</div>
    </label>
    <div id="pnl-status" class="status" hidden></div>
    <div id="pnl-error" class="error" hidden></div>
  `;
  foot().innerHTML = '<button class="btn ghost" id="pnl-cancel">Cancel</button>';
  foot().querySelector('#pnl-cancel').addEventListener('click', () => document.getElementById('pnl-modal')?.remove());

  const drop = document.getElementById('pnl-drop');
  const input = document.getElementById('pnl-file');
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('hover'); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('hover'); }));
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f, tenantId, onConfirmed);
  });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) handleFile(f, tenantId, onConfirmed);
  });
}

async function handleFile(file, tenantId, onConfirmed) {
  const statusEl = document.getElementById('pnl-status');
  const errorEl = document.getElementById('pnl-error');
  errorEl.hidden = true;

  if (file.size > 10 * 1024 * 1024) {
    errorEl.textContent = 'File too large. Please keep it under 10 MB.';
    errorEl.hidden = false;
    return;
  }
  const type = fileTypeFor(file);
  if (!type) {
    errorEl.textContent = 'Unsupported file type. Please upload a PDF, CSV, or XLSX.';
    errorEl.hidden = false;
    return;
  }

  document.getElementById('pnl-drop').style.display = 'none';
  statusEl.hidden = false;
  statusEl.innerHTML = '<div class="spin"></div><span>Uploading…</span>';

  try {
    // 1. Request signed upload URL
    const upResp = await fetch(`${FN_BASE}/pnl-upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId, filename: file.name, file_type: type }),
    });
    if (!upResp.ok) throw new Error(`upload URL: ${await upResp.text()}`);
    const { import_id, upload } = await upResp.json();

    // 2. Upload to signed URL
    const putResp = await fetch(upload.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!putResp.ok) throw new Error(`upload: HTTP ${putResp.status}`);

    // 3. Trigger parse
    statusEl.innerHTML = '<div class="spin"></div><span>Reading your P&amp;L and mapping line items…</span>';
    const parseResp = await fetch(`${FN_BASE}/pnl-parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ import_id }),
    });
    if (!parseResp.ok) throw new Error(`parse: ${await parseResp.text()}`);
    const parsed = await parseResp.json();

    // 4. Load line items for review
    const { data: lines, error: lErr } = await supabase
      .from('pnl_line_items')
      .select('id, raw_label, raw_amount, mapped_category, confidence, ai_reasoning, display_order')
      .eq('import_id', import_id)
      .order('display_order');
    if (lErr) throw lErr;

    renderReview(import_id, parsed, lines || [], tenantId, onConfirmed);
  } catch (e) {
    statusEl.hidden = true;
    document.getElementById('pnl-drop').style.display = '';
    errorEl.textContent = `Import failed: ${e.message || e}`;
    errorEl.hidden = false;
  }
}

function renderReview(importId, parsed, lines, tenantId, onConfirmed) {
  const start = parsed.period_start || '';
  const end = parsed.period_end || '';

  body().innerHTML = `
    <div class="period-row">
      <label>Period start<input type="date" id="pnl-start" value="${start}"></label>
      <label>Period end<input type="date" id="pnl-end" value="${end}"></label>
      <span style="color:#6b6459;font-size:13px">Review the mappings below — change any row before confirming.</span>
    </div>
    <div style="max-height:42vh;overflow:auto;border:1px solid #ece3cf;border-radius:10px">
      <table>
        <thead>
          <tr>
            <th>Line item</th>
            <th style="text-align:right">Amount</th>
            <th style="width:200px">Category</th>
            <th style="width:90px">AI</th>
          </tr>
        </thead>
        <tbody id="pnl-rows"></tbody>
      </table>
    </div>
    <div class="totals" id="pnl-totals"></div>
  `;

  const tbody = document.getElementById('pnl-rows');
  for (const li of lines) {
    const tr = document.createElement('tr');
    tr.dataset.id = li.id;
    tr.dataset.amount = li.raw_amount;
    const conf = Number(li.confidence || 0);
    const confClass = conf < 0.7 ? 'low' : '';
    tr.innerHTML = `
      <td>
        <div style="font-weight:500">${escapeHtml(li.raw_label)}</div>
        <div style="font-size:11px;color:#8a8275;margin-top:2px">${escapeHtml(li.ai_reasoning || '')}</div>
      </td>
      <td class="amt">${fmt(li.raw_amount)}</td>
      <td>
        <select data-cat>
          ${CATEGORIES.map(c => `<option value="${c.value}" ${c.value === li.mapped_category ? 'selected' : ''}>${c.label}</option>`).join('')}
        </select>
      </td>
      <td><span class="conf ${confClass}">${Math.round(conf * 100)}%</span></td>
    `;
    tbody.appendChild(tr);
  }

  foot().innerHTML = `
    <button class="btn ghost" id="pnl-cancel">Cancel</button>
    <button class="btn primary" id="pnl-confirm">Confirm &amp; save</button>
  `;
  foot().querySelector('#pnl-cancel').addEventListener('click', () => document.getElementById('pnl-modal')?.remove());
  tbody.addEventListener('change', recomputeTotals);
  recomputeTotals();

  foot().querySelector('#pnl-confirm').addEventListener('click', () => confirmImport(importId, tenantId, onConfirmed));
}

function recomputeTotals() {
  const totals = { revenue:0, food_cost:0, beverage_cost:0, labor:0, rent:0, utilities:0, marketing:0, other_opex:0 };
  const rows = document.querySelectorAll('#pnl-rows tr');
  rows.forEach(tr => {
    const amt = Number(tr.dataset.amount) || 0;
    const cat = tr.querySelector('[data-cat]').value;
    if (cat !== 'ignore' && totals[cat] !== undefined) totals[cat] += amt;
  });
  const net = totals.revenue - totals.food_cost - totals.beverage_cost - totals.labor - totals.rent - totals.utilities - totals.marketing - totals.other_opex;
  const el = document.getElementById('pnl-totals');
  el.innerHTML = `
    <div class="tile"><div class="lbl">Revenue</div><div class="val rev">${fmt(totals.revenue)}</div></div>
    <div class="tile"><div class="lbl">COGS (food + bev)</div><div class="val">${fmt(totals.food_cost + totals.beverage_cost)}</div></div>
    <div class="tile"><div class="lbl">Labor</div><div class="val">${fmt(totals.labor)}</div></div>
    <div class="tile"><div class="lbl">Net income</div><div class="val" style="color:${net >= 0 ? '#7fb17f' : '#e8746f'}">${fmt(net)}</div></div>
  `;
}

async function confirmImport(importId, tenantId, onConfirmed) {
  const start = document.getElementById('pnl-start').value;
  const end = document.getElementById('pnl-end').value;
  if (!start || !end) { alert('Please set the period start and end dates.'); return; }

  const lineItems = [...document.querySelectorAll('#pnl-rows tr')].map(tr => ({
    id: tr.dataset.id,
    mapped_category: tr.querySelector('[data-cat]').value,
  }));

  const btn = document.getElementById('pnl-confirm');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    const resp = await fetch(`${FN_BASE}/pnl-confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ import_id: importId, period_start: start, period_end: end, line_items: lineItems }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    const { totals } = await resp.json();

    renderSuccess(totals, { start, end }, onConfirmed);
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Confirm & save';
    alert('Save failed: ' + (e.message || e));
  }
}

function renderSuccess(totals, period, onConfirmed) {
  body().innerHTML = `
    <div style="text-align:center;padding:36px 20px">
      <div style="width:56px;height:56px;border-radius:50%;background:#e8a33d;color:#1c1a15;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 14px">✓</div>
      <h3 style="font-family:Fraunces,Georgia,serif;font-weight:500;font-size:24px;margin:0 0 4px;color:#1c1a15">P&amp;L imported</h3>
      <p style="color:#6b6459;margin:0 0 22px">Period ${period.start} → ${period.end} · saved to Stationly</p>
      <div class="totals" style="max-width:560px;margin:0 auto">
        <div class="tile"><div class="lbl">Revenue</div><div class="val rev">${fmt(totals.revenue)}</div></div>
        <div class="tile"><div class="lbl">Food + Bev</div><div class="val">${fmt(totals.food_cost + totals.beverage_cost)}</div></div>
        <div class="tile"><div class="lbl">Labor</div><div class="val">${fmt(totals.labor)}</div></div>
        <div class="tile"><div class="lbl">Other opex</div><div class="val">${fmt(totals.rent + totals.utilities + totals.marketing + totals.other_opex)}</div></div>
      </div>
    </div>
  `;
  foot().innerHTML = '<button class="btn primary" id="pnl-done">Done</button>';
  foot().querySelector('#pnl-done').addEventListener('click', () => {
    document.getElementById('pnl-modal')?.remove();
    try { onConfirmed?.(totals, period); } catch {}
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
