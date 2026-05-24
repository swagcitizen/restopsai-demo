// PIN Unlock screen — 4-digit pad. Falls back to /login if no email saved.

import * as svc from '../services/staffService.js';
import { haptic } from '../services/nativeBridge.js';

export const route = 'pin';

export function render(host, ctx) {
  const email = svc.getLastEmail();
  if (!email) { ctx.navigate('login'); return; }

  let pin = '';
  let busy = false;

  host.innerHTML = `
    <main class="staff-main full-h" style="display:flex; flex-direction:column; justify-content:center;">
      <div class="text-center mb-3">
        <div class="staff-logo" style="margin: 0 auto 14px;">S</div>
        <h1>Enter your PIN</h1>
        <p class="text-muted mt-1">${escapeHtml(email)}</p>
      </div>
      <div class="pin-display" id="pin-display"></div>
      <div id="pin-error" class="banner banner-error mb-3" style="display:none; max-width:280px; margin: 0 auto 12px;"></div>
      <div class="pin-grid" id="pin-grid"></div>
      <button class="btn btn-ghost mt-3" id="back-login">Use password instead</button>
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

  host.querySelector('#back-login').addEventListener('click', () => ctx.navigate('login'));
}

function escapeHtml(s) { return (s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
