// staffService.js — high-level helpers for the employee PWA.
// Wraps RPCs + edge functions + offline queueing.

import { supabase, SUPABASE_URL } from './supabaseClient.js';
import { getDeviceId, isOnline } from './nativeBridge.js';

const CLOCK_QUEUE_KEY = 'stationly_clock_queue';
const LAST_EMAIL_KEY  = 'stationly_last_email';

// ----------------------------------------------------------------------------
// AUTH
// ----------------------------------------------------------------------------
export async function loginWithPassword(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  localStorage.setItem(LAST_EMAIL_KEY, data.user.email);
  return data;
}

export function getLastEmail() {
  return localStorage.getItem(LAST_EMAIL_KEY) || '';
}

export async function loginWithPin(email, pin) {
  email = email.trim().toLowerCase();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/pin-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, pin }),
  });
  if (!res.ok) {
    let body = {};
    try { body = await res.json(); } catch {}
    const err = new Error(body.error || `pin login failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  const { otp } = await res.json();
  // Use the OTP to actually sign in
  const { data, error } = await supabase.auth.verifyOtp({
    email, token: otp, type: 'email',
  });
  if (error) throw error;
  localStorage.setItem(LAST_EMAIL_KEY, email);
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

// ----------------------------------------------------------------------------
// STAFF PROFILE
// ----------------------------------------------------------------------------
export async function getMyStaffRow() {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) return null;
  const { data } = await supabase
    .from('staff')
    .select('id, tenant_id, name, role, hourly_rate, email, phone')
    .eq('user_id', u.user.id)
    .maybeSingle();
  return data || null;
}

export async function setMyPin(pin) {
  // Server-side bcrypt via pgcrypto. The plaintext PIN is sent over TLS to
  // the set_my_pin RPC which hashes with crypt(pin, gen_salt('bf', 10)) and
  // upserts into employee_pins. No client-side crypto, no bcryptjs.
  if (!/^[0-9]{4,8}$/.test(String(pin || ''))) {
    throw new Error('PIN must be 4-8 digits');
  }
  const { data, error } = await supabase.rpc('set_my_pin', { _pin: String(pin) });
  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('not_enrolled_as_staff')) throw new Error('Not enrolled as staff');
    if (msg.includes('invalid_pin_format')) throw new Error('PIN must be 4-8 digits');
    throw error;
  }
  return data === true;
}

// ----------------------------------------------------------------------------
// SHIFTS / CLOCK
// ----------------------------------------------------------------------------
export async function getOpenShift() {
  const { data } = await supabase.from('v_my_open_shift').select('*').maybeSingle();
  return data || null;
}

export async function getTodayShifts() {
  // Existing schedule_publishes stores published shifts as JSONB snapshots.
  // For Phase 4 we read the open time_entry (already started) + return that.
  // Future: query shifts table directly if your repo has one.
  return getOpenShift();
}

export async function getWeeklyHours() {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) return { worked: 0, scheduled: 0 };

  const { data: staff } = await supabase.from('staff').select('id').eq('user_id', u.user.id).maybeSingle();
  if (!staff) return { worked: 0, scheduled: 0 };

  // Monday-start week
  const now = new Date();
  const monday = new Date(now);
  const day = monday.getDay() || 7;
  monday.setDate(monday.getDate() - day + 1);
  monday.setHours(0, 0, 0, 0);

  const { data: entries } = await supabase
    .from('time_entries')
    .select('clock_in_at, clock_out_at')
    .eq('staff_id', staff.id)
    .gte('clock_in_at', monday.toISOString());

  let worked = 0;
  for (const e of entries || []) {
    const start = new Date(e.clock_in_at).getTime();
    const end = e.clock_out_at ? new Date(e.clock_out_at).getTime() : Date.now();
    worked += (end - start) / 3600000;
  }
  return { worked: Math.round(worked * 10) / 10, scheduled: 0 };
}

export async function clockIn({ lat, lng, accuracy_m, photoBlob, scheduledEndAt }) {
  if (!isOnline()) {
    enqueueClock({ kind: 'in', lat, lng, accuracy_m, scheduled_end_at: scheduledEndAt });
    return { queued: true };
  }

  const staff = await getMyStaffRow();
  if (!staff) throw new Error('Not enrolled as staff');

  // Upload selfie first if provided
  let photoPath = null;
  if (photoBlob) {
    const ts = Date.now();
    photoPath = `${staff.tenant_id}/${staff.id}/${ts}.jpg`;
    const { error: upErr } = await supabase.storage
      .from('clock-selfies')
      .upload(photoPath, photoBlob, { contentType: photoBlob.type || 'image/jpeg', upsert: false });
    if (upErr) console.warn('selfie upload failed:', upErr.message);
  }

  const { data, error } = await supabase.rpc('staff_clock_in', {
    p_lat: lat,
    p_lng: lng,
    p_accuracy_m: accuracy_m,
    p_photo_path: photoPath,
    p_device_id: getDeviceId(),
    p_scheduled_end_at: scheduledEndAt || null,
  });
  if (error) throw error;
  return data;
}

export async function clockOut(note) {
  if (!isOnline()) {
    enqueueClock({ kind: 'out', note });
    return { queued: true };
  }
  const { data, error } = await supabase.rpc('staff_clock_out', { p_note: note || null });
  if (error) throw error;
  return data;
}

// ---- Offline queue ----
function readQueue() {
  try { return JSON.parse(localStorage.getItem(CLOCK_QUEUE_KEY) || '[]'); } catch { return []; }
}
function writeQueue(q) { localStorage.setItem(CLOCK_QUEUE_KEY, JSON.stringify(q)); }
function enqueueClock(item) {
  const q = readQueue(); q.push({ ...item, queued_at: Date.now() }); writeQueue(q);
  // Ask the SW to retry when online
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready.then((r) => r.sync.register('clock-events-queue')).catch(() => {});
  }
}
export async function flushClockQueue() {
  const q = readQueue();
  if (!q.length || !isOnline()) return { flushed: 0 };
  const remaining = [];
  let flushed = 0;
  for (const item of q) {
    try {
      if (item.kind === 'in') {
        await supabase.rpc('staff_clock_in', {
          p_lat: item.lat, p_lng: item.lng, p_accuracy_m: item.accuracy_m,
          p_photo_path: null, p_device_id: getDeviceId(),
          p_scheduled_end_at: item.scheduled_end_at || null,
        });
      } else if (item.kind === 'out') {
        await supabase.rpc('staff_clock_out', { p_note: item.note || null });
      }
      flushed++;
    } catch (e) {
      remaining.push(item);
    }
  }
  writeQueue(remaining);
  return { flushed, remaining: remaining.length };
}

// ----------------------------------------------------------------------------
// SHIFT EXTENSIONS (overage flow)
// ----------------------------------------------------------------------------
export async function requestExtension({ timeEntryId, minutes, reason }) {
  const { data: sess } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/extension-request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sess?.session?.access_token ?? ''}`,
    },
    body: JSON.stringify({ time_entry_id: timeEntryId, requested_minutes: minutes, reason }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'request failed');
  return (await res.json()).extension;
}

export async function getMyOpenExtensions(timeEntryId) {
  const q = supabase.from('shift_extensions').select('*').order('created_at', { ascending: false }).limit(5);
  if (timeEntryId) q.eq('time_entry_id', timeEntryId);
  const { data } = await q;
  return data || [];
}

// ----------------------------------------------------------------------------
// TASKS (delegates to Phase 2 task_assignments + tasks tables when present)
// ----------------------------------------------------------------------------
export async function getTodayTasks() {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) return [];
  const { data: staff } = await supabase.from('staff').select('id').eq('user_id', u.user.id).maybeSingle();
  if (!staff) return [];

  // Read assigned tasks if the assignments table exists; otherwise return [].
  const { data, error } = await supabase
    .from('task_assignments')
    .select('id, task_id, due_at, completed_at, tasks(name, description, badge)')
    .eq('staff_id', staff.id)
    .gte('due_at', new Date(new Date().setHours(0,0,0,0)).toISOString())
    .order('due_at', { ascending: true });

  if (error) return [];  // table may not exist yet — that's fine
  return data || [];
}

// ----------------------------------------------------------------------------
// TIME OFF
// ----------------------------------------------------------------------------
export async function requestTimeOff({ kind, startDate, endDate, note }) {
  const staff = await getMyStaffRow();
  if (!staff) throw new Error('Not enrolled as staff');
  const { data, error } = await supabase.from('time_off_requests').insert({
    tenant_id: staff.tenant_id,
    staff_id: staff.id,
    kind, start_date: startDate, end_date: endDate, note,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function getMyTimeOff() {
  const { data } = await supabase
    .from('time_off_requests')
    .select('*')
    .order('start_date', { ascending: false })
    .limit(10);
  return data || [];
}
