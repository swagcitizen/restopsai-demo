// payrollRepo.js — Pay periods + pay runs (Gusto/ADP/Paychex CSV exports).
//
// Workflow: Manager creates a pay_period, generates a run (server-side RPC
// computes per-staff regular/overtime hours from time_entries plus tips from
// tip_pool_entries), reviews the lines, then exports a CSV in the format
// their existing payroll provider expects. We don't push to APIs in this
// release — CSV-only handoff so operators can stop hand-keying timecards.
//
// All writes are wrapped in offline.withOffline() — pay-period drafts often
// happen on a back-office tablet that drops Wi-Fi at the worst moments.

import { supabase } from './supabaseClient.js';
import * as offline from './offlineQueue.js';

function ctx() {
  const c = window.__RESTOPS_CTX__;
  if (!c) throw new Error('Tenant context not loaded');
  return c;
}
function tenantOrNull() { return window.__RESTOPS_CTX__?.tenantId || null; }

// ---------------------------------------------------------------------------
// Pay periods
// ---------------------------------------------------------------------------
export async function listPayPeriods({ limit = 50 } = {}) {
  const { data, error } = await supabase
    .from('pay_periods')
    .select('id, location_id, period_start, period_end, pay_date, status, provider, notes, created_at, locked_at, exported_at')
    .order('period_start', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getPayPeriod(periodId) {
  const { data, error } = await supabase
    .from('pay_periods')
    .select('*')
    .eq('id', periodId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createPayPeriod({ periodStart, periodEnd, payDate = null, locationId = null, notes = null }) {
  const { tenantId, user } = ctx();
  const id = offline.newId();
  const row = {
    id,
    tenant_id: tenantId,
    location_id: locationId || null,
    period_start: periodStart,
    period_end: periodEnd,
    pay_date: payDate || null,
    status: 'draft',
    notes: notes || null,
    created_by: user?.id || null,
  };
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase.from('pay_periods').insert(row).select().single();
      if (error) throw error;
      return data;
    },
    { table: 'pay_periods', op: 'insert', payload: row, tenantId, optimisticValue: { ...row, queued: true } }
  );
}

export async function updatePayPeriod(periodId, patch) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase.from('pay_periods').update(patch).eq('id', periodId).select().maybeSingle();
      if (error) throw error;
      return data;
    },
    { table: 'pay_periods', op: 'update', payload: { match: { id: periodId }, patch }, tenantId, optimisticValue: { id: periodId, queued: true, ...patch } }
  );
}

export async function deletePayPeriod(periodId) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { error } = await supabase.from('pay_periods').delete().eq('id', periodId);
      if (error) throw error;
    },
    { table: 'pay_periods', op: 'delete', payload: { match: { id: periodId } }, tenantId, optimisticValue: { id: periodId, queued: true } }
  );
}

// ---------------------------------------------------------------------------
// Pay runs (RPC-driven)
// ---------------------------------------------------------------------------
export async function generatePayRun(periodId) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase.rpc('generate_pay_run', { p_pay_period_id: periodId });
      if (error) throw error;
      return data;
    },
    { table: 'pay_runs', op: 'rpc', payload: { fn: 'generate_pay_run', args: { p_pay_period_id: periodId } }, tenantId, optimisticValue: { queued: true } }
  );
}

export async function unlockPayPeriod(periodId) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase.rpc('unlock_pay_period', { p_pay_period_id: periodId });
      if (error) throw error;
      return data;
    },
    { table: 'pay_periods', op: 'rpc', payload: { fn: 'unlock_pay_period', args: { p_pay_period_id: periodId } }, tenantId, optimisticValue: { id: periodId, status: 'draft', queued: true } }
  );
}

export async function markPayPeriodPaid(periodId) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase.rpc('mark_pay_period_paid', { p_pay_period_id: periodId });
      if (error) throw error;
      return data;
    },
    { table: 'pay_periods', op: 'rpc', payload: { fn: 'mark_pay_period_paid', args: { p_pay_period_id: periodId } }, tenantId, optimisticValue: { id: periodId, status: 'paid', queued: true } }
  );
}

export async function getRunForPeriod(periodId) {
  const { data, error } = await supabase
    .from('pay_runs')
    .select('*')
    .eq('pay_period_id', periodId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listRunLines(runId) {
  const { data, error } = await supabase
    .from('pay_run_lines')
    .select('id, staff_id, regular_hours, overtime_hours, hourly_rate, regular_pay, overtime_pay, tips, gross_pay')
    .eq('pay_run_id', runId);
  if (error) throw error;
  return data || [];
}

export async function updateRunLineTips(lineId, tips) {
  const tenantId = tenantOrNull();
  // Recompute gross_pay client-side; trust hourly_rate already stamped on row.
  const { data: row, error: e0 } = await supabase
    .from('pay_run_lines')
    .select('regular_pay, overtime_pay')
    .eq('id', lineId)
    .maybeSingle();
  if (e0) throw e0;
  const r = Number(row?.regular_pay) || 0;
  const o = Number(row?.overtime_pay) || 0;
  const newTips = Number(tips) || 0;
  const patch = { tips: newTips, gross_pay: Number((r + o + newTips).toFixed(2)) };
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase
        .from('pay_run_lines')
        .update(patch)
        .eq('id', lineId)
        .select()
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    { table: 'pay_run_lines', op: 'update', payload: { match: { id: lineId }, patch }, tenantId, optimisticValue: { id: lineId, queued: true, ...patch } }
  );
}

export async function markExported(periodId, provider) {
  const tenantId = tenantOrNull();
  const patch = { status: 'exported', provider, exported_at: new Date().toISOString() };
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase.from('pay_periods').update(patch).eq('id', periodId).select().maybeSingle();
      if (error) throw error;
      return data;
    },
    { table: 'pay_periods', op: 'update', payload: { match: { id: periodId }, patch }, tenantId, optimisticValue: { id: periodId, queued: true, ...patch } }
  );
}
