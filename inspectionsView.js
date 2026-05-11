// inspectionsView.js — Inspection Report Repository UI + data access
// Sections: KPI strip → Trend chart → Filter bar → Reports list → Upload modal → Detail modal
//
// Usage: initInspections({ tenantId, userId })

import { supabase } from './supabaseClient.js';

// ─── State ───────────────────────────────────────────────────────────────────

let _tenantId = null;
let _userId   = null;
let _reports  = [];
let _filter   = { type: '', followup: '', search: '' };
let _initialized = false;
let _loadInflight = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sanitizeFilename(name) {
  return (name || 'report')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
}

function fmtDate(d) {
  if (!d) return '—';
  const [y, m, dd] = d.split('-');
  return `${m}/${dd}/${y}`;
}

function fmtScore(s) {
  if (s == null || s === '') return '—';
  const n = Number(s);
  if (Number.isNaN(n)) return '—';
  return n % 1 === 0 ? `${n.toFixed(0)}` : `${n.toFixed(1)}`;
}

function scoreColor(s) {
  if (s == null) return 'var(--muted, #7a715f)';
  if (s >= 90) return '#3b6e3b';   // basil
  if (s >= 75) return '#c98b1b';   // amber-dark
  return '#c9302c';                 // tomato
}

function fmtBytes(b) {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b/1024).toFixed(0)} KB`;
  return `${(b/1048576).toFixed(1)} MB`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// ─── Data access ─────────────────────────────────────────────────────────────

async function listReports() {
  let q = supabase
    .from('inspection_reports_with_details')
    .select('*')
    .eq('tenant_id', _tenantId)
    .order('inspection_date', { ascending: false })
    .order('created_at',      { ascending: false });

  if (_filter.type)     q = q.eq('inspection_type', _filter.type);
  if (_filter.followup) q = q.eq('followup_status', _filter.followup);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function uploadReport(payload, file) {
  // 1. Insert row (without storage path) to get an ID
  const reportId = crypto.randomUUID();

  let storagePath = null;
  if (file) {
    const safeName = sanitizeFilename(file.name || 'report');
    storagePath    = `${_tenantId}/${reportId}/${safeName}`;
    const { error: upErr } = await supabase.storage
      .from('inspections')
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'application/octet-stream',
      });
    if (upErr) throw upErr;
  }

  const row = {
    id:               reportId,
    tenant_id:        _tenantId,
    uploaded_by:      _userId,
    inspection_date:  payload.inspection_date,
    inspector_name:   payload.inspector_name || null,
    inspector_agency: payload.inspector_agency || null,
    inspection_type:  payload.inspection_type || 'routine',
    result:           payload.result || null,
    score:            payload.score === '' || payload.score == null ? null : Number(payload.score),
    score_scale:      payload.score_scale || 'percent',
    score_grade:      payload.score_grade || null,
    violations_critical: Number(payload.violations_critical || 0),
    violations_major:    Number(payload.violations_major || 0),
    violations_minor:    Number(payload.violations_minor || 0),
    notes:            payload.notes || null,
    followup_due_date: payload.followup_due_date || null,
    followup_status:  payload.followup_due_date ? 'pending' : 'none',
    storage_path:     storagePath,
    file_name:        file ? (file.name || null) : null,
    file_size_bytes:  file ? (file.size || null) : null,
    mime_type:        file ? (file.type || null) : null,
  };

  const { data, error } = await supabase
    .from('inspection_reports')
    .insert(row)
    .select()
    .single();

  if (error) {
    // Rollback storage on insert failure
    if (storagePath) {
      await supabase.storage.from('inspections').remove([storagePath]).catch(() => null);
    }
    throw error;
  }
  return data;
}

async function getSignedUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from('inspections')
    .createSignedUrl(path, 60 * 10); // 10 min
  if (error) return null;
  return data?.signedUrl || null;
}

async function voidReport(id, reason) {
  const { error } = await supabase
    .from('inspection_reports')
    .update({ voided_at: new Date().toISOString(), void_reason: reason || 'Voided by user' })
    .eq('id', id);
  if (error) throw error;
}

async function markFollowupComplete(id) {
  const { error } = await supabase
    .from('inspection_reports')
    .update({ followup_status: 'complete' })
    .eq('id', id);
  if (error) throw error;
}

// ─── Render: shell ───────────────────────────────────────────────────────────

function renderShell() {
  const root = document.getElementById('inspections-root');
  if (!root) return;

  root.innerHTML = `
    <style id="insp-rpt-styles">
      .ir-shell { display: flex; flex-direction: column; gap: 16px; }
      .ir-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
      @media (max-width: 760px) { .ir-kpis { grid-template-columns: repeat(2, 1fr); } }
      .ir-kpi { background: var(--bg-1, #1c1a15); border: 1px solid var(--line, #2c2820); border-radius: 12px; padding: 14px; }
      .ir-kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted, #948c7a); }
      .ir-kpi-value { font-size: 26px; font-weight: 700; margin-top: 6px; }
      .ir-kpi-sub { font-size: 12px; color: var(--muted, #948c7a); margin-top: 2px; }
      .ir-trend-card { background: var(--bg-1, #1c1a15); border: 1px solid var(--line, #2c2820); border-radius: 14px; padding: 16px; }
      .ir-trend-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
      .ir-trend-head h3 { margin: 0; font-size: 16px; }
      .ir-trend-svg { width: 100%; height: 180px; display: block; }
      .ir-toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
      .ir-toolbar select, .ir-toolbar input { background: var(--bg-1, #1c1a15); border: 1px solid var(--line, #2c2820); color: inherit; border-radius: 8px; padding: 8px 10px; font-size: 14px; }
      .ir-toolbar input[type=search] { flex: 1; min-width: 180px; }
      .ir-toolbar .btn-primary { margin-left: auto; }
      .ir-list { display: flex; flex-direction: column; gap: 10px; }
      .ir-row { background: var(--bg-1, #1c1a15); border: 1px solid var(--line, #2c2820); border-radius: 12px; padding: 14px 16px; display: grid; grid-template-columns: 64px 1fr auto auto; gap: 14px; align-items: center; cursor: pointer; transition: border-color .15s; }
      .ir-row:hover { border-color: #e8a33d; }
      @media (max-width: 700px) { .ir-row { grid-template-columns: 56px 1fr auto; } .ir-row .ir-row-meta { display: none; } }
      .ir-score-bubble { width: 56px; height: 56px; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; color: #fff; }
      .ir-score-bubble small { font-size: 9px; opacity: .8; font-weight: 500; }
      .ir-row-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .ir-row-title { font-weight: 600; font-size: 15px; }
      .ir-row-sub { color: var(--muted, #948c7a); font-size: 13px; display: flex; gap: 10px; flex-wrap: wrap; }
      .ir-row-meta { text-align: right; font-size: 13px; color: var(--muted, #948c7a); }
      .ir-delta { font-size: 12px; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
      .ir-delta.up { background: rgba(59,110,59,.15); color: #6fbf73; }
      .ir-delta.down { background: rgba(201,48,44,.15); color: #f08077; }
      .ir-delta.flat { background: rgba(122,113,95,.18); color: var(--muted,#948c7a); }
      .ir-pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: rgba(232,163,61,.15); color: #e8a33d; text-transform: uppercase; letter-spacing: .04em; }
      .ir-pill.warn { background: rgba(201,48,44,.18); color: #f08077; }
      .ir-pill.ok { background: rgba(59,110,59,.15); color: #6fbf73; }
      .ir-empty { text-align: center; padding: 60px 20px; color: var(--muted,#948c7a); }
      .ir-empty .ir-empty-emoji { font-size: 40px; margin-bottom: 10px; }

      /* Modal */
      .ir-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 9000; display: flex; align-items: center; justify-content: center; padding: 16px; }
      .ir-modal { background: var(--bg, #14110c); border: 1px solid var(--line,#2c2820); border-radius: 16px; width: 100%; max-width: 720px; max-height: 90vh; overflow: auto; padding: 22px; }
      .ir-modal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
      .ir-modal-head h3 { margin: 0; font-size: 18px; }
      .ir-close { background: none; border: none; color: var(--muted,#948c7a); font-size: 22px; cursor: pointer; padding: 4px 8px; }
      .ir-form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .ir-form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted,#948c7a); }
      .ir-form label span { letter-spacing: .03em; text-transform: uppercase; }
      .ir-form input, .ir-form select, .ir-form textarea { background: var(--bg-1,#1c1a15); border: 1px solid var(--line,#2c2820); color: inherit; border-radius: 8px; padding: 9px 10px; font-size: 14px; font-family: inherit; }
      .ir-form textarea { resize: vertical; min-height: 70px; }
      .ir-form .full { grid-column: 1 / -1; }
      .ir-form-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; }
      .ir-msg { grid-column: 1 / -1; padding: 8px 12px; border-radius: 8px; font-size: 13px; }
      .ir-msg.err { background: rgba(201,48,44,.15); color: #f08077; }
      .ir-msg.ok { background: rgba(59,110,59,.15); color: #6fbf73; }
      .ir-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
      .ir-detail-cell .lbl { font-size: 11px; color: var(--muted,#948c7a); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 4px; }
      .ir-detail-cell .val { font-size: 15px; font-weight: 500; }
      .ir-detail-viol { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; background: rgba(0,0,0,.15); padding: 10px; border-radius: 10px; margin-bottom: 14px; }
      .ir-detail-viol .v-cell { text-align: center; }
      .ir-detail-viol .v-cell .v-num { font-size: 22px; font-weight: 700; }
      .ir-detail-viol .v-cell .v-lbl { font-size: 11px; color: var(--muted,#948c7a); text-transform: uppercase; }
      .ir-attachment { display: flex; gap: 12px; align-items: center; padding: 12px; background: rgba(232,163,61,.08); border: 1px solid rgba(232,163,61,.3); border-radius: 10px; }
      .ir-attachment .ico { font-size: 28px; }
      .ir-attachment a { color: #e8a33d; text-decoration: none; font-weight: 600; }
    </style>

    <div class="ir-shell">
      <div class="ir-kpis" id="ir-kpis"></div>

      <div class="ir-trend-card">
        <div class="ir-trend-head">
          <h3>Score trend</h3>
          <span class="muted" style="color:var(--muted,#948c7a); font-size:12px">Last 12 reports</span>
        </div>
        <svg class="ir-trend-svg" id="ir-trend-svg" viewBox="0 0 600 180" preserveAspectRatio="none"></svg>
      </div>

      <div class="ir-toolbar">
        <select id="ir-type-filter" aria-label="Filter by type">
          <option value="">All types</option>
          <option value="routine">Routine</option>
          <option value="complaint">Complaint</option>
          <option value="followup">Follow-up</option>
          <option value="reinspection">Re-inspection</option>
          <option value="permit">Permit</option>
          <option value="other">Other</option>
        </select>
        <select id="ir-followup-filter" aria-label="Filter by follow-up">
          <option value="">All follow-ups</option>
          <option value="pending">Follow-up pending</option>
          <option value="complete">Follow-up complete</option>
          <option value="none">No follow-up</option>
        </select>
        <input type="search" id="ir-search" placeholder="Search inspector, agency, notes…" aria-label="Search">
        <button class="btn btn-primary" id="ir-add-btn" data-write-action>+ Add report</button>
      </div>

      <div class="ir-list" id="ir-list" aria-live="polite"></div>
    </div>
  `;
}

// ─── Render: KPIs ────────────────────────────────────────────────────────────

function renderKpis() {
  const el = document.getElementById('ir-kpis');
  if (!el) return;

  const total = _reports.length;
  const withScore = _reports.filter(r => r.score != null);
  const latest = _reports[0]; // already date desc
  const avg = withScore.length
    ? (withScore.reduce((s,r) => s + Number(r.score), 0) / withScore.length)
    : null;
  const pending = _reports.filter(r => r.followup_status === 'pending').length;

  el.innerHTML = `
    <div class="ir-kpi">
      <div class="ir-kpi-label">Total reports</div>
      <div class="ir-kpi-value">${total}</div>
      <div class="ir-kpi-sub">on file</div>
    </div>
    <div class="ir-kpi">
      <div class="ir-kpi-label">Latest score</div>
      <div class="ir-kpi-value" style="color:${scoreColor(latest?.score)}">${latest ? fmtScore(latest.score) : '—'}</div>
      <div class="ir-kpi-sub">${latest ? fmtDate(latest.inspection_date) : '—'}</div>
    </div>
    <div class="ir-kpi">
      <div class="ir-kpi-label">Average score</div>
      <div class="ir-kpi-value" style="color:${scoreColor(avg)}">${avg != null ? fmtScore(avg) : '—'}</div>
      <div class="ir-kpi-sub">${withScore.length} scored</div>
    </div>
    <div class="ir-kpi">
      <div class="ir-kpi-label">Follow-ups due</div>
      <div class="ir-kpi-value" style="color:${pending ? '#e8a33d' : 'var(--muted)'}">${pending}</div>
      <div class="ir-kpi-sub">${pending === 1 ? 'item pending' : 'items pending'}</div>
    </div>
  `;
}

// ─── Render: Trend chart ─────────────────────────────────────────────────────

function renderTrend() {
  const svg = document.getElementById('ir-trend-svg');
  if (!svg) return;

  // Use chronological order, last 12 scored reports
  const series = [..._reports]
    .filter(r => r.score != null)
    .sort((a,b) => (a.inspection_date < b.inspection_date ? -1 : 1))
    .slice(-12);

  if (series.length < 1) {
    svg.innerHTML = `<text x="300" y="90" text-anchor="middle" fill="#7a715f" font-size="13" font-family="Inter, sans-serif">Add your first inspection report to see the trend.</text>`;
    return;
  }

  const W = 600, H = 180, padX = 30, padY = 20;
  const innerW = W - padX*2, innerH = H - padY*2;
  const xs = series.map((_, i) => padX + (series.length === 1 ? innerW/2 : (i / (series.length - 1)) * innerW));
  // Score axis: anchor 60-100 by default, expand if needed
  const allScores = series.map(r => Number(r.score));
  const minS = Math.min(60, ...allScores);
  const maxS = Math.max(100, ...allScores);
  const ys = allScores.map(s => padY + (1 - (s - minS) / (maxS - minS || 1)) * innerH);

  // Build path
  const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ');
  // Filled area below
  const area = `${path} L ${xs[xs.length-1].toFixed(1)} ${(padY+innerH).toFixed(1)} L ${xs[0].toFixed(1)} ${(padY+innerH).toFixed(1)} Z`;

  // Y gridlines at 70/80/90/100
  const gridScores = [70, 80, 90, 100].filter(g => g >= minS && g <= maxS);
  const gridLines = gridScores.map(s => {
    const y = padY + (1 - (s - minS) / (maxS - minS || 1)) * innerH;
    return `<line x1="${padX}" y1="${y.toFixed(1)}" x2="${(W-padX).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#2c2820" stroke-dasharray="2,4" />
            <text x="${padX-6}" y="${(y+4).toFixed(1)}" text-anchor="end" fill="#7a715f" font-size="10" font-family="Inter, sans-serif">${s}</text>`;
  }).join('');

  // Points
  const points = xs.map((x, i) => {
    const r = series[i];
    const color = scoreColor(r.score);
    return `<g>
      <circle cx="${x.toFixed(1)}" cy="${ys[i].toFixed(1)}" r="4.5" fill="${color}" stroke="#1c1a15" stroke-width="2">
        <title>${fmtDate(r.inspection_date)} — ${fmtScore(r.score)}${r.score_grade ? ' (' + r.score_grade + ')' : ''}</title>
      </circle>
    </g>`;
  }).join('');

  // X axis date labels (first, middle, last)
  const xLabels = [];
  if (series.length >= 1) xLabels.push({ x: xs[0], r: series[0] });
  if (series.length >= 3) xLabels.push({ x: xs[Math.floor(series.length/2)], r: series[Math.floor(series.length/2)] });
  if (series.length >= 2) xLabels.push({ x: xs[xs.length-1], r: series[series.length-1] });
  const xLabelSvg = xLabels.map(({x, r}) =>
    `<text x="${x.toFixed(1)}" y="${(H-4).toFixed(1)}" text-anchor="middle" fill="#7a715f" font-size="10" font-family="Inter, sans-serif">${fmtDate(r.inspection_date)}</text>`
  ).join('');

  svg.innerHTML = `
    <defs>
      <linearGradient id="ir-area-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#e8a33d" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#e8a33d" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${gridLines}
    ${series.length >= 2 ? `<path d="${area}" fill="url(#ir-area-grad)" />` : ''}
    ${series.length >= 2 ? `<path d="${path}" fill="none" stroke="#e8a33d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />` : ''}
    ${points}
    ${xLabelSvg}
  `;
}

// ─── Render: list ────────────────────────────────────────────────────────────

function passesSearch(r, q) {
  if (!q) return true;
  const lc = q.toLowerCase();
  return [
    r.inspector_name, r.inspector_agency, r.notes, r.result, r.score_grade
  ].some(v => v && String(v).toLowerCase().includes(lc));
}

function renderList() {
  const el = document.getElementById('ir-list');
  if (!el) return;

  const rows = _reports.filter(r => passesSearch(r, _filter.search));

  if (!rows.length) {
    el.innerHTML = `
      <div class="ir-empty">
        <div class="ir-empty-emoji">📋</div>
        <p style="margin:0 0 4px; font-weight:600; color:inherit">No inspection reports yet</p>
        <p style="margin:0; font-size:13px;">Upload your last health inspection report to start tracking trends and stay ahead of follow-ups.</p>
      </div>`;
    return;
  }

  el.innerHTML = rows.map(r => {
    const color = scoreColor(r.score);
    const grade = r.score_grade || (r.score != null ? '' : '?');
    const scoreText = r.score != null ? fmtScore(r.score) : (grade || '—');
    const isCrit = (r.violations_critical || 0) > 0;
    const fileBadge = r.storage_path ? `<span class="ir-pill ok">📎 File</span>` : '';
    const followupBadge = r.followup_status === 'pending'
      ? `<span class="ir-pill warn">Follow-up due ${r.followup_due_date ? fmtDate(r.followup_due_date) : 'soon'}</span>`
      : '';
    const critBadge = isCrit ? `<span class="ir-pill warn">${r.violations_critical} critical</span>` : '';
    const typeBadge = `<span class="ir-pill">${escapeHtml(r.inspection_type || 'routine')}</span>`;

    let delta = '';
    if (r.score_delta != null && r.score != null) {
      const d = Number(r.score_delta);
      if (Math.abs(d) < 0.5) delta = `<span class="ir-delta flat">±0</span>`;
      else if (d > 0)        delta = `<span class="ir-delta up">▲ ${d.toFixed(1)}</span>`;
      else                   delta = `<span class="ir-delta down">▼ ${Math.abs(d).toFixed(1)}</span>`;
    }

    return `
      <div class="ir-row" data-id="${r.id}" role="button" tabindex="0" aria-label="Open report from ${fmtDate(r.inspection_date)}">
        <div class="ir-score-bubble" style="background:${color}">
          ${scoreText}
          ${r.score_grade ? `<small>GRADE ${escapeHtml(r.score_grade)}</small>` : (r.score != null ? `<small>SCORE</small>` : '')}
        </div>
        <div class="ir-row-main">
          <div class="ir-row-title">${fmtDate(r.inspection_date)} · ${escapeHtml(r.inspector_agency || 'Inspection')}</div>
          <div class="ir-row-sub">
            ${typeBadge}
            ${critBadge}
            ${followupBadge}
            ${fileBadge}
            ${r.violations_total ? `<span>${r.violations_total} total violation${r.violations_total === 1 ? '' : 's'}</span>` : ''}
          </div>
        </div>
        <div class="ir-row-meta">
          ${r.inspector_name ? `<div>${escapeHtml(r.inspector_name)}</div>` : ''}
          ${r.result ? `<div>${escapeHtml(r.result)}</div>` : ''}
        </div>
        <div>${delta}</div>
      </div>
    `;
  }).join('');

  el.querySelectorAll('.ir-row').forEach(row => {
    row.addEventListener('click', () => openDetail(row.dataset.id));
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(row.dataset.id); }
    });
  });
}

// ─── Modal: add report ───────────────────────────────────────────────────────

function openAddModal() {
  const today = new Date().toISOString().slice(0, 10);
  const backdrop = document.createElement('div');
  backdrop.className = 'ir-modal-backdrop';
  backdrop.innerHTML = `
    <div class="ir-modal" role="dialog" aria-modal="true" aria-labelledby="ir-add-title">
      <div class="ir-modal-head">
        <h3 id="ir-add-title">Add inspection report</h3>
        <button class="ir-close" aria-label="Close">✕</button>
      </div>
      <form class="ir-form" id="ir-add-form">
        <label><span>Inspection date *</span>
          <input type="date" name="inspection_date" value="${today}" required>
        </label>
        <label><span>Inspection type</span>
          <select name="inspection_type">
            <option value="routine">Routine</option>
            <option value="complaint">Complaint</option>
            <option value="followup">Follow-up</option>
            <option value="reinspection">Re-inspection</option>
            <option value="permit">Permit</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label><span>Inspector name</span>
          <input type="text" name="inspector_name" placeholder="Jane Inspector">
        </label>
        <label><span>Agency</span>
          <input type="text" name="inspector_agency" placeholder="FL DBPR, county health dept…">
        </label>
        <label><span>Score (0–100)</span>
          <input type="number" name="score" min="0" max="100" step="0.1" placeholder="e.g. 95">
        </label>
        <label><span>Letter grade</span>
          <input type="text" name="score_grade" maxlength="3" placeholder="A · B · C · — ">
        </label>
        <label><span>Critical violations</span>
          <input type="number" name="violations_critical" min="0" value="0">
        </label>
        <label><span>Major violations</span>
          <input type="number" name="violations_major" min="0" value="0">
        </label>
        <label><span>Minor violations</span>
          <input type="number" name="violations_minor" min="0" value="0">
        </label>
        <label><span>Result</span>
          <input type="text" name="result" maxlength="80" placeholder="Pass / Pass w/ corrections / Fail">
        </label>
        <label class="full"><span>Notes</span>
          <textarea name="notes" placeholder="Inspector findings, action items, what was corrected on site…"></textarea>
        </label>
        <label><span>Follow-up due</span>
          <input type="date" name="followup_due_date">
        </label>
        <label><span>Report file (PDF or photo)</span>
          <input type="file" name="file" accept="image/*,application/pdf">
        </label>
        <div class="ir-msg" id="ir-add-msg" hidden></div>
        <div class="ir-form-actions">
          <button type="button" class="btn btn-ghost" id="ir-add-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="ir-add-submit">Save report</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector('.ir-close').addEventListener('click', close);
  backdrop.querySelector('#ir-add-cancel').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

  const form = backdrop.querySelector('#ir-add-form');
  const msg  = backdrop.querySelector('#ir-add-msg');
  const sub  = backdrop.querySelector('#ir-add-submit');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    msg.hidden = true;
    sub.disabled = true;
    sub.textContent = 'Saving…';

    try {
      const fd = new FormData(form);
      const payload = Object.fromEntries(fd.entries());
      const file = fd.get('file');
      const fileObj = file && file.size > 0 ? file : null;
      if (fileObj && fileObj.size > 25 * 1024 * 1024) {
        throw new Error('File is over 25 MB. Please pick a smaller file.');
      }

      await uploadReport(payload, fileObj);
      msg.className = 'ir-msg ok';
      msg.textContent = 'Saved.';
      msg.hidden = false;

      await loadReports();
      setTimeout(close, 600);
    } catch (err) {
      console.error('Inspection upload failed:', err);
      msg.className = 'ir-msg err';
      msg.textContent = err.message || 'Failed to save report. Please try again.';
      msg.hidden = false;
      sub.disabled = false;
      sub.textContent = 'Save report';
    }
  });
}

// ─── Modal: detail ───────────────────────────────────────────────────────────

async function openDetail(id) {
  const r = _reports.find(x => x.id === id);
  if (!r) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'ir-modal-backdrop';
  backdrop.innerHTML = `
    <div class="ir-modal" role="dialog" aria-modal="true">
      <div class="ir-modal-head">
        <h3>${fmtDate(r.inspection_date)} · ${escapeHtml(r.inspector_agency || 'Inspection report')}</h3>
        <button class="ir-close" aria-label="Close">✕</button>
      </div>

      <div style="display:flex; gap:14px; align-items:center; margin-bottom: 14px;">
        <div class="ir-score-bubble" style="background:${scoreColor(r.score)}; width:78px; height:78px; font-size:24px;">
          ${r.score != null ? fmtScore(r.score) : (r.score_grade || '—')}
          ${r.score_grade ? `<small>GRADE ${escapeHtml(r.score_grade)}</small>` : (r.score != null ? `<small>SCORE</small>` : '')}
        </div>
        <div>
          <div style="font-size:13px; color: var(--muted,#948c7a); text-transform:uppercase; letter-spacing:.06em;">Result</div>
          <div style="font-size:18px; font-weight:600;">${escapeHtml(r.result || '—')}</div>
          ${r.score_delta != null ? `<div style="font-size:13px; margin-top:4px;">vs previous: ${
            r.score_delta > 0 ? `<span style="color:#6fbf73">▲ +${Number(r.score_delta).toFixed(1)}</span>` :
            r.score_delta < 0 ? `<span style="color:#f08077">▼ ${Number(r.score_delta).toFixed(1)}</span>` :
            `<span style="color:var(--muted)">no change</span>`}</div>` : ''}
        </div>
      </div>

      <div class="ir-detail-grid">
        <div class="ir-detail-cell"><div class="lbl">Inspector</div><div class="val">${escapeHtml(r.inspector_name || '—')}</div></div>
        <div class="ir-detail-cell"><div class="lbl">Type</div><div class="val">${escapeHtml(r.inspection_type || '—')}</div></div>
        <div class="ir-detail-cell"><div class="lbl">Uploaded by</div><div class="val">${escapeHtml(r.uploader_email || '—')}</div></div>
        <div class="ir-detail-cell"><div class="lbl">Follow-up</div><div class="val">${
          r.followup_status === 'pending' ? `Due ${fmtDate(r.followup_due_date)}` :
          r.followup_status === 'complete' ? 'Complete' : 'None'
        }</div></div>
      </div>

      <div class="ir-detail-viol">
        <div class="v-cell"><div class="v-num" style="color:#f08077">${r.violations_critical || 0}</div><div class="v-lbl">Critical</div></div>
        <div class="v-cell"><div class="v-num" style="color:#e8a33d">${r.violations_major || 0}</div><div class="v-lbl">Major</div></div>
        <div class="v-cell"><div class="v-num" style="color:#a89d80">${r.violations_minor || 0}</div><div class="v-lbl">Minor</div></div>
      </div>

      ${r.notes ? `<div style="margin-bottom:14px;">
        <div class="lbl" style="font-size:11px; color:var(--muted,#948c7a); text-transform:uppercase; letter-spacing:.06em; margin-bottom:4px;">Notes</div>
        <div style="font-size:14px; line-height:1.55; white-space:pre-wrap;">${escapeHtml(r.notes)}</div>
      </div>` : ''}

      <div id="ir-detail-attach" style="margin-bottom: 14px;"></div>

      <div style="display:flex; gap:10px; justify-content:flex-end;">
        ${r.followup_status === 'pending' ? `<button class="btn btn-ghost" id="ir-mark-done" data-write-action>Mark follow-up complete</button>` : ''}
        <button class="btn btn-ghost" id="ir-void" data-write-action style="color:#f08077;">Void</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('.ir-close').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

  // Attachment
  const attachEl = backdrop.querySelector('#ir-detail-attach');
  if (r.storage_path) {
    attachEl.innerHTML = `<div class="ir-attachment"><div class="ico">📎</div><div style="flex:1"><div style="font-weight:600">${escapeHtml(r.file_name || 'Report file')}</div><div style="font-size:12px; color:var(--muted,#948c7a)">${fmtBytes(r.file_size_bytes)} · ${escapeHtml(r.mime_type || '')}</div></div><a id="ir-attach-link" target="_blank" rel="noopener">Loading…</a></div>`;
    getSignedUrl(r.storage_path).then(url => {
      const a = backdrop.querySelector('#ir-attach-link');
      if (a && url) { a.href = url; a.textContent = 'View / Download →'; }
      else if (a)   { a.textContent = 'Unavailable'; a.style.color = 'var(--muted,#948c7a)'; }
    });
  }

  // Follow-up complete
  const fbtn = backdrop.querySelector('#ir-mark-done');
  if (fbtn) fbtn.addEventListener('click', async () => {
    fbtn.disabled = true; fbtn.textContent = 'Saving…';
    try { await markFollowupComplete(r.id); await loadReports(); close(); }
    catch (e) { console.error(e); fbtn.disabled = false; fbtn.textContent = 'Mark follow-up complete'; alert('Failed to update follow-up status'); }
  });

  // Void
  backdrop.querySelector('#ir-void').addEventListener('click', async () => {
    if (!confirm('Void this report? It will be hidden from the list. (Storage file is kept.)')) return;
    try { await voidReport(r.id, 'User voided'); await loadReports(); close(); }
    catch (e) { console.error(e); alert('Failed to void report'); }
  });
}

// ─── Loader ──────────────────────────────────────────────────────────────────

async function loadReports() {
  if (_loadInflight) return _loadInflight;
  _loadInflight = (async () => {
    try {
      _reports = await listReports();
      renderKpis();
      renderTrend();
      renderList();
    } catch (err) {
      console.error('Inspection reports load failed:', err);
      const el = document.getElementById('ir-list');
      if (el) el.innerHTML = `<div class="ir-empty"><p>Failed to load reports. ${escapeHtml(err.message || '')}</p></div>`;
    } finally {
      _loadInflight = null;
    }
  })();
  return _loadInflight;
}

// ─── Bindings ────────────────────────────────────────────────────────────────

function bindControls() {
  document.getElementById('ir-add-btn')?.addEventListener('click', openAddModal);
  document.getElementById('ir-type-filter')?.addEventListener('change', e => {
    _filter.type = e.target.value; loadReports();
  });
  document.getElementById('ir-followup-filter')?.addEventListener('change', e => {
    _filter.followup = e.target.value; loadReports();
  });
  const search = document.getElementById('ir-search');
  if (search) {
    let t = null;
    search.addEventListener('input', e => {
      clearTimeout(t);
      t = setTimeout(() => { _filter.search = e.target.value.trim(); renderList(); }, 180);
    });
  }
}

// ─── Entry ───────────────────────────────────────────────────────────────────

export function initInspections({ tenantId, userId }) {
  _tenantId = tenantId;
  _userId   = userId;

  if (_initialized) {
    loadReports();
    return;
  }
  _initialized = true;

  renderShell();
  bindControls();
  loadReports();
}
