// PIN Unlock screen — 4-digit pad.
//
// Resolves the target email in this priority order:
//   1. sessionStorage 'stationly_pin_target_email' (set by staffGrid when the
//      device is in shared mode and the user tapped a name).
//   2. localStorage LAST_EMAIL_KEY (personal mode — remembers last user).
//
// If the staff has no PIN yet, instead of showing the pad we render an
// inline "Use password to finish setup" CTA that drops them on the login
// screen with email pre-filled.

import * as svc from '../services/staffService.js';
import { haptic } from '../services/nativeBridge.js';

export const route = 'pin';

const PIN_TARGET_EMAIL_KEY    = 'stationly_pin_target_email';
const PIN_TARGET_NAME_KEY     = 'stationly_pin_target_name';
const PIN_TARGET_HAS_PIN_KEY  = 'stationly_pin_target_has_pin';

export async function render(host, ctx) {
  const target = sessionStorage.getItem(PIN_TARGET_EMAIL_KEY) || '';
  const targetName = sessionStorage.getItem(PIN_TARGET_NAME_KEY) || '';
  const targetHasPinFlag = sessionStorage.getItem(PIN_TARGET_HAS_PIN_KEY);
  const email = target || svc.getLastEmail();
  const mode = svc.getCachedDeviceMode() || 'personal';

  if (!email) { ctx.navigate(mode === 'shared' ? 'grid' : 'login'); return; }

  // For shared-mode taps, we already know has_pin from the grid call. For
  // personal mode we trust there's a PIN (otherwise login would have
  // bounced through PIN setup already).
  if (target && targetHasPinFlag === '0') {
    // Tapped a co-worker who hasn't set their PIN yet — surface a clean
    // path: they must sign in with password first (via the invite they
    // got) and they'll be auto-routed to PIN setup.
    host.innerHTML = `
      <main class="staff-main full-h" style="display:flex; flex-direction:column; justify-content:center;">
        <div class="text-center mb-3">
          <div class="staff-logo" style="margin: 0 auto 14px;">S</div>
          <h1>Finish setting up</h1>
          <p class="text-muted mt-1">${escapeHtml(targetName || email)}, you need to sign in once with your password to create a PIN.</p>
        </div>
        <div class="card" style="max-width:380px; margin: 0 auto; width:100%;">
          <button class="btn btn-primary" id="go-password">Sign in with password</button>
          <button class="btn btn-ghost mt-2" id="back-grid">Back to staff list</button>
        </div>
      </main>
    `;
    host.querySelector('#go-password').addEventListener('click', () => {
      // Pass email through so login.js pre-fills.
      sessionStorage.setItem('stationly_login_prefill_email', email);
      ctx.navigate('login');
    });
    host.querySelector('#back-grid').addEventListener('click', () => {
      sessionStorage.removeItem(PIN_TARGET_EMAIL_KEY);
      sessionStorage.removeItem(PIN_TARGET_NAME_KEY);
      sessionStorage.removeItem(PIN_TARGET_HAS_PIN_KEY);
      ctx.navigate(mode === 'shared' ? 'grid' : 'login');
    });
    return;
  }

  let pin = '';
  let busy = false;

  const subTitle = targetName ? `${escapeHtml(targetName)} · ${escapeHtml(email)}` : escapeHtml(email);

  host.innerHTML = `
    <main class="staff-main full-h" style="display:flex; flex-direction:column; justify-content:center;">
      <div class="text-center mb-3">
        <div class="staff-logo" style="margin: 0 auto 14px;">S</div>
        <h1>Enter your PIN</h1>
        <p class="text-muted mt-1">${subTitle}</p>
      </div>
      <div class="pin-display" id="pin-display"></div>
      <div id="pin-error" class="banner banner-error mb-3" style="display:none; max-width:280px; margin: 0 auto 12px;"></div>
      <div class="pin-grid" id="pin-grid"></div>
      <div style="display:flex; gap:12px; justify-content:center; margin-top:16px; flex-wrap:wrap;">
        <button class="btn btn-ghost" id="switch-user">${mode === 'shared' ? 'Back to staff list' : 'Switch user'}</button>
        <button class="btn btn-ghost" id="back-login">Use password instead</button>
      </div>
    </main>
  `;

  const dotsEl = host.querySelector('#pin-display');
  const errEl  = host.querySelector('#pin-error');
  const grid   = host.querySelector('#pin-grid');

  const keys = ['1','2','3','4','5','6','7','8','9','','0','del'];
  grid.innerHTML = keys.map(k => {
    if (k === '') return `<div></div>`;
    if (k === 'del') return `<button class="pin-key pin-key-action" data-key="del" aria-label="delete">⌫</button>`;
    return `<button class="pin-key" data-key="${k}">${k}</button>`;
  }).join('');

  function renderDots() {
    dotsEl.innerHTML = [0,1,2,3].map(i => `<div class="pin-dot ${i < pin.length ? 'filled' : ''}"></div>`).join('');
  }
  renderDots();

  async function trySubmit() {
    busy = true;
    errEl.style.display = 'none';
    try {
      await svc.loginWithPin(email, pin);
      // Clear shared-mode pointers after auth so a refresh doesn't loop.
      sessionStorage.removeItem(PIN_TARGET_EMAIL_KEY);
      sessionStorage.removeItem(PIN_TARGET_NAME_KEY);
      sessionStorage.removeItem(PIN_TARGET_HAS_PIN_KEY);
      haptic('success');
      ctx.onAuth?.();
    } catch (err) {
      haptic('error');
      const body = err.body || {};
      if (err.status === 423) {
        errEl.textContent = 'Too many attempts. Try again in 15 minutes.';
      } else if (typeof body.attempts_left === 'number') {
        errEl.textContent = `Wrong PIN. ${body.attempts_left} ${body.attempts_left === 1 ? 'try' : 'tries'} left.`;
      } else {
        errEl.textContent = err.message || 'Sign-in failed';
      }
      errEl.style.display = 'flex';
      pin = '';
      renderDots();
      busy = false;
    }
  }

  grid.addEventListener('click', (e) => {
    if (busy) return;
    const k = e.target.closest('[data-key]')?.dataset.key;
    if (!k) return;
    haptic('tap');
    if (k === 'del') { pin = pin.slice(0, -1); }
    else if (pin.length < 4) { pin += k; }
    renderDots();
    if (pin.length === 4) trySubmit();
  });

  host.querySelector('#switch-user').addEventListener('click', () => {
    sessionStorage.removeItem(PIN_TARGET_EMAIL_KEY);
    sessionStorage.removeItem(PIN_TARGET_NAME_KEY);
    sessionStorage.removeItem(PIN_TARGET_HAS_PIN_KEY);
    if (mode === 'shared') {
      ctx.navigate('grid');
    } else {
      // Personal mode: clear the anchor so a fresh email can sign in.
      svc.clearLastEmail();
      ctx.navigate('login');
    }
  });

  host.querySelector('#back-login').addEventListener('click', () => ctx.navigate('login'));
}

function escapeHtml(s) { return (s ?? '').toString().replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c])); }
