// Clock screen — selfie capture + GPS + big "Clock me in/out" button.

import * as svc from '../services/staffService.js';
import { takePhoto, getCurrentPosition, haptic } from '../services/nativeBridge.js';
import { renderShell, escapeHtml } from '../components.js';

export const route = 'clock';
export const tabId = 'today';

export async function render(host, ctx) {
  renderShell(host, { title: 'Clock in', sub: ctx.staff?.name || '', activeTab: 'today', ctx });
  const main = host.querySelector('#screen-main');

  const open = await svc.getOpenShift().catch(() => null);
  const isClockingOut = !!open;

  let photoBlob = null;
  let photoUrl  = null;
  let pos = null;
  let posError = null;

  function ui() {
    main.innerHTML = `
      <div class="clock-hero">
        <div class="clock-photo">
          ${photoUrl
            ? `<img src="${photoUrl}" alt="selfie" />`
            : `<div class="clock-photo-hint">${isClockingOut ? 'Selfie not required to clock out' : 'Tap below to take a quick selfie'}</div>`}
        </div>
        ${!isClockingOut ? `<button class="btn" id="btn-photo">${photoBlob ? 'Retake selfie' : 'Take selfie'}</button>` : ''}
      </div>

      <div class="card">
        <div class="between">
          <div>
            <div class="eyebrow">Location</div>
            <div class="mt-1">
              ${posError ? `<span class="text-error">${escapeHtml(posError)}</span>`
                : pos ? `<span class="text-success">GPS locked</span> <span class="text-muted">±${Math.round(pos.accuracy_m)}m</span>`
                : `<span class="text-muted">Tap to get location…</span>`}
            </div>
          </div>
          <button class="btn" style="width:auto; min-height:36px; padding:6px 12px;" id="btn-loc">${pos ? 'Refresh' : 'Get'}</button>
        </div>
      </div>

      ${isClockingOut ? `
        <div class="field mt-3">
          <label class="field-label" for="cnote">Optional note</label>
          <textarea class="input" id="cnote" placeholder="Anything to flag for the next shift?"></textarea>
        </div>
      ` : ''}

      <button class="btn ${isClockingOut ? 'btn-danger' : 'btn-primary'} mt-3" id="btn-clock"
              ${!isClockingOut && !pos ? 'disabled' : ''}>
        ${isClockingOut ? 'Clock me out' : 'Clock me in'}
      </button>

      <button class="btn btn-ghost mt-2" id="btn-cancel">Cancel</button>
    `;

    main.querySelector('#btn-photo')?.addEventListener('click', async () => {
      try {
        const p = await takePhoto();
        photoBlob = p.blob;
        if (photoUrl) URL.revokeObjectURL(photoUrl);
        photoUrl = URL.createObjectURL(p.blob);
        ui();
      } catch (e) { /* user cancelled */ }
    });

    main.querySelector('#btn-loc').addEventListener('click', async () => {
      posError = null;
      try {
        pos = await getCurrentPosition();
      } catch (e) {
        posError = e?.message || 'Could not get location';
      }
      ui();
    });

    main.querySelector('#btn-clock').addEventListener('click', async () => {
      const btn = main.querySelector('#btn-clock');
      btn.disabled = true;
      btn.textContent = isClockingOut ? 'Clocking out…' : 'Clocking in…';
      try {
        if (isClockingOut) {
          const note = main.querySelector('#cnote')?.value || null;
          await svc.clockOut(note);
        } else {
          await svc.clockIn({
            lat: pos?.lat, lng: pos?.lng, accuracy_m: pos?.accuracy_m,
            photoBlob, scheduledEndAt: null,
          });
        }
        haptic('success');
        ctx.navigate('today');
      } catch (e) {
        haptic('error');
        alert(e?.message || 'Clock event failed');
        btn.disabled = false;
        btn.textContent = isClockingOut ? 'Clock me out' : 'Clock me in';
      }
    });

    main.querySelector('#btn-cancel').addEventListener('click', () => ctx.navigate('today'));
  }

  // Kick off geolocation eagerly on mount (only for clock-in)
  ui();
  if (!isClockingOut) {
    try { pos = await getCurrentPosition(); }
    catch (e) { posError = e?.message || 'Could not get location'; }
    ui();
  }
}
