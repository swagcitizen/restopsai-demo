// printerSettingsRepo.js — Printer & kiosk preferences data layer.
//
// Two tenant-scoped tables: tenant_printer_settings, tenant_kiosk_settings.
// Both are PK'd on tenant_id (one row per tenant). RLS scopes by membership.

import { supabase } from './supabaseClient.js';

function ctx() {
  const c = window.__RESTOPS_CTX__;
  if (!c) throw new Error('Tenant context not loaded');
  return c;
}

// ─── Label presets (size in mm, plus suggested font size for item name) ──────
// All presets default to landscape orientation (wider than tall) — the standard
// for thermal label printers. portrait toggles width/height.
export const LABEL_PRESETS = {
  dymo_30252: {
    label: 'DYMO 30252 — 1-1/8" × 3-1/2" (address)',
    width_mm: 89.0,
    height_mm: 28.0,
    fontPx: 13,
    note: 'The most common DYMO LabelWriter address label. Default.',
  },
  dymo_30336: {
    label: 'DYMO 30336 — 1" × 2-1/8" (multipurpose)',
    width_mm: 54.0,
    height_mm: 25.0,
    fontPx: 11,
    note: 'Compact label for small containers and lids.',
  },
  brother_dk1201: {
    label: 'Brother DK-1201 — 29mm × 90mm (standard address)',
    width_mm: 90.0,
    height_mm: 29.0,
    fontPx: 13,
    note: 'Brother QL series standard die-cut. Works with all QL models.',
  },
  zebra_2x1: {
    label: 'Zebra 2" × 1" — direct thermal',
    width_mm: 50.8,
    height_mm: 25.4,
    fontPx: 11,
    note: 'Smaller thermal label for prep containers.',
  },
  avery_5160: {
    label: 'Avery 5160 — 2-5/8" × 1" (laser sheet)',
    width_mm: 66.7,
    height_mm: 25.4,
    fontPx: 11,
    note: 'For laser/inkjet printers using sheet labels (30 per sheet).',
  },
  shipping_4x6: {
    label: '4" × 6" shipping (large format)',
    width_mm: 101.6,
    height_mm: 152.4,
    fontPx: 18,
    note: 'Large format for shipping or full prep documentation.',
  },
  custom: {
    label: 'Custom size…',
    width_mm: 89.0,
    height_mm: 28.0,
    fontPx: 13,
    note: 'Set your own paper width and height.',
  },
};

export const NATIVE_DRIVERS = {
  browser: {
    label: 'Browser print dialog (works everywhere)',
    desc: 'Standard print dialog — pick any installed printer.',
  },
  brother_usb: {
    label: 'Brother QL via USB (WebUSB)',
    desc: 'Direct USB raster to Brother QL-820NWB / QL-1100. Chrome/Edge on desktop only. Auto-cuts after each label.',
  },
  star_bt: {
    label: 'Star TSP100/mC via Bluetooth (WebBluetooth)',
    desc: 'Direct ESC/POS over Bluetooth to Star TSP100/mC-Print series. Chrome/Edge desktop, Chrome on Android.',
  },
};

// ─── Defaults ─────────────────────────────────────────────────────────────────
export function defaultPrinterSettings(tenantId) {
  return {
    tenant_id: tenantId,
    label_preset: 'dymo_30252',
    paper_width_mm: 89.0,
    paper_height_mm: 28.0,
    orientation: 'landscape',
    printer_name: '',
    native_driver: 'browser',
    margin_mm: 0.0,
    print_day_dot: true,
    print_allergens: true,
    auto_open_dialog: true,
  };
}

export function defaultKioskSettings(tenantId) {
  return {
    tenant_id: tenantId,
    enabled: false,
    manager_pin: '9999',
    clock_in_grace_minutes: 15,
    clock_out_nudge_minutes: 15,
    show_clockout_reminder: true,
    show_clockin_reminder: true,
  };
}

// ─── Effective dimensions (resolves preset → mm) ─────────────────────────────
export function effectiveDimensions(settings) {
  if (!settings) settings = defaultPrinterSettings('');
  const preset = LABEL_PRESETS[settings.label_preset] || LABEL_PRESETS.dymo_30252;
  let w = preset.width_mm;
  let h = preset.height_mm;
  if (settings.label_preset === 'custom') {
    w = Number(settings.paper_width_mm) || 89.0;
    h = Number(settings.paper_height_mm) || 28.0;
  }
  if (settings.orientation === 'portrait') {
    const tmp = w; w = h; h = tmp;
  }
  return { width_mm: w, height_mm: h, fontPx: preset.fontPx };
}

// ─── Printer settings CRUD ───────────────────────────────────────────────────
export async function getPrinterSettings() {
  const { tenantId } = ctx();
  const { data, error } = await supabase
    .from('tenant_printer_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) {
    console.error('getPrinterSettings:', error);
    return defaultPrinterSettings(tenantId);
  }
  return data || defaultPrinterSettings(tenantId);
}

export async function savePrinterSettings(patch) {
  const { tenantId, user } = ctx();
  const row = {
    ...defaultPrinterSettings(tenantId),
    ...patch,
    tenant_id: tenantId,
    updated_at: new Date().toISOString(),
    updated_by: user?.id || null,
  };
  const { data, error } = await supabase
    .from('tenant_printer_settings')
    .upsert(row, { onConflict: 'tenant_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Kiosk settings CRUD ─────────────────────────────────────────────────────
export async function getKioskSettings() {
  const { tenantId } = ctx();
  const { data, error } = await supabase
    .from('tenant_kiosk_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) {
    console.error('getKioskSettings:', error);
    return defaultKioskSettings(tenantId);
  }
  return data || defaultKioskSettings(tenantId);
}

export async function saveKioskSettings(patch) {
  const { tenantId, user } = ctx();
  const row = {
    ...defaultKioskSettings(tenantId),
    ...patch,
    tenant_id: tenantId,
    updated_at: new Date().toISOString(),
    updated_by: user?.id || null,
  };
  const { data, error } = await supabase
    .from('tenant_kiosk_settings')
    .upsert(row, { onConflict: 'tenant_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Manager PIN verification (for kiosk exit + clock-in grace override) ─────
export async function verifyManagerPin(pin) {
  if (!/^\d{4}$/.test(String(pin || ''))) return false;
  try {
    const k = await getKioskSettings();
    return String(k.manager_pin || '') === String(pin);
  } catch (err) {
    console.error('verifyManagerPin:', err);
    return false;
  }
}

// ─── Today's schedule (for clock-in reminders) ───────────────────────────────
// Returns shifts scheduled for *today* (server-local date) with staff info.
export async function fetchTodaysSchedule() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('schedule_shifts')
    .select('id, staff_id, shift_date, start_time, end_time, hours, notes, staff:staff_id(id, name, role)')
    .eq('shift_date', today)
    .order('start_time', { ascending: true, nullsFirst: false });
  if (error) {
    console.error('fetchTodaysSchedule:', error);
    return [];
  }
  return data || [];
}

// ─── Active (currently open) shifts across tenant — for clock-out nudges ────
export async function fetchOpenShifts() {
  const { data, error } = await supabase
    .from('time_entries')
    .select('id, staff_id, clock_in_at, staff:staff_id(id, name)')
    .is('clock_out_at', null);
  if (error) {
    console.error('fetchOpenShifts:', error);
    return [];
  }
  return data || [];
}
