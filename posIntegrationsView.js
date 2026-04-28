// posIntegrationsView.js — POS connections UI inside the Alerts/Settings area.
// Renders cards for Toast + Square with Connect/Disconnect/Sync now actions.

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient.js';

const PROVIDERS = [
  { id: 'toast', name: 'Toast', logo: '🍞', color: '#FF4F00',
    description: 'Auto-sync sales, labor, and items every night at midnight ET.' },
  { id: 'square', name: 'Square', logo: '◼', color: '#000',
    description: 'Auto-sync orders and items every night at midnight ET.' },
];

export function initPosIntegrations(ctx) {
  const tenantId = ctx?.tenantId || ctx?.tenant?.id;
  if (!tenantId) return;

  // Listen for OAuth return param (?pos_connected=toast or ?pos_error=...)
  handleOAuthReturn();

  // Render after the alerts settings block when settings tab is opened
  injectIntegrationsBlock(tenantId);
}

function handleOAuthReturn() {
  const params = new URLSearchParams(location.search);
  const connected = params.get('pos_connected');
  const err = params.get('pos_error');
  if (connected) {
    showToast(`✓ Connected ${connected} successfully. First sync will run tonight at midnight ET, or click "Sync now".`, 'success');
    cleanUrl();
  } else if (err) {
    showToast(`POS connection failed: ${err.replace(/_/g, ' ')}`, 'error');
    cleanUrl();
  }
}

function cleanUrl() {
  const u = new URL(location.href);
  u.searchParams.delete('pos_connected');
  u.searchParams.delete('pos_error');
  u.searchParams.delete('provider');
  history.replaceState({}, '', u.toString());
}

function showToast(msg, kind = 'info') {
  const t = document.createElement('div');
  t.className = `pos-toast pos-toast-${kind}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 5000);
}

function injectIntegrationsBlock(tenantId) {
  // Add a "Integrations" tab/section under Alerts → Settings
  const settingsContainer = document.getElementById('alerts-settings');
  if (!settingsContainer) return;

  // Avoid duplicate inject
  if (document.getElementById('pos-integrations-block')) return;

  const block = document.createElement('div');
  block.id = 'pos-integrations-block';
  block.innerHTML = `
    <div class="alerts-section-divider">
      <h3>POS integrations</h3>
      <p class="muted">Auto-sync nightly so your dashboard is always current — no more uploading CSVs.</p>
    </div>
    <div class="pos-integrations-grid" id="pos-integrations-grid"></div>
  `;
  settingsContainer.appendChild(block);

  loadAndRender(tenantId);
}

async function loadAndRender(tenantId) {
  const grid = document.getElementById('pos-integrations-grid');
  if (!grid) return;
  const { data: conns } = await supabase
    .from('pos_connections_with_last_run')
    .select('*')
    .eq('tenant_id', tenantId);
  const byProvider = Object.fromEntries((conns || []).map((c) => [c.provider, c]));

  grid.innerHTML = PROVIDERS.map((p) => {
    const c = byProvider[p.id];
    const connected = c && c.status === 'active';
    const last = c?.last_sync_at ? new Date(c.last_sync_at).toLocaleString() : 'Never';
    const lastStatus = c?.last_sync_status || '—';
    const rows = c?.rows_imported_total || 0;
    return `
      <div class="pos-card ${connected ? 'connected' : ''}">
        <div class="pos-card-head">
          <div class="pos-card-logo" style="background:${p.color}">${p.logo}</div>
          <div>
            <div class="pos-card-name">${p.name}</div>
            <div class="pos-card-status">${connected ? '<span class="pos-status-dot ok"></span> Connected' : '<span class="pos-status-dot off"></span> Not connected'}</div>
          </div>
        </div>
        <p class="pos-card-desc">${p.description}</p>
        ${connected ? `
          <div class="pos-card-meta">
            <div><span class="muted">Last sync</span><strong>${last}</strong></div>
            <div><span class="muted">Status</span><strong class="status-${lastStatus}">${lastStatus}</strong></div>
            <div><span class="muted">Total rows</span><strong>${rows.toLocaleString()}</strong></div>
            ${c?.last_run_error ? `<div class="pos-card-error">⚠️ ${escapeHtml(c.last_run_error)}</div>` : ''}
          </div>
          <div class="pos-card-actions">
            <button class="btn btn-secondary" data-pos-sync="${p.id}" data-conn-id="${c.id}">Sync now</button>
            <button class="btn btn-ghost" data-pos-disconnect="${p.id}" data-conn-id="${c.id}">Disconnect</button>
          </div>
        ` : `
          <button class="btn btn-primary" data-pos-connect="${p.id}">Connect ${p.name}</button>
        `}
      </div>
    `;
  }).join('');

  // Wire up click handlers
  grid.querySelectorAll('[data-pos-connect]').forEach((btn) => {
    btn.addEventListener('click', () => connect(tenantId, btn.dataset.posConnect));
  });
  grid.querySelectorAll('[data-pos-sync]').forEach((btn) => {
    btn.addEventListener('click', () => syncNow(tenantId, btn.dataset.connId, btn));
  });
  grid.querySelectorAll('[data-pos-disconnect]').forEach((btn) => {
    btn.addEventListener('click', () => disconnect(btn.dataset.connId, tenantId));
  });
}

async function connect(tenantId, provider) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { showToast('Sign in required', 'error'); return; }
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-oauth-start?provider=${provider}&tenant_id=${tenantId}`, {
    headers: { 'Authorization': `Bearer ${session.access_token}`, 'apikey': SUPABASE_ANON_KEY },
  });
  const out = await resp.json();
  if (out.ok) {
    location.href = out.authorize_url;
  } else {
    showToast(out.error || 'Could not start OAuth', 'error');
  }
}

async function syncNow(tenantId, connId, btn) {
  btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Syncing...';
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-sync-runner`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ connection_id: connId }),
  });
  const out = await resp.json();
  if (out.ok) {
    const r = out.results?.[0];
    if (r?.status === 'success') showToast(`✓ Synced ${r.rows_upserted} transactions`, 'success');
    else showToast(`Sync failed: ${r?.error || 'unknown'}`, 'error');
  } else {
    showToast(`Sync error: ${out.error}`, 'error');
  }
  btn.disabled = false; btn.textContent = orig;
  loadAndRender(tenantId);
}

async function disconnect(connId, tenantId) {
  if (!confirm('Disconnect this POS integration? Historical data stays — but no new auto-syncs will run.')) return;
  await supabase.from('pos_connections').update({ status: 'disconnected' }).eq('id', connId);
  showToast('Disconnected.', 'info');
  loadAndRender(tenantId);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
