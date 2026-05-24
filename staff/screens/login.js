// Login screen — email + password, with optional "Use PIN instead" link if a
// previous email is remembered. Successful login bubbles up via ctx.onAuth.

import * as svc from '../services/staffService.js';

export const route = 'login';

export function render(host, ctx) {
  const lastEmail = svc.getLastEmail();

  host.innerHTML = `
    <main class="staff-main full-h" style="display:flex; flex-direction:column; justify-content:center; padding-top:48px;">
      <div class="text-center mb-3">
        <div class="staff-logo" style="margin: 0 auto 14px;">S</div>
        <h1>Welcome back</h1>
        <p class="text-muted mt-1">Sign in to clock in & see your shift.</p>
      </div>

      <div class="card">
        <form id="login-form">
          <div class="field">
            <label class="field-label" for="email">Email</label>
            <input class="input" id="email" name="email" type="email" autocomplete="username" value="${lastEmail}" required />
          </div>
          <div class="field">
            <label class="field-label" for="password">Password</label>
            <input class="input" id="password" name="password" type="password" autocomplete="current-password" required />
          </div>
          <div id="login-error" class="banner banner-error mb-2" style="display:none;"></div>
          <button class="btn btn-primary" type="submit" id="login-submit">Sign in</button>
        </form>

        ${lastEmail ? `
          <button class="btn btn-ghost mt-2" id="use-pin">Use PIN instead</button>
        ` : ''}
      </div>

      <p class="text-faint text-center mt-3" style="font-size:12px;">
        Trouble signing in? Ask your manager to resend your invite.
      </p>
    </main>
  `;

  host.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = host.querySelector('#email').value.trim();
    const pw    = host.querySelector('#password').value;
    const errBox = host.querySelector('#login-error');
    const btn = host.querySelector('#login-submit');
    errBox.style.display = 'none';
    btn.textContent = 'Signing in…';
    btn.disabled = true;
    try {
      await svc.loginWithPassword(email, pw);
      ctx.onAuth?.();
    } catch (err) {
      errBox.textContent = err?.message || 'Sign-in failed';
      errBox.style.display = 'flex';
    } finally {
      btn.textContent = 'Sign in';
      btn.disabled = false;
    }
  });

  host.querySelector('#use-pin')?.addEventListener('click', () => ctx.navigate('pin'));
}
