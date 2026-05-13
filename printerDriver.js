// printerDriver.js — Direct-to-printer drivers + browser dialog fallback.
//
// Three modes:
//   'browser'      → standard window.print() with @page rules (default)
//   'brother_usb'  → WebUSB raster to Brother QL series (QL-820NWB, QL-1100, etc.)
//   'star_bt'      → WebBluetooth ESC/POS to Star TSP100 / mC-Print
//
// All drivers expose the same printLabel(node, settings) interface.
// On unsupported browsers or paired-device failures we transparently fall
// back to the browser dialog so prints never silently no-op.

import { effectiveDimensions } from './printerSettingsRepo.js';

// ─── Capability detection ────────────────────────────────────────────────────
export function capabilities() {
  return {
    webusb: typeof navigator !== 'undefined' && 'usb' in navigator,
    webbluetooth: typeof navigator !== 'undefined' && 'bluetooth' in navigator,
    print: typeof window !== 'undefined' && typeof window.print === 'function',
  };
}

// ─── Public entry point ──────────────────────────────────────────────────────
// node: the DOM element containing the rendered label content.
// settings: tenant_printer_settings row (or default).
// Returns { ok, mode, message } — never throws; failures degrade to dialog.
export async function printLabel(node, settings) {
  const cap = capabilities();
  const driver = (settings && settings.native_driver) || 'browser';

  // Driver routing with fallback
  try {
    if (driver === 'brother_usb' && cap.webusb) {
      await printBrotherUSB(node, settings);
      return { ok: true, mode: 'brother_usb', message: 'Sent to Brother QL via USB' };
    }
    if (driver === 'star_bt' && cap.webbluetooth) {
      await printStarBluetooth(node, settings);
      return { ok: true, mode: 'star_bt', message: 'Sent to Star printer via Bluetooth' };
    }
  } catch (err) {
    console.warn('Native driver failed, falling back to browser dialog:', err);
    // fallthrough to browser
  }

  // Default: browser print dialog with @page rules injected
  applyPrintCSS(settings);
  if (cap.print) {
    setTimeout(() => window.print(), 50);
    return { ok: true, mode: 'browser', message: 'Opened print dialog' };
  }
  return { ok: false, mode: 'none', message: 'No printing capability detected' };
}

// ─── Inject @page CSS at print time so the dialog respects label size ────────
// We replace any prior dynamic block with the current preset's dimensions.
const DYNAMIC_STYLE_ID = 'pl-dynamic-print-css';
export function applyPrintCSS(settings) {
  const dim = effectiveDimensions(settings);
  const w = dim.width_mm;
  const h = dim.height_mm;
  const fontPx = dim.fontPx;
  const margin = Number((settings && settings.margin_mm) || 0);

  const css = `
@media print {
  @page { size: ${w}mm ${h}mm; margin: ${margin}mm; }
  .prep-label-print {
    width: ${w}mm !important;
    height: ${h}mm !important;
  }
  .pl-print-inner {
    width: ${w}mm !important;
    height: ${h}mm !important;
  }
  .pl-print-name { font-size: ${fontPx}px !important; }
  .pl-print-row { font-size: ${Math.max(8, fontPx - 5)}px !important; }
  .pl-print-small { font-size: ${Math.max(7, fontPx - 6)}px !important; }
  .pl-print-allergen { font-size: ${Math.max(6, fontPx - 7)}px !important; }
}`;

  let style = document.getElementById(DYNAMIC_STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = DYNAMIC_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = css;
}

// ─── Brother QL via WebUSB ───────────────────────────────────────────────────
// Brother QL-820NWB vendor 0x04F9, common product IDs 0x209B (QL-820NWB),
// 0x209C (QL-1100), 0x209D (QL-1110NWB). We accept any 0x04F9 device on connect.
//
// We render the label DOM into a hidden 720px-wide canvas (Brother QL is
// 720 dots wide on standard 62mm tape), threshold to 1-bit, and emit Brother
// raster mode commands (ESC i a 01 = raster, ESC i z = print info).
//
// This is a *simplified* implementation that covers the common QL-820NWB
// case. Full Brother spec: https://download.brother.com/welcome/docp100278/cv_ql800_eng_raster_100.pdf

const BROTHER_VENDOR_ID = 0x04f9;

let _brotherDevice = null;

async function brotherConnect() {
  if (_brotherDevice && _brotherDevice.opened) return _brotherDevice;
  const device = await navigator.usb.requestDevice({
    filters: [{ vendorId: BROTHER_VENDOR_ID }],
  });
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  await device.claimInterface(0);
  _brotherDevice = device;
  return device;
}

async function brotherTransfer(bytes) {
  if (!_brotherDevice) throw new Error('Brother device not connected');
  // Endpoint 0x02 is the default OUT endpoint for Brother QL series
  await _brotherDevice.transferOut(2, bytes);
}

async function printBrotherUSB(node, settings) {
  await brotherConnect();

  // Render DOM → canvas using html2canvas-style technique: use SVG foreignObject
  // No external libs — we serialize the node into an inline SVG image.
  const dim = effectiveDimensions(settings);
  const widthMm = dim.width_mm;
  const heightMm = dim.height_mm;

  // Brother QL prints at 300 dpi; convert mm → dots (1in = 25.4mm = 300 dots)
  const dpi = 300;
  const dotsPerMm = dpi / 25.4;
  const widthDots = Math.round(widthMm * dotsPerMm);
  const heightDots = Math.round(heightMm * dotsPerMm);

  const canvas = await domToMonochromeCanvas(node, widthDots, heightDots);
  const raster = canvasToBrotherRaster(canvas);

  // Initialize: 200 nulls + ESC @ (reset)
  const init = new Uint8Array(200);
  await brotherTransfer(init);
  await brotherTransfer(new Uint8Array([0x1b, 0x40])); // ESC @
  // Switch to raster mode
  await brotherTransfer(new Uint8Array([0x1b, 0x69, 0x61, 0x01])); // ESC i a 01
  // Send the raster bitmap
  await brotherTransfer(raster);
  // Print with feed: ESC i Z 02 ... or just 0x1A (Form Feed / Print)
  await brotherTransfer(new Uint8Array([0x1a])); // 0x1A = Print with feed
}

// Helper: render a DOM node to a 1-bit canvas of (widthDots × heightDots).
async function domToMonochromeCanvas(node, widthDots, heightDots) {
  // Clone node, force it to the exact print dimensions.
  const clone = node.cloneNode(true);
  clone.style.cssText = `width:${widthDots}px;height:${heightDots}px;background:#fff;color:#000;`;

  // Serialize to an SVG foreignObject so we can draw via Image()
  const xml = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthDots}" height="${heightDots}">
    <foreignObject width="100%" height="100%">
      <div xmlns="http://www.w3.org/1999/xhtml">${xml}</div>
    </foreignObject>
  </svg>`;
  const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));

  await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = widthDots;
      c.height = heightDots;
      const cx = c.getContext('2d');
      cx.fillStyle = '#fff';
      cx.fillRect(0, 0, widthDots, heightDots);
      cx.drawImage(img, 0, 0, widthDots, heightDots);
      // Threshold to 1-bit
      const id = cx.getImageData(0, 0, widthDots, heightDots);
      for (let i = 0; i < id.data.length; i += 4) {
        const r = id.data[i], g = id.data[i + 1], b = id.data[i + 2];
        const lum = (r * 299 + g * 587 + b * 114) / 1000;
        const v = lum < 160 ? 0 : 255;
        id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
        id.data[i + 3] = 255;
      }
      cx.putImageData(id, 0, 0);
      // Store the resulting canvas reference
      printBrotherUSB._lastCanvas = c;
      resolve(c);
    };
    img.onerror = reject;
    img.src = url;
  });
  return printBrotherUSB._lastCanvas;
}

// Convert a monochrome canvas to Brother raster lines.
// Each raster line is: g 00 5A (90 bytes of pixel data, MSB-first)
function canvasToBrotherRaster(canvas) {
  const cx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const data = cx.getImageData(0, 0, w, h).data;
  const lineBytes = 90; // 720 dots / 8
  const out = new Uint8Array(h * 93);
  let p = 0;
  for (let y = 0; y < h; y++) {
    out[p++] = 0x67; // 'g'
    out[p++] = 0x00;
    out[p++] = lineBytes;
    for (let bx = 0; bx < lineBytes; bx++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = bx * 8 + bit;
        if (x >= w) continue;
        const idx = (y * w + x) * 4;
        // Black pixel = bit set
        if (data[idx] < 128) byte |= 1 << (7 - bit);
      }
      out[p++] = byte;
    }
  }
  return out;
}

// ─── Star printer via WebBluetooth (ESC/POS subset) ──────────────────────────
// Star TSP100LAN/mC-Print common GATT service UUID: 49535343-fe7d-4ae5-8fa9-9fafd205e455
// (Generic SPP-over-BLE for printers; falls back to discovery)
const STAR_SERVICE_UUID = 0x18f0;

let _starCharacteristic = null;

async function starConnect() {
  if (_starCharacteristic && _starCharacteristic.service.device.gatt.connected) {
    return _starCharacteristic;
  }
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: 'Star' }, { namePrefix: 'TSP' }, { namePrefix: 'mC-' }],
    optionalServices: [STAR_SERVICE_UUID, 0x18f0, 0xff00],
  });
  const server = await device.gatt.connect();
  const services = await server.getPrimaryServices();
  for (const svc of services) {
    const chars = await svc.getCharacteristics();
    for (const ch of chars) {
      if (ch.properties.write || ch.properties.writeWithoutResponse) {
        _starCharacteristic = ch;
        return ch;
      }
    }
  }
  throw new Error('No writable characteristic on Star printer');
}

async function printStarBluetooth(node, settings) {
  const ch = await starConnect();

  // Build ESC/POS payload — simple text path since Star receipt printers are not
  // a great fit for image labels. We pull text content from the label DOM.
  const text = extractLabelText(node);

  const ESC = 0x1b, GS = 0x1d, LF = 0x0a;
  const enc = new TextEncoder();
  const buf = [];

  // Initialize
  buf.push(ESC, 0x40);
  // Center align
  buf.push(ESC, 0x61, 0x01);
  // Double height + width for the item name (first line)
  const lines = text.split('\n');
  if (lines.length) {
    buf.push(GS, 0x21, 0x11);
    buf.push(...enc.encode(lines[0]));
    buf.push(LF);
    buf.push(GS, 0x21, 0x00);
  }
  // Remaining lines at normal size, left-aligned
  buf.push(ESC, 0x61, 0x00);
  for (let i = 1; i < lines.length; i++) {
    buf.push(...enc.encode(lines[i]));
    buf.push(LF);
  }
  // Feed + cut
  for (let i = 0; i < 4; i++) buf.push(LF);
  buf.push(GS, 0x56, 0x00); // GS V 0 = full cut

  const payload = new Uint8Array(buf);
  // BLE write in chunks of 180 bytes
  const chunkSize = 180;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const slice = payload.slice(i, i + chunkSize);
    if (ch.properties.writeWithoutResponse) {
      await ch.writeValueWithoutResponse(slice);
    } else {
      await ch.writeValue(slice);
    }
  }
}

function extractLabelText(node) {
  // Pull the visible text out of the label DOM, with line breaks.
  const name = node.querySelector?.('.pl-print-name')?.textContent?.trim() || '';
  const rows = Array.from(node.querySelectorAll?.('.pl-print-row') || [])
    .map((r) => r.textContent.replace(/\s+/g, ' ').trim());
  const allergens = Array.from(node.querySelectorAll?.('.pl-print-allergen') || [])
    .map((a) => a.textContent.trim())
    .join('  ');
  const parts = [name, ...rows];
  if (allergens) parts.push(`Allergens: ${allergens}`);
  return parts.filter(Boolean).join('\n');
}

// ─── Test print helper ───────────────────────────────────────────────────────
// Used by Printer Setup page to confirm everything wires together.
export async function testPrint(settings) {
  // Build a synthetic label node
  const div = document.createElement('div');
  div.className = 'prep-label-print pl-test-print';
  div.innerHTML = `
    <div class="pl-print-inner">
      <div class="pl-print-stripe" style="background:#43a047"></div>
      <div class="pl-print-content">
        <div class="pl-print-name">TEST PRINT</div>
        <div class="pl-print-row"><span class="pl-print-lbl">Date:</span> ${new Date().toLocaleString()}</div>
        <div class="pl-print-row"><span class="pl-print-lbl">Preset:</span> ${settings.label_preset || 'default'}</div>
        <div class="pl-print-row pl-print-small">If you can read this, the printer is wired up.</div>
      </div>
    </div>`;

  // Attach to a dedicated print target (replacing any prior contents)
  let target = document.getElementById('pl-print-target');
  if (!target) {
    target = document.createElement('div');
    target.id = 'pl-print-target';
    document.body.appendChild(target);
  }
  target.innerHTML = '';
  target.appendChild(div);

  return printLabel(div, settings);
}
