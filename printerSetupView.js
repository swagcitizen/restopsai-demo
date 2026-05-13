// printerSetupView.js — Settings page for label printer + kitchen tablet kiosk.
//
// Two cards:
//   1) Label printer:  preset picker, orientation, native driver, test print.
//   2) Kitchen tablet: kiosk mode toggle, manager PIN, grace + nudge windows.
//
// Exports: initPrinterSetup({ tenantId, userId })
//          renderPrinterSetup()  (idempotent — safe to call on nav)

import {
  LABEL_PRESETS,
  NATIVE_DRIVERS,
  defaultPrinterSettings,
  defaultKioskSettings,
  effectiveDimensions,
  getPrinterSettings,
  savePrinterSettings,
  getKioskSettings,
  saveKioskSettings,
} from './printerSettingsRepo.js';
import { testPrint, capabilities } from './printerDriver.js';

let _ctx = null;
let _printer = null;
let _kiosk = null;
let _saving = false;

export async function initPrinterSetup({ tenantId, userId }) {
  _ctx = { tenantId, userId };
  await renderPrinterSetup();
}

export async function renderPrinterSetup() {
  const mount = document.getElementById('printer-setup-root');
  if (!mount) return;

  mount.innerHTML = `<div class="printer-loading muted">Loading printer & tablet settings…</div>`;
  try {
    [_printer, _kiosk] = await Promise.all([getPrinterSettings(), getKioskSettings()]);
  } catch (err) {
    console.error('Could not load printer/kiosk settings:', err);
    _printer = defaultPrinterSettings(_ctx?.tenantId);
    _kiosk = defaultKioskSettings(_ctx?.tenantId);
  }
  mount.innerHTML = template();
  wireEvents(mount);
}

function template() {
  const cap = capabilities();
  const dim = effectiveDimensions(_printer);

  return `
  <div class="printer-setup-grid">

    <!-- LABEL PRINTER -->
    <section class="card printer-card">
      <div class="card-head"><h3>Label printer</h3><span class="muted small">Used by Prep Labels &amp; receipt reprints.</span></div>
      <div class="card-body">

        <div class="form-row">
          <label for="ps-preset">Label size</label>
          <select id="ps-preset" class="input">
            ${Object.entries(LABEL_PRESETS).map(([k, v]) =>
              `<option value="${k}" ${_printer.label_preset === k ? 'selected' : ''}>${esc(v.label)}</option>`
            ).join('')}
          </select>
          <div class="form-hint muted small" id="ps-preset-note">${esc(LABEL_PRESETS[_printer.label_preset]?.note || '')}</div>
        </div>

        <div class="form-row form-row-2" id="ps-custom-dims" ${_printer.label_preset === 'custom' ? '' : 'hidden'}>
          <div>
            <label for="ps-width">Width (mm)</label>
            <input id="ps-width" type="number" min="10" max="300" step="0.1" class="input" value="${_printer.paper_width_mm || 89}" />
          </div>
          <div>
            <label for="ps-height">Height (mm)</label>
            <input id="ps-height" type="number" min="10" max="300" step="0.1" class="input" value="${_printer.paper_height_mm || 28}" />
          </div>
        </div>

        <div class="form-row form-row-2">
          <div>
            <label for="ps-orientation">Orientation</label>
            <select id="ps-orientation" class="input">
              <option value="landscape" ${_printer.orientation === 'landscape' ? 'selected' : ''}>Landscape (wider than tall)</option>
              <option value="portrait" ${_printer.orientation === 'portrait' ? 'selected' : ''}>Portrait (taller than wide)</option>
            </select>
          </div>
          <div>
            <label for="ps-margin">Margin (mm)</label>
            <input id="ps-margin" type="number" min="0" max="20" step="0.5" class="input" value="${_printer.margin_mm || 0}" />
          </div>
        </div>

        <div class="form-row">
          <label for="ps-printer-name">Printer name (display only)</label>
          <input id="ps-printer-name" type="text" class="input" placeholder="e.g. Kitchen Brother QL-820NWB" value="${esc(_printer.printer_name || '')}" />
          <div class="form-hint muted small">The OS print dialog selects the actual printer — this label is for your reference.</div>
        </div>

        <div class="form-row">
          <label for="ps-driver">Driver</label>
          <select id="ps-driver" class="input">
            ${Object.entries(NATIVE_DRIVERS).map(([k, v]) => {
              const disabled = (k === 'brother_usb' && !cap.webusb) || (k === 'star_bt' && !cap.webbluetooth);
              return `<option value="${k}" ${_printer.native_driver === k ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${esc(v.label)}${disabled ? ' — not supported on this browser' : ''}</option>`;
            }).join('')}
          </select>
          <div class="form-hint muted small" id="ps-driver-note">${esc(NATIVE_DRIVERS[_printer.native_driver]?.desc || '')}</div>
        </div>

        <fieldset class="form-row form-toggles">
          <legend class="muted small">Print options</legend>
          <label class="check"><input id="ps-day-dot" type="checkbox" ${_printer.print_day_dot ? 'checked' : ''} /> Print day-dot color stripe</label>
          <label class="check"><input id="ps-allergens" type="checkbox" ${_printer.print_allergens ? 'checked' : ''} /> Print allergen badges</label>
          <label class="check"><input id="ps-auto-dialog" type="checkbox" ${_printer.auto_open_dialog ? 'checked' : ''} /> Auto-open print dialog after saving a label</label>
        </fieldset>

        <div class="printer-summary muted small">
          Resolved size: <strong>${dim.width_mm}mm × ${dim.height_mm}mm</strong> (${(dim.width_mm / 25.4).toFixed(2)}″ × ${(dim.height_mm / 25.4).toFixed(2)}″)
        </div>

        <div class="form-actions">
          <button class="btn" id="ps-test-print">Test print</button>
          <button class="btn btn-primary" id="ps-save-printer" ${_saving ? 'disabled' : ''}>Save printer settings</button>
        </div>
        <div class="form-status muted small" id="ps-status" aria-live="polite"></div>
      </div>
    </section>

    <!-- KITCHEN TABLET / KIOSK -->
    <section class="card printer-card">
      <div class="card-head"><h3>Kitchen tablet &amp; clock-in</h3><span class="muted small">Polish the employee clock-in experience.</span></div>
      <div class="card-body">

        <fieldset class="form-row form-toggles">
          <legend class="muted small">Kiosk lockdown</legend>
          <label class="check"><input id="ks-enabled" type="checkbox" ${_kiosk.enabled ? 'checked' : ''} /> Lock the kitchen tablet to the Time Clock screen</label>
          <div class="form-hint muted small">When on, opening <code>/app.html?kiosk=1</code> on the tablet hides the sidebar and locks the view to the clock. Exit requires the manager PIN below.</div>
        </fieldset>

        <div class="form-row">
          <label for="ks-pin">Manager PIN (to exit kiosk)</label>
          <input id="ks-pin" type="text" inputmode="numeric" pattern="\\d{4}" maxlength="4" class="input pin-input" value="${esc(_kiosk.manager_pin || '9999')}" />
          <div class="form-hint muted small">A 4-digit code. Used to exit kiosk mode and to override clock-in before scheduled time.</div>
        </div>

        <fieldset class="form-row form-toggles">
          <legend class="muted small">Schedule reminders</legend>
          <label class="check"><input id="ks-show-in" type="checkbox" ${_kiosk.show_clockin_reminder ? 'checked' : ''} /> Show 'don't forget to clock in' for upcoming shifts</label>
          <label class="check"><input id="ks-show-out" type="checkbox" ${_kiosk.show_clockout_reminder ? 'checked' : ''} /> Show 'time to clock out' when shift end has passed</label>
        </fieldset>

        <div class="form-row form-row-2">
          <div>
            <label for="ks-grace">Clock-in grace window (min)</label>
            <input id="ks-grace" type="number" min="0" max="120" step="1" class="input" value="${_kiosk.clock_in_grace_minutes ?? 15}" />
            <div class="form-hint muted small">Block clock-in earlier than this before scheduled start (manager can override).</div>
          </div>
          <div>
            <label for="ks-nudge">Clock-out nudge (min)</label>
            <input id="ks-nudge" type="number" min="0" max="240" step="1" class="input" value="${_kiosk.clock_out_nudge_minutes ?? 15}" />
            <div class="form-hint muted small">Show a clock-out reminder this many minutes after scheduled end.</div>
          </div>
        </div>

        <div class="form-actions">
          <a class="btn ghost-btn" href="/app.html?kiosk=1" target="_blank" rel="noopener">Open tablet view in new tab</a>
          <button class="btn btn-primary" id="ks-save">Save tablet settings</button>
        </div>
        <div class="form-status muted small" id="ks-status" aria-live="polite"></div>
      </div>
    </section>
  </div>
  `;
}

function wireEvents(root) {
  // Preset → swap note + show/hide custom dims
  const presetSel = root.querySelector('#ps-preset');
  presetSel.addEventListener('change', () => {
    _printer.label_preset = presetSel.value;
    const preset = LABEL_PRESETS[presetSel.value];
    root.querySelector('#ps-preset-note').textContent = preset?.note || '';
    root.querySelector('#ps-custom-dims').hidden = presetSel.value !== 'custom';
    refreshSummary(root);
  });

  // Custom dims
  ['ps-width', 'ps-height'].forEach((id) => {
    root.querySelector(`#${id}`).addEventListener('input', (e) => {
      if (id === 'ps-width') _printer.paper_width_mm = Number(e.target.value) || 0;
      else _printer.paper_height_mm = Number(e.target.value) || 0;
      refreshSummary(root);
    });
  });

  // Orientation
  const orient = root.querySelector('#ps-orientation');
  orient.addEventListener('change', () => { _printer.orientation = orient.value; refreshSummary(root); });

  // Margin
  const margin = root.querySelector('#ps-margin');
  margin.addEventListener('input', () => { _printer.margin_mm = Number(margin.value) || 0; });

  // Printer name
  const pname = root.querySelector('#ps-printer-name');
  pname.addEventListener('input', () => { _printer.printer_name = pname.value; });

  // Driver
  const drv = root.querySelector('#ps-driver');
  drv.addEventListener('change', () => {
    _printer.native_driver = drv.value;
    root.querySelector('#ps-driver-note').textContent = NATIVE_DRIVERS[drv.value]?.desc || '';
  });

  // Toggles
  root.querySelector('#ps-day-dot').addEventListener('change', (e) => { _printer.print_day_dot = e.target.checked; });
  root.querySelector('#ps-allergens').addEventListener('change', (e) => { _printer.print_allergens = e.target.checked; });
  root.querySelector('#ps-auto-dialog').addEventListener('change', (e) => { _printer.auto_open_dialog = e.target.checked; });

  // Test print
  root.querySelector('#ps-test-print').addEventListener('click', async (e) => {
    e.preventDefault();
    const status = root.querySelector('#ps-status');
    status.textContent = 'Sending test print…';
    try {
      const r = await testPrint(_printer);
      status.textContent = r.ok ? `✓ ${r.message}` : `✗ ${r.message}`;
    } catch (err) {
      status.textContent = `Test print failed: ${err.message || err}`;
    }
  });

  // Save printer settings
  root.querySelector('#ps-save-printer').addEventListener('click', async (e) => {
    e.preventDefault();
    const status = root.querySelector('#ps-status');
    const btn = e.currentTarget;
    btn.disabled = true; status.textContent = 'Saving…';
    try {
      const saved = await savePrinterSettings(_printer);
      _printer = saved;
      status.textContent = '✓ Saved';
      setTimeout(() => { status.textContent = ''; }, 2500);
    } catch (err) {
      status.textContent = `Save failed: ${err.message || err}`;
    } finally {
      btn.disabled = false;
    }
  });

  // Kiosk toggles & inputs
  const bindKiosk = (id, prop, parseFn) => {
    const el = root.querySelector(`#${id}`);
    if (!el) return;
    el.addEventListener('input', () => {
      _kiosk[prop] = parseFn ? parseFn(el) : el.value;
    });
    if (el.type === 'checkbox') {
      el.addEventListener('change', () => { _kiosk[prop] = el.checked; });
    }
  };
  bindKiosk('ks-enabled', 'enabled');
  bindKiosk('ks-show-in', 'show_clockin_reminder');
  bindKiosk('ks-show-out', 'show_clockout_reminder');
  bindKiosk('ks-pin', 'manager_pin', (el) => el.value.replace(/\D/g, '').slice(0, 4));
  bindKiosk('ks-grace', 'clock_in_grace_minutes', (el) => Math.max(0, Number(el.value) || 0));
  bindKiosk('ks-nudge', 'clock_out_nudge_minutes', (el) => Math.max(0, Number(el.value) || 0));

  // Save kiosk
  root.querySelector('#ks-save').addEventListener('click', async (e) => {
    e.preventDefault();
    const status = root.querySelector('#ks-status');
    const btn = e.currentTarget;
    // Sanitize PIN
    const pinEl = root.querySelector('#ks-pin');
    _kiosk.manager_pin = (pinEl.value || '').replace(/\D/g, '').slice(0, 4) || '9999';
    pinEl.value = _kiosk.manager_pin;
    btn.disabled = true; status.textContent = 'Saving…';
    try {
      const saved = await saveKioskSettings(_kiosk);
      _kiosk = saved;
      status.textContent = '✓ Saved';
      setTimeout(() => { status.textContent = ''; }, 2500);
    } catch (err) {
      status.textContent = `Save failed: ${err.message || err}`;
    } finally {
      btn.disabled = false;
    }
  });
}

function refreshSummary(root) {
  const dim = effectiveDimensions(_printer);
  const sum = root.querySelector('.printer-summary');
  if (sum) {
    sum.innerHTML = `Resolved size: <strong>${dim.width_mm}mm × ${dim.height_mm}mm</strong> (${(dim.width_mm / 25.4).toFixed(2)}″ × ${(dim.height_mm / 25.4).toFixed(2)}″)`;
  }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
