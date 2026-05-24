// Force PIN Setup screen — full-screen, non-dismissible until a PIN is set.
// Routed to from staffApp.js immediately after a successful password login
// when employee_pins has no row for this user (set_pin_setup flag in
// sessionStorage). Once saved, navigates to 'today'.

import * as svc from '../services/staffService.js';
import { haptic } from '../services/nativeBridge.js';

export const route = 'pin-setup';

export async function render(host, ctx) {
  const staff = ctx.staff;
  const name = staff?.name || '';

  host.innerHTML = `
    <main class="staff-main full-h" style="display:flex; flex-direction:column; justify-content:center; padding-top:32px;">
      <div class="text-center mb-3">
        <div class="staff-logo" style="margin: 0 auto 14px;">S</div>
        <h1>Create your PIN</h1>
        <p class="text-muted mt-1">${name ? escapeHtml(name) + ', p' : 'P'}ick a 4-digit PIN. You'll use it to clock in from now on.</p>
      </div>
      <div class="card" style="max-width:380px; margin: 0 auto; width:100%;">
        <div class="field">
          <label class="field-label" for="pin1">New PIN (4 digits)</label>
          <input class="input" id="pin1" type="password" inputmode="numeric" maxlength="4" pattern="\\d{4}" autocomplete="new-password" />
        </div>
        <div class="field">
          <label class="field-label" for="pin2">Confirm PIN</label>
          <input class="input" id="pin2" type="password" inputmode="numeric" maxlength="4" pattern="\\d{4}" autocomplete="new-password" />
        </div>
        <div id="setup-err" class="banner banner-error mb-2" style="display:none;"></div>
        <button class="btn btn-primary" id="setup-save">Save PIN and continue</button>
      </div>
      <p class="text-faint text-center mt-3" style="font-size:12px;">
        Don't share your PIN with anyone. You can change it later in your profile.
      </p>
    </main>
  `;

  const errEl = host.querySelector('#setup-err');
  const p1 = host.querySelector('#pin1');
  const p2 = host.querySelector('#pin2');
  const btn = host.querySelector('#setup-save');

  // Autofocus the first input on render.
  setTimeout(() => p1.focus(), 50);

  btn.addEventListener('click', async () => {
    errEl.style.display = 'none';
    const v1 = p1.value;
    const v2 = p2.value;
    if (!/^\d{4}$/.test(v1)) {
      errEl.textContent = 'PIN must be 4 digits.';
      errEl.style.display = 'flex';
      return;
    }
    if (v1 !== v2) {
      errEl.textContent = "PINs don't match.";
      errEl.style.display = 'flex';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await svc.setMyPin(v1);
      haptic('success');
      sessionStorage.removeItem('stationly_force_pin_setup');
      ctx.navigate('today');
    } catch (e) {
      errEl.textContent = e?.message || 'Could not save PIN';
      errEl.style.display = 'flex';
      btn.disabled = false;
      btn.textContent = 'Save PIN and continue';
    }
  });
}

function escapeHtml(s) { return (s ?? '').toString().replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c])); }
