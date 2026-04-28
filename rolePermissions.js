// rolePermissions.js — granular per-tab role gating on top of owner/manager/staff.
// The base role (owner/manager/staff) is enforced via RLS + role-* body classes.
// This module adds an *additional* per-tenant per-role hidden_views[] that the
// owner manages from the Team & Invites view.
//
// Apply: import { applyHiddenViews } from './rolePermissions.js';
//        applyHiddenViews(['labor','clock']);
//
// Settings UI: import { initRolePermissionsUI } from './rolePermissions.js';
//              initRolePermissionsUI({ tenantId, role });  // owner-only

import { supabase } from './supabaseClient.js';

// Master catalogue of nav views the owner can toggle.
// Mirrors data-view= in app.html. Three groupings make the settings UI cleaner.
export const VIEW_CATALOG = [
  { group: 'Operations', items: [
    { key: 'overview',   label: 'Overview' },
    { key: 'briefing',   label: 'Weekly Briefing (AI)' },
    { key: 'costs',      label: 'Costs & P&L' },
    { key: 'recipes',    label: 'Recipe Costing' },
    { key: 'sales',      label: 'Sales & Menu' },
    { key: 'inventory',  label: 'Inventory' },
    { key: 'invoices',   label: 'Invoices & AP' },
  ]},
  { group: 'People & Time', items: [
    { key: 'labor',      label: 'Labor' },
    { key: 'scheduler',  label: 'Shift Scheduler' },
    { key: 'clock',      label: 'Time Clock' },
    { key: 'tasks',      label: 'Task Assignments' },
  ]},
  { group: 'Compliance & Admin', items: [
    { key: 'safety',     label: 'Food Safety' },
    { key: 'inspection', label: 'DBPR Inspection Prep' },
    { key: 'compliance', label: 'Licenses' },
    { key: 'team',       label: 'Team & Invites' },
    { key: 'alerts',     label: 'Alerts' },
    { key: 'billing',    label: 'Billing' },
  ]},
];

// Some views must always be visible to *some* role to keep the app usable.
// (E.g. owners always see Billing + Team. We don't enforce this client-side
// so much as default it in the UI; the server is permissive and trusts owners.)

// ───────── Apply hidden views to current page ─────────

export function applyHiddenViews(hiddenViews) {
  const set = new Set(hiddenViews || []);
  // Hide nav buttons + view sections matching data-view
  document.querySelectorAll('[data-view]').forEach((el) => {
    const v = el.getAttribute('data-view');
    if (set.has(v)) {
      el.classList.add('rp-hidden');
    } else {
      el.classList.remove('rp-hidden');
    }
  });

  // If the currently-active view was just hidden, fall back to overview
  const activeNav = document.querySelector('.nav-item.active[data-view]');
  if (activeNav && set.has(activeNav.getAttribute('data-view'))) {
    const fallback = document.querySelector('.nav-item:not(.rp-hidden)[data-view]');
    if (fallback) fallback.click();
  }
}

export async function loadMyHiddenViews(tenantId) {
  if (!tenantId) return [];
  const { data, error } = await supabase.rpc('get_my_role_permissions', { p_tenant_id: tenantId });
  if (error) {
    console.warn('[rolePermissions] get_my_role_permissions failed', error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

// ───────── Owner settings UI (rendered into Team & Invites view) ─────────

export async function initRolePermissionsUI({ tenantId, role }) {
  if (role !== 'owner') return;
  // Wait for Team view to exist
  const teamView = document.querySelector('section.view[data-view="team"]');
  if (!teamView) return;

  // Avoid double-mount
  if (teamView.querySelector('#role-perm-card')) return;

  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'role-perm-card';
  card.innerHTML = `
    <div class="card-head">
      <h3>Role permissions</h3>
      <span class="muted">Hide individual tabs from managers and staff. Owners always see everything.</span>
    </div>
    <div id="role-perm-content" class="role-perm-content">
      <div class="muted">Loading…</div>
    </div>
  `;
  teamView.appendChild(card);

  await renderRolePermContent(tenantId);
}

async function renderRolePermContent(tenantId) {
  const root = document.getElementById('role-perm-content');
  if (!root) return;

  const { data, error } = await supabase.rpc('list_role_permissions', { p_tenant_id: tenantId });
  if (error) {
    root.innerHTML = `<div class="rp-error">Failed to load: ${error.message}</div>`;
    return;
  }

  // Map { role -> Set(hidden) }
  const map = { owner: new Set(), manager: new Set(), staff: new Set() };
  for (const row of (data || [])) {
    map[row.role] = new Set(row.hidden_views || []);
  }

  let html = `
    <div class="rp-table-wrap">
      <table class="rp-table">
        <thead>
          <tr>
            <th class="rp-view-col">View</th>
            <th class="rp-role-col">Manager</th>
            <th class="rp-role-col">Staff</th>
          </tr>
        </thead>
        <tbody>
  `;

  for (const grp of VIEW_CATALOG) {
    html += `<tr class="rp-group"><td colspan="3">${grp.group}</td></tr>`;
    for (const item of grp.items) {
      // Owner toggles intentionally not exposed (owners always see all).
      const mgrChecked = !map.manager.has(item.key);
      const stfChecked = !map.staff.has(item.key);
      html += `
        <tr>
          <td class="rp-view-col">${item.label}</td>
          <td class="rp-role-col">
            <label class="rp-switch">
              <input type="checkbox" data-role="manager" data-view="${item.key}" ${mgrChecked ? 'checked' : ''} />
              <span class="rp-slider"></span>
            </label>
          </td>
          <td class="rp-role-col">
            <label class="rp-switch">
              <input type="checkbox" data-role="staff" data-view="${item.key}" ${stfChecked ? 'checked' : ''} />
              <span class="rp-slider"></span>
            </label>
          </td>
        </tr>
      `;
    }
  }

  html += `
        </tbody>
      </table>
    </div>
    <div class="rp-actions">
      <span class="muted" id="rp-status"></span>
      <button class="btn btn-primary" id="rp-save-btn" data-write-action>Save permissions</button>
    </div>
  `;

  root.innerHTML = html;

  document.getElementById('rp-save-btn').addEventListener('click', async () => {
    await saveRolePerms(tenantId, root);
  });
}

async function saveRolePerms(tenantId, root) {
  const status = document.getElementById('rp-status');
  const saveBtn = document.getElementById('rp-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  if (status) { status.textContent = ''; status.className = 'muted'; }

  const hidden = { manager: [], staff: [] };
  root.querySelectorAll('input[type="checkbox"][data-role]').forEach((cb) => {
    const role = cb.getAttribute('data-role');
    const view = cb.getAttribute('data-view');
    if (!cb.checked) hidden[role].push(view); // unchecked = hidden
  });

  try {
    for (const role of ['manager', 'staff']) {
      const { error } = await supabase.rpc('set_role_permissions', {
        p_tenant_id: tenantId,
        p_role: role,
        p_hidden_views: hidden[role],
      });
      if (error) throw error;
    }
    if (status) {
      status.textContent = 'Saved. Managers and staff will see updates next time they refresh.';
      status.className = 'rp-ok';
    }
  } catch (err) {
    console.error('[rolePermissions] save failed', err);
    if (status) {
      status.textContent = `Save failed: ${err?.message || err}`;
      status.className = 'rp-error';
    }
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save permissions'; }
  }
}
