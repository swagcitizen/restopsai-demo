// tipPoolRepo.js — Tip entries per pay period per staff.
//
// Tips can be entered three ways: declared by the server, pooled by the
// shift, or auto-imported from credit-card data (future). Pay run RPC sums
// these into pay_run_lines.tips.

import { supabase } from './supabaseClient.js';
import * as offline from './offlineQueue.js';

function ctx() {
  const c = window.__RESTOPS_CTX__;
  if (!c) throw new Error('Tenant context not loaded');
  return c;
}
function tenantOrNull() { return window.__RESTOPS_CTX__?.tenantId || null; }

export async function listForPeriod(periodId) {
  const { data, error } = await supabase
    .from('tip_pool_entries')
    .select('id, staff_id, tip_amount, tip_type, recorded_at, notes')
    .eq('pay_period_id', periodId)
    .order('recorded_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addEntry({ payPeriodId, staffId, tipAmount, tipType = 'declared', notes = null }) {
  const { tenantId, user } = ctx();
  if (!staffId) throw new Error('staffId required');
  const id = offline.newId();
  const row = {
    id,
    tenant_id: tenantId,
    pay_period_id: payPeriodId,
    staff_id: staffId,
    tip_amount: Number(tipAmount) || 0,
    tip_type: tipType || 'declared',
    recorded_by: user?.id || null,
    notes: notes || null,
  };
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase.from('tip_pool_entries').insert(row).select().single();
      if (error) throw error;
      return data;
    },
    { table: 'tip_pool_entries', op: 'insert', payload: row, tenantId, optimisticValue: { ...row, queued: true } }
  );
}

export async function removeEntry(entryId) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { error } = await supabase.from('tip_pool_entries').delete().eq('id', entryId);
      if (error) throw error;
    },
    { table: 'tip_pool_entries', op: 'delete', payload: { match: { id: entryId } }, tenantId, optimisticValue: { id: entryId, queued: true } }
  );
}
