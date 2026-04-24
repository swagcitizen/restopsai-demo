// platform.js — Stationly platform admin page.
// Gated by profiles.is_platform_owner (see platform_owner_support migration).

import { supabase, getSession, getProfile, signOut } from './supabaseClient.js';

const state = {
  tenants: [],
  filter: '',
};

async function bootstrap() {
  const session = await getSession();
  if (!session) {
    window.location.href = './login.html';
    return;
  }
  document.getElementById('user-email').textContent = session.user.email || '—';

  const profile = await getProfile();
  if (!profile || !profile.is_platform_owner) {
    showError("You don't have access to the Stationly platform admin. This page is reserved for platform owners.");
    document.getElementById('loading').hidden = true;
    document.getElementById('new-tenant-btn').disabled = true;
    return;
  }

  wireEvents();
  await refresh();
}

function showError(msg) {
  const box = document.getElementById('error-box');
  box.textContent = msg;
  box.hidden = false;
}

async function refresh() {
  document.getElementById('loading').hidden = false;
  document.getElementById('tenants-table').hidden = true;
  document.getElementById('empty-state').hidden = true;

  const { data, error } = await supabase.rpc('platform_list_tenants');
  document.getElementById('loading').hidden = true;

  if (error) {
    showError(`Couldn't load tenants: ${error.message}`);
    return;
  }
  state.tenants = data || [];
  renderStats();
  renderTable();
}

function renderStats() {
  const total = state.tenants.length;
  const trial = state.tenants.filter(t => t.subscription_status === 'trialing').length;
  const paying = state.tenants.filter(t => t.subscription_status === 'active').length;
  const seats = state.tenants.reduce((n, t) => n + Number(t.member_count || 0), 0);
  document.getElementById('stats').hidden = false;
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-trial').textContent = trial;
  document.getElementById('stat-paying').textContent = paying;
  document.getElementById('stat-seats').textContent = seats;
}

function renderTable() {
  const q = state.filter.trim().toLowerCase();
  const rows = state.tenants.filter(t => {
    if (!q) return true;
    return [t.name, t.city, t.state, t.owner_email].some(s => (s || '').toLowerCase().includes(q));
  });

  const tbody = document.getElementById('tenants-body');
  tbody.innerHTML = '';

  if (!rows.length) {
    document.getElementById('tenants-table').hidden = true;
    const empty = document.getElementById('empty-state');
    empty.hidden = false;
    empty.querySelector('h3').textContent = state.tenants.length ? 'No matches' : 'No tenants yet';
    empty.querySelector('p').textContent = state.tenants.length
      ? 'Try a different search.'
      : 'Create the first one to get started.';
    return;
  }

  document.getElementById('tenants-table').hidden = false;
  document.getElementById('empty-state').hidden = true;

  for (const t of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="tenant-name">${esc(t.name)}</div>
        <div class="tenant-meta">${esc(t.restaurant_type || '')} · ${esc([t.city, t.state].filter(Boolean).join(', ') || '—')}</div>
      </td>
      <td><span class="badge plan">${esc(t.plan || 'trial')}</span></td>
      <td>${renderStatus(t.subscription_status, t.trial_ends_at)}</td>
      <td>${t.member_count || 0}</td>
      <td style="color:var(--text-muted); font-size:12px">${esc(t.owner_email || '—')}</td>
      <td style="color:var(--text-faint); font-size:12px">${fmtDate(t.created_at)}</td>
      <td>
        <div class="actions">
          <button class="btn sm" data-imp="${t.id}">Impersonate →</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function renderStatus(status, trialEnds) {
  if (status === 'trialing') {
    const days = trialEnds ? Math.ceil((new Date(trialEnds) - Date.now()) / 86400000) : null;
    const suffix = days != null && days >= 0 ? ` · ${days}d left` : '';
    return `<span class="badge trial">Trial${suffix}</span>`;
  }
  if (status === 'active') return `<span class="badge active">Active</span>`;
  if (status === 'canceled') return `<span class="badge canceled">Canceled</span>`;
  return `<span class="badge">${esc(status || '—')}</span>`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '—'; }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function wireEvents() {
  document.getElementById('signout-btn').addEventListener('click', async () => {
    await signOut();
  });

  document.getElementById('search').addEventListener('input', (e) => {
    state.filter = e.target.value;
    renderTable();
  });

  document.getElementById('new-tenant-btn').addEventListener('click', openNewModal);
  document.getElementById('new-close').addEventListener('click', closeNewModal);
  document.getElementById('new-cancel').addEventListener('click', closeNewModal);
  document.getElementById('new-modal').addEventListener('click', (e) => {
    if (e.target.id === 'new-modal') closeNewModal();
  });
  document.getElementById('new-submit').addEventListener('click', submitNewTenant);

  // Impersonate click delegation
  document.getElementById('tenants-body').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-imp]');
    if (!btn) return;
    const tenantId = btn.dataset.imp;
    const tenant = state.tenants.find(t => t.id === tenantId);
    if (!confirm(`Impersonate "${tenant?.name}"?\n\nYou'll be added as an owner-level member and landed in their dashboard.`)) return;

    btn.disabled = true; btn.textContent = 'Switching…';
    const { error } = await supabase.rpc('platform_impersonate_tenant', { _tenant_id: tenantId });
    if (error) {
      btn.disabled = false; btn.textContent = 'Impersonate →';
      alert(`Impersonate failed: ${error.message}`);
      return;
    }
    window.location.href = './app.html';
  });
}

function openNewModal() {
  document.getElementById('new-modal').classList.add('open');
  document.getElementById('new-name').value = '';
  document.getElementById('new-city').value = '';
  document.getElementById('new-type').value = 'pizzeria';
  document.getElementById('new-state').value = 'FL';
  document.getElementById('new-error').hidden = true;
  setTimeout(() => document.getElementById('new-name').focus(), 50);
}

function closeNewModal() {
  document.getElementById('new-modal').classList.remove('open');
}

async function submitNewTenant() {
  const name = document.getElementById('new-name').value.trim();
  const type = document.getElementById('new-type').value;
  const city = document.getElementById('new-city').value.trim() || null;
  const stateCode = document.getElementById('new-state').value;

  const err = document.getElementById('new-error');
  err.hidden = true;

  if (!name) {
    err.textContent = 'Please enter a restaurant name.';
    err.hidden = false;
    return;
  }

  const btn = document.getElementById('new-submit');
  btn.disabled = true; btn.textContent = 'Creating…';

  const { data, error } = await supabase.rpc('platform_create_tenant', {
    _name: name,
    _restaurant_type: type,
    _state: stateCode,
    _city: city,
  });

  if (error) {
    btn.disabled = false; btn.textContent = 'Create & impersonate';
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  // The RPC auto-adds the platform owner as an owner-member, so we can land directly in app.
  // Set default_tenant_id so next session opens here too.
  await supabase.rpc('platform_impersonate_tenant', { _tenant_id: data }).catch(() => {});
  window.location.href = './app.html';
}

bootstrap().catch(e => {
  console.error(e);
  showError(`Couldn't load the platform page: ${e.message || e}`);
});
