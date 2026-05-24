// Profile screen — weekly hours, PIN setup, time-off request, sign out.

import * as svc from '../services/staffService.js';
import { haptic, canPromptInstall, promptInstall } from '../services/nativeBridge.js';
import { renderShell, escapeHtml } from '../components.js';

export const route = 'profile';
export const tabId = 'profile';

export async function render(host, ctx) {
  renderShell(host, { title: 'Me', sub: ctx.staff?.name || '', activeTab: 'profile', ctx });
  const main = host.querySelector('#screen-main');

  const [weekly, timeOff] = await Promise.all([
    svc.getWeeklyHours().catch(() => ({ worked: 0, scheduled: 0 })),
    svc.getMyTimeOff().catch(() => []),
  ]);

  main.innerHTML = `
    <div class="stats-grid">
      <div class="stat">
        <div class="stat-label">This week</div>
        <div class="stat-value">${weekly.worked}h</div>
        <div class="stat-sub">worked</div>
      </div>
      <div class="stat">
        <div class="stat-label">Pay rate</div>
        <div class="stat-value">$${Number(ctx.staff?.hourly_rate || 0).toFixed(2)}</div>
        <div class="stat-sub">per hour</div>
      </div>
    </div>

    <div class="section-title">Quick actions</div>
    <div class="card">
      <div class="list">
        <div class="list-row" id="row-pin" role="button" style="cursor:pointer;">
          <div class="list-row-main">
            <div class="list-row-title">Set up PIN</div>
            <div class="list-row-sub">Faster sign-in next time</div>
          </div>
          <div class="text-muted">›</div>
        </div>
        <div class="list-row" id="row-timeoff" role="button" style="cursor:pointer;">
          <div class="list-row-main">
            <div class="list-row-title">Request time off</div>
          </div>
          <div class="text-muted">›</div>
        </div>
        ${canPromptInstall() ? `
        <div class="list-row" id="row-install" role="button" style="cursor:pointer;">
          <div class="list-row-main">
            <div class="list-row-title">Install Stationly</div>
            <div class="list-row-sub">Add to home screen</div>
          </div>
          <div class="text-muted">›</div>
        </div>` : ''}
      </div>
    </div>

    ${timeOff.length ? `
      <div class="section-title">Time off</div>
      <div class="card"><div class="list">
        ${timeOff.map(t => `
          <div class="list-row">
            <div class="list-row-main">
              <div class="list-row-title">${escapeHtml(t.start_date)} → ${escapeHtml(t.end_date)}</div>
              <div class="list-row-sub">${escapeHtml(t.kind || 'personal')}</div>
            </div>
            <span class="pill ${pillCls(t.status)}">${escapeHtml(t.status)}</span>
          </div>
        `).join('')}
      </div></div>
    ` : ''}

    <button class="btn mt-4" id="btn-signout">Sign out</button>
  `;

  main.querySelector('#row-pin').addEventListener('click', () => openPinSheet(ctx));
  main.querySelector('#row-timeoff').addEventListener('click', () => openTimeOffSheet(ctx));
  main.querySelector('#row-install')?.addEventListener('click', () => promptInstall());
  main.querySelector('#btn-signout').addEventListener('click', async () => {
    await svc.signOut();
    ctx.onSignOut?.();
  });
}

function pillCls(status) {
  return ({ approved: 'pill-success', denied: 'pill-error', pending: 'pill-warn' })[status] || '';
}

function openPinSheet(ctx) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <div class="sheet-handle"></div>
      <h2 class="sheet-title">Set up PIN</h2>
      <p class="text-muted mb-3">Pick a 4-digit PIN for faster sign-in next time. Don't share it.</p>
      <div class="field">
        <label class="field-label" for="pin1">New PIN (4 digits)</label>
        <input class="input" id="pin1" type="password" inputmode="numeric" maxlength="4" pattern="\\d{4}" />
      </div>
      <div class="field">
        <label class="field-label" for="pin2">Confirm PIN</label>
        <input class="input" id="pin2" type="password" inputmode="numeric" maxlength="4" pattern="\\d{4}" />
      </div>
      <div id="pin-err" class="banner banner-error mb-2" style="display:none;"></div>
      <button class="btn btn-primary" id="pin-save">Save PIN</button>
      <button class="btn btn-ghost mt-2" id="pin-cancel">Cancel</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('#pin-cancel').addEventListener('click', close);
  backdrop.querySelector('#pin-save').addEventListener('click', async () => {
    const p1 = backdrop.querySelector('#pin1').value;
    const p2 = backdrop.querySelector('#pin2').value;
    const err = backdrop.querySelector('#pin-err');
    err.style.display = 'none';
    if (!/^\d{4}$/.test(p1)) { err.textContent = 'PIN must be 4 digits.'; err.style.display = 'flex'; return; }
    if (p1 !== p2)             { err.textContent = "PINs don't match.";      err.style.display = 'flex'; return; }
    try {
      await svc.setMyPin(p1);
      haptic('success');
      close();
    } catch (e) { err.textContent = e.message || 'Could not save'; err.style.display = 'flex'; }
  });
}

function openTimeOffSheet(ctx) {
  const today = new Date().toISOString().slice(0, 10);
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <div class="sheet-handle"></div>
      <h2 class="sheet-title">Request time off</h2>
      <div class="field">
        <label class="field-label" for="to-kind">Type</label>
        <select class="input" id="to-kind">
          <option value="personal">Personal</option>
          <option value="sick">Sick</option>
          <option value="vacation">Vacation</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="field"><label class="field-label" for="to-start">Start date</label><input class="input" type="date" id="to-start" value="${today}" /></div>
      <div class="field"><label class="field-label" for="to-end">End date</label><input class="input" type="date" id="to-end" value="${today}" /></div>
      <div class="field"><label class="field-label" for="to-note">Note (optional)</label><textarea class="input" id="to-note"></textarea></div>
      <div id="to-err" class="banner banner-error mb-2" style="display:none;"></div>
      <button class="btn btn-primary" id="to-save">Send request</button>
      <button class="btn btn-ghost mt-2" id="to-cancel">Cancel</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('#to-cancel').addEventListener('click', close);
  backdrop.querySelector('#to-save').addEventListener('click', async () => {
    const err = backdrop.querySelector('#to-err'); err.style.display = 'none';
    try {
      await svc.requestTimeOff({
        kind: backdrop.querySelector('#to-kind').value,
        startDate: backdrop.querySelector('#to-start').value,
        endDate:   backdrop.querySelector('#to-end').value,
        note:      backdrop.querySelector('#to-note').value || null,
      });
      haptic('success');
      close();
      // refresh profile
      ctx.navigate('profile');
    } catch (e) {
      err.textContent = e.message || 'Could not send'; err.style.display = 'flex';
    }
  });
}
