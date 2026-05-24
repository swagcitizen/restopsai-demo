// Staff Grid screen — shared-device mode.
// Shows every active staff member at the tenant as a tap target. Tapping a
// name routes to PIN entry pre-bound to that staff member's email.
//
// "Tenant anchor" — the device needs a way to know which tenant to render.
// We use the last email signed in on this device (LAST_EMAIL_KEY) as the
// anchor, since the manager seeds it during initial setup. The
// list_active_staff_for_grid_by_email RPC verifies the anchor's tenant
// has device_mode='shared' before returning anything.

import * as svc from '../services/staffService.js';
import { haptic } from '../services/nativeBridge.js';

export const route = 'grid';

export async function render(host, ctx) {
  const anchor = svc.getLastEmail();
  if (!anchor) { ctx.navigate('login'); return; }

  host.innerHTML = `
    <main class="staff-main full-h" style="display:flex; flex-direction:column; padding-top:32px;">
      <div class="text-center mb-3">
        <div class="staff-logo" style="margin: 0 auto 14px;">S</div>
        <h1>Who's clocking in?</h1>
        <p class="text-muted mt-1">Tap your name to enter your PIN.</p>
      </div>
      <div id="grid-error" class="banner banner-error mb-2" style="display:none; max-width:340px; margin: 0 auto 12px;"></div>
      <div class="card" id="staff-card">
        <div id="staff-list" class="list" aria-busy="true">
          <div class="list-row"><div class="list-row-main"><div class="list-row-title text-muted">Loading staff…</div></div></div>
        </div>
      </div>
      <button class="btn btn-ghost mt-3" id="switch-device">Manager: switch this device</button>
    </main>
  `;

  const errEl = host.querySelector('#grid-error');
  const listEl = host.querySelector('#staff-list');

  let staff = [];
  try {
    staff = await svc.listStaffForGrid(anchor);
  } catch (e) {
    errEl.textContent = e?.message || 'Could not load staff';
    errEl.style.display = 'flex';
  }

  if (!staff.length) {
    listEl.innerHTML = `
      <div class="list-row">
        <div class="list-row-main">
          <div class="list-row-title">No staff to show</div>
          <div class="list-row-sub">Ask your manager to make sure your account is active and this device is in shared mode.</div>
        </div>
      </div>
    `;
    listEl.removeAttribute('aria-busy');
  } else {
    listEl.innerHTML = staff.map(s => `
      <button class="list-row" data-staff-id="${escapeHtml(s.staff_id)}" data-staff-name="${escapeHtml(s.name || '')}" style="width:100%; text-align:left; background:transparent; border:0; padding:0;">
        <div class="list-row-main">
          <div class="list-row-title">${escapeHtml(s.name || '(unnamed)')}</div>
          <div class="list-row-sub">${s.has_pin ? 'Tap to enter PIN' : 'Tap to finish setup'}</div>
        </div>
        <div class="text-muted">›</div>
      </button>
    `).join('');
    listEl.removeAttribute('aria-busy');
  }

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-staff-id]');
    if (!btn) return;
    haptic('tap');
    const staffId = btn.dataset.staffId;
    const row = staff.find(s => s.staff_id === staffId);
    if (!row) return;
    // In shared mode, we point the PIN screen at this specific staff
    // member's email. PIN screen reads getLastEmail() + getLastStaff()
    // and uses the email to call pin-login. We do NOT call setLastEmail
    // here because that would also change the device anchor — instead
    // we use stationly_pin_target which is consumed by pin.js and
    // cleared on auth.
    sessionStorage.setItem('stationly_pin_target_email', row.email || '');
    sessionStorage.setItem('stationly_pin_target_name', row.name || '');
    sessionStorage.setItem('stationly_pin_target_has_pin', row.has_pin ? '1' : '0');
    ctx.navigate('pin');
  });

  host.querySelector('#switch-device').addEventListener('click', () => {
    if (!confirm('Switch this device to a different account? You will need to sign in with email + password.')) return;
    svc.clearLastEmail();
    ctx.navigate('login');
  });
}

function escapeHtml(s) { return (s ?? '').toString().replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c])); }
