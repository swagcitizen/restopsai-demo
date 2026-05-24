// Login screen — invite-only landing.
//
// Staff cannot self-sign-up here. The only path in is:
//   1. Manager generates an invite link in the manager app.
//   2. Staff opens the link, which routes to /staff/accept.html and
//      auto-signs them in via a server-side magic-link OTP.
//   3. Staff sets a PIN (forced).
//   4. Forever after, they only see the PIN screen.
//
// This screen is shown when someone reaches /staff/ without a session and
// without a remembered email. We surface a "Got an invite link? Open it"
// CTA and an "I already have a PIN" link that flips to the PIN screen so
// they can type their email there.

import * as svc from '../services/staffService.js';

export const route = 'login';

export function render(host, ctx) {
  const lastEmail = svc.getLastEmail();

  host.innerHTML = `
    <main class="staff-main full-h" style="display:flex; flex-direction:column; justify-content:center; padding-top:48px;">
      <div class="text-center mb-3">
        <div class="staff-logo" style="margin: 0 auto 14px;">S</div>
        <h1>Stationly Staff</h1>
        <p class="text-muted mt-1">Clock in, see your shift, message the team.</p>
      </div>

      <div class="card" style="max-width:380px; margin: 0 auto; width:100%;">
        <h2 style="margin: 0 0 6px;">Need access?</h2>
        <p class="text-muted" style="margin: 0 0 14px;">
          Your manager has to invite you. Once they do, you'll get a link &mdash; tap it to set up your PIN.
        </p>
        <div class="banner banner-info" style="display:flex; gap:10px; align-items:flex-start;">
          <div>
            <strong>How it works</strong>
            <div class="text-muted small" style="margin-top:4px;">
              1. Ask your manager to send you a Stationly invite link.<br>
              2. Open the link on this phone.<br>
              3. Pick a 4-digit PIN. That's it &mdash; no passwords.
            </div>
          </div>
        </div>
      </div>

      <div class="card mt-3" style="max-width:380px; margin: 16px auto 0; width:100%;">
        <h3 style="margin: 0 0 6px;">Already set up?</h3>
        <p class="text-muted" style="margin: 0 0 12px;">
          ${lastEmail ? 'Tap below to enter your PIN.' : 'Enter the email your manager invited.'}
        </p>
        <button class="btn btn-primary" id="go-pin">${lastEmail ? 'Use PIN' : 'I have a PIN'}</button>
      </div>

      <p class="text-faint text-center mt-3" style="font-size:12px;">
        Lost your PIN? Ask your manager to send a new invite link.
      </p>
    </main>
  `;

  host.querySelector('#go-pin').addEventListener('click', () => {
    if (lastEmail) {
      ctx.navigate('pin');
    } else {
      // No remembered email — prompt for it inline so we can route to PIN.
      const email = prompt("What email did your manager invite?");
      if (!email) return;
      svc.setLastEmail(email);
      ctx.navigate('pin');
    }
  });
}
