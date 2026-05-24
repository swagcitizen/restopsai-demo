// Login screen — email + password, with optional "Use PIN instead" link if a
// previous email is remembered. Successful login bubbles up via ctx.onAuth.
// Also exposes an inline "Forgot password?" flow that calls the public
// request-password-reset edge function.

import * as svc from '../services/staffService.js';

export const route = 'login';

const SUPABASE_URL = 'https://vmnhizmibdtlizigbzks.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fBz-1MwcGCbytU_k4dXHQg_s1_2cIUd';

export function render(host, ctx) {
  // Prefill priority: shared-grid handoff > last email used on this device.
  const prefill = sessionStorage.getItem('stationly_login_prefill_email') || '';
  if (prefill) sessionStorage.removeItem('stationly_login_prefill_email');
  const lastEmail = prefill || svc.getLastEmail();
  // If we land here via /#forgot (from the reset.html fallback), open the
  // forgot panel by default.
  const openForgot = (window.location.hash || '').toLowerCase() === '#forgot';

  host.innerHTML = `
    <main class="staff-main full-h" style="display:flex; flex-direction:column; justify-content:center; padding-top:48px;">
      <div class="text-center mb-3">
        <div class="staff-logo" style="margin: 0 auto 14px;">S</div>
        <h1>Welcome back</h1>
        <p class="text-muted mt-1">Sign in to clock in & see your shift.</p>
      </div>

      <div class="card" id="signin-card" ${openForgot ? 'hidden' : ''}>
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

        <div style="display:flex; gap:12px; justify-content:space-between; margin-top:12px; flex-wrap:wrap;">
          ${lastEmail ? `<button class="btn btn-ghost" id="use-pin">Use PIN instead</button>` : '<span></span>'}
          <button class="btn btn-ghost" id="show-forgot" type="button">Forgot password?</button>
        </div>
      </div>

      <div class="card" id="forgot-card" ${openForgot ? '' : 'hidden'}>
        <h2 style="margin:0 0 8px;">Reset your password</h2>
        <p class="text-muted mb-2">We'll email you a link to choose a new one.</p>
        <form id="forgot-form">
          <div class="field">
            <label class="field-label" for="forgot-email">Email</label>
            <input class="input" id="forgot-email" name="email" type="email" autocomplete="username" value="${lastEmail}" required />
          </div>
          <div id="forgot-msg" class="banner banner-error mb-2" style="display:none;"></div>
          <button class="btn btn-primary" type="submit" id="forgot-submit">Send reset link</button>
          <button class="btn btn-ghost mt-2" id="back-to-signin" type="button">Back to sign in</button>
        </form>
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
      // Refresh cached device_mode for this tenant.
      svc.fetchDeviceMode(email).catch(() => {});
      // Force PIN setup on first password login. After this, the staff
      // will land on the PIN screen by default and never see the password
      // form unless they tap "Use password instead".
      const hasPin = await svc.meHasPin().catch(() => false);
      if (!hasPin) {
        sessionStorage.setItem('stationly_force_pin_setup', '1');
      }
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

  // ----- Forgot password flow -----
  const signinCard = host.querySelector('#signin-card');
  const forgotCard = host.querySelector('#forgot-card');

  host.querySelector('#show-forgot').addEventListener('click', () => {
    signinCard.hidden = true;
    forgotCard.hidden = false;
    // Pre-fill with the email typed in the sign-in form if available.
    const typed = host.querySelector('#email').value.trim();
    if (typed) host.querySelector('#forgot-email').value = typed;
  });

  host.querySelector('#back-to-signin').addEventListener('click', () => {
    forgotCard.hidden = true;
    signinCard.hidden = false;
    // Clean up the #forgot hash so a refresh doesn't re-open the panel.
    if ((window.location.hash || '').toLowerCase() === '#forgot') {
      history.replaceState(null, '', window.location.pathname);
    }
  });

  host.querySelector('#forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = host.querySelector('#forgot-email').value.trim();
    const msg = host.querySelector('#forgot-msg');
    const btn = host.querySelector('#forgot-submit');
    msg.classList.remove('banner-success');
    msg.classList.add('banner-error');
    msg.style.display = 'none';

    if (!email) {
      msg.textContent = 'Enter your email.';
      msg.style.display = 'flex';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/request-password-reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          email,
          redirect_to: `${window.location.origin}/staff/reset.html`,
        }),
      });
      // The edge function always returns 200 to prevent enumeration.
      if (!resp.ok) throw new Error('Could not send reset email');
      msg.classList.remove('banner-error');
      msg.classList.add('banner-success');
      msg.textContent = 'If an account exists for this email, a reset link is on the way. Check your inbox (and spam).';
      msg.style.display = 'flex';
    } catch (err) {
      msg.textContent = err?.message || 'Could not send reset email';
      msg.style.display = 'flex';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send reset link';
    }
  });
}
