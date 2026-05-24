// Overage Response — staff member is past scheduled_end_at on an open shift.
// Quick +15 / +30 / +60 buttons, optional reason, or cancel-and-clock-out.

import * as svc from '../services/staffService.js';
import { haptic } from '../services/nativeBridge.js';
import { renderShell, escapeHtml } from '../components.js';

export const route = 'overage';
export const tabId = 'today';

export async function render(host, ctx) {
  renderShell(host, { title: 'Shift over', sub: 'Past scheduled end', activeTab: 'today', ctx });
  const main = host.querySelector('#screen-main');

  const open = await svc.getOpenShift().catch(() => null);
  if (!open) { ctx.navigate('today'); return; }

  const pending = (await svc.getMyOpenExtensions(open.id))
    .find(e => e.status === 'pending');

  if (pending) {
    main.innerHTML = pendingView(pending);
    main.querySelector('#btn-back').addEventListener('click', () => ctx.navigate('today'));
    return;
  }

  let chosen = null;

  const scheduledEndStr = open.scheduled_end_at
    ? new Date(open.scheduled_end_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : 'your scheduled end';

  main.innerHTML = `
    <div class="card" style="border-left: 4px solid var(--accent-2);">
      <div class="eyebrow text-error">Shift over</div>
      <h2 class="mt-1">You're past your scheduled end</h2>
      <p class="text-muted mt-1">Scheduled out at ${scheduledEndStr}.</p>
    </div>

    <div class="section-title">Need more time?</div>
    <div class="btn-row">
      <button class="btn" data-mins="15">+15 min</button>
      <button class="btn" data-mins="30">+30 min</button>
      <button class="btn" data-mins="60">+60 min</button>
    </div>
    <div class="field mt-3">
      <label class="field-label" for="reason">Reason (optional)</label>
      <input class="input" id="reason" placeholder="Last delivery still out" />
    </div>
    <button class="btn btn-primary" id="btn-request" disabled>Request from manager</button>

    <div class="section-title mt-4">Or end it now</div>
    <button class="btn" id="btn-clockout">No, clock me out now</button>
  `;

  const reqBtn = main.querySelector('#btn-request');

  main.querySelectorAll('[data-mins]').forEach(b => {
    b.addEventListener('click', () => {
      chosen = Number(b.dataset.mins);
      main.querySelectorAll('[data-mins]').forEach(x => x.classList.remove('btn-primary'));
      b.classList.add('btn-primary');
      reqBtn.disabled = false;
      haptic('tap');
    });
  });

  reqBtn.addEventListener('click', async () => {
    if (!chosen) return;
    reqBtn.disabled = true;
    reqBtn.textContent = 'Sending…';
    try {
      const reason = main.querySelector('#reason').value.trim();
      await svc.requestExtension({ timeEntryId: open.id, minutes: chosen, reason });
      haptic('success');
      ctx.navigate('overage'); // re-render to show pending state
    } catch (e) {
      haptic('error');
      alert(e?.message || 'Could not send request');
      reqBtn.disabled = false;
      reqBtn.textContent = 'Request from manager';
    }
  });

  main.querySelector('#btn-clockout').addEventListener('click', () => ctx.navigate('clock'));
}

function pendingView(ext) {
  return `
    <div class="card" style="border-left: 4px solid var(--warn);">
      <div class="eyebrow">Waiting on manager</div>
      <h2 class="mt-1">+${ext.requested_minutes} min request sent</h2>
      <p class="text-muted mt-1">You'll get a notification when it's approved or denied.</p>
      ${ext.reason ? `<div class="mt-2"><span class="text-faint" style="font-size:12px;">Reason:</span> ${escapeHtml(ext.reason)}</div>` : ''}
    </div>
    <button class="btn mt-3" id="btn-back">Back to Today</button>
  `;
}
