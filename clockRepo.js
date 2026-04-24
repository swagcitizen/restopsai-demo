// clockRepo.js — Employee time clock + schedule publish data layer.
//
// Employees punch in/out via a shared tablet using a 4-digit PIN.
// The `staff.pin` column is unique per tenant, so `verifyPin` returns the
// matching employee for the active tenant (RLS scopes to current tenant).
//
// A `time_entries` row opens on clock-in (clock_out_at = null) and closes on
// clock-out. A partial unique index enforces one open shift per staff member.

import { supabase } from './supabaseClient.js';

function ctx() {
  const c = window.__RESTOPS_CTX__;
  if (!c) throw new Error('Tenant context not loaded');
  return c;
}

// -----------------------------------------------------------------------------
// PIN VERIFICATION
// -----------------------------------------------------------------------------

/**
 * Look up a staff member by 4-digit PIN in the active tenant.
 * Returns { id, name, role, hourly_rate } on match, null on no match.
 */
export async function verifyPin(pin) {
  if (!/^\d{4}$/.test(String(pin || ''))) return null;
  const { data, error } = await supabase
    .from('staff')
    .select('id, name, role, hourly_rate, phone')
    .eq('pin', pin)
    .eq('active', true)
    .maybeSingle();
  if (error) {
    console.error('verifyPin error:', error);
    return null;
  }
  return data || null;
}

// -----------------------------------------------------------------------------
// CLOCK IN / OUT
// -----------------------------------------------------------------------------

/**
 * Open a new time_entries row for this staff. Snapshots hourly_rate so future
 * wage changes don't retroactively alter payroll.
 * Throws if there's already an open shift (unique index enforces it).
 */
export async function clockIn(staffId, hourlyRate) {
  const { tenantId } = ctx();
  const { data, error } = await supabase
    .from('time_entries')
    .insert({
      tenant_id: tenantId,
      staff_id: staffId,
      clock_in_at: new Date().toISOString(),
      hourly_rate_snapshot: hourlyRate || 0,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Close an open time_entries row.
 */
export async function clockOut(entryId, breakMinutes = 0) {
  const { data, error } = await supabase
    .from('time_entries')
    .update({
      clock_out_at: new Date().toISOString(),
      break_minutes: breakMinutes || 0,
    })
    .eq('id', entryId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Get the current open shift for a staff member (clock_out_at IS NULL).
 * Returns null if no open shift.
 */
export async function getActiveShift(staffId) {
  const { data, error } = await supabase
    .from('time_entries')
    .select('id, clock_in_at, hourly_rate_snapshot')
    .eq('staff_id', staffId)
    .is('clock_out_at', null)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Fetch time entries in a date range (for payroll / reports).
 * from/to are ISO dates.
 */
export async function fetchTimeEntries({ from, to } = {}) {
  let q = supabase
    .from('time_entries')
    .select('id, staff_id, clock_in_at, clock_out_at, break_minutes, hourly_rate_snapshot, note')
    .order('clock_in_at', { ascending: false });
  if (from) q = q.gte('clock_in_at', from);
  if (to) q = q.lte('clock_in_at', to);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// -----------------------------------------------------------------------------
// SCHEDULE PUBLISH
// -----------------------------------------------------------------------------

/**
 * Persist a schedule snapshot and kick off SMS delivery via Edge Function.
 *
 * @param {Object} args
 * @param {string} args.weekStart - ISO date (Sunday)
 * @param {Array}  args.shifts    - [{ staff_id, staff_name, phone, day, start, end, hours, note }]
 * @param {Array}  args.messages  - [{ staff_id, name, phone, body }] — what we're about to send
 */
export async function publishSchedule({ weekStart, shifts, messages }) {
  const { tenantId, user } = ctx();

  // 1. Save the publish record first so we have a paper trail even if SMS fails
  const { data: pub, error: pubErr } = await supabase
    .from('schedule_publishes')
    .insert({
      tenant_id: tenantId,
      week_start: weekStart,
      published_by: user?.id || null,
      shifts: shifts,
      delivery_status: 'pending',
      delivery_results: [],
    })
    .select()
    .single();
  if (pubErr) throw pubErr;

  // 2. Invoke Edge Function to send SMS via Twilio
  let deliveryResults = [];
  let deliveryStatus = 'sent';
  try {
    const { data: fnData, error: fnErr } = await supabase.functions.invoke('send-schedule-sms', {
      body: { publish_id: pub.id, messages },
    });
    if (fnErr) throw fnErr;
    deliveryResults = fnData?.delivery_results || [];
    deliveryStatus = fnData?.status || 'sent';
  } catch (err) {
    console.error('send-schedule-sms invoke failed:', err);
    deliveryResults = messages.map((m) => ({
      staff_id: m.staff_id,
      name: m.name,
      status: 'failed',
      error: err.message || String(err),
    }));
    deliveryStatus = 'failed';
  }

  // 3. Update record with delivery results
  const { error: updErr } = await supabase
    .from('schedule_publishes')
    .update({ delivery_status: deliveryStatus, delivery_results: deliveryResults })
    .eq('id', pub.id);
  if (updErr) console.error('Could not update schedule publish record:', updErr);

  return { publish: pub, deliveryResults, deliveryStatus };
}

export async function fetchLastPublish() {
  const { data, error } = await supabase
    .from('schedule_publishes')
    .select('id, week_start, published_at, delivery_status, delivery_results')
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('fetchLastPublish error:', error);
    return null;
  }
  return data || null;
}
