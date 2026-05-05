// countsRepo.js — Inventory counts for Theoretical-vs-Actual variance.
//
// A count is a snapshot of on-hand inventory at a point in time. Two counts
// (start, end) define the window the variance engine reports against. Manager+
// only for writes (RLS enforces this server-side; the UI hides write actions).
//
// Writes are wrapped in offline.withOffline() so a flaky tablet connection
// during an inventory walk doesn't drop work on the floor.

import { supabase } from './supabaseClient.js';
import * as offline from './offlineQueue.js';

function ctx() {
  const c = window.__RESTOPS_CTX__;
  if (!c) throw new Error('Tenant context not loaded');
  return c;
}
function tenantOrNull() { return window.__RESTOPS_CTX__?.tenantId || null; }

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export async function listCounts({ locationId = null, limit = 50 } = {}) {
  let q = supabase
    .from('inventory_counts')
    .select('id, tenant_id, location_id, counted_at, period_label, status, notes, counted_by, created_at, updated_at')
    .order('counted_at', { ascending: false })
    .limit(limit);
  if (locationId) q = q.eq('location_id', locationId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getCount(countId) {
  const { data: hdr, error: e1 } = await supabase
    .from('inventory_counts')
    .select('*')
    .eq('id', countId)
    .maybeSingle();
  if (e1) throw e1;
  if (!hdr) return null;
  const { data: lines, error: e2 } = await supabase
    .from('inventory_count_lines')
    .select('id, inventory_item_id, counted_qty, unit, unit_cost, extended_cost, notes')
    .eq('count_id', countId);
  if (e2) throw e2;
  return { ...hdr, lines: lines || [] };
}

// Sum extended_cost for a count — used for the totals column in the table.
export async function countTotals(countId) {
  const { data, error } = await supabase
    .from('inventory_count_lines')
    .select('extended_cost')
    .eq('count_id', countId);
  if (error) throw error;
  const lines = data || [];
  return {
    lineCount: lines.length,
    totalDollars: lines.reduce((s, l) => s + (Number(l.extended_cost) || 0), 0),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
export async function createCount({ locationId = null, periodLabel = null, notes = null, countedAt = null } = {}) {
  const { tenantId, user } = ctx();
  const id = offline.newId();
  const row = {
    id,
    tenant_id: tenantId,
    location_id: locationId || null,
    counted_at: countedAt || new Date().toISOString(),
    counted_by: user?.id || null,
    period_label: periodLabel || null,
    notes: notes || null,
    status: 'draft',
  };
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase
        .from('inventory_counts')
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    { table: 'inventory_counts', op: 'insert', payload: row, tenantId, optimisticValue: { ...row, queued: true } }
  );
}

export async function updateCount(countId, patch) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase
        .from('inventory_counts')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', countId)
        .select()
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    { table: 'inventory_counts', op: 'update', payload: { match: { id: countId }, patch }, tenantId, optimisticValue: { id: countId, queued: true, ...patch } }
  );
}

export async function deleteCount(countId) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { error } = await supabase.from('inventory_counts').delete().eq('id', countId);
      if (error) throw error;
    },
    { table: 'inventory_counts', op: 'delete', payload: { match: { id: countId } }, tenantId, optimisticValue: { id: countId, queued: true } }
  );
}

// ---- lines ----
export async function addLine(countId, { inventoryItemId, countedQty, unit = null, unitCost = null, notes = null }) {
  const { tenantId } = ctx();
  if (!inventoryItemId) throw new Error('inventoryItemId required');
  const id = offline.newId();
  const row = {
    id,
    count_id: countId,
    tenant_id: tenantId,
    inventory_item_id: inventoryItemId,
    counted_qty: Number(countedQty) || 0,
    unit: unit || null,
    unit_cost: unitCost == null ? null : Number(unitCost),
    notes: notes || null,
  };
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase
        .from('inventory_count_lines')
        .upsert(row, { onConflict: 'count_id,inventory_item_id' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    { table: 'inventory_count_lines', op: 'upsert', payload: row, tenantId, optimisticValue: { ...row, queued: true } }
  );
}

export async function updateLine(lineId, patch) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase
        .from('inventory_count_lines')
        .update(patch)
        .eq('id', lineId)
        .select()
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    { table: 'inventory_count_lines', op: 'update', payload: { match: { id: lineId }, patch }, tenantId, optimisticValue: { id: lineId, queued: true, ...patch } }
  );
}

export async function removeLine(lineId) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { error } = await supabase.from('inventory_count_lines').delete().eq('id', lineId);
      if (error) throw error;
    },
    { table: 'inventory_count_lines', op: 'delete', payload: { match: { id: lineId } }, tenantId, optimisticValue: { id: lineId, queued: true } }
  );
}

// ---- finalize via RPC ----
export async function finalizeCount(countId) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase.rpc('finalize_inventory_count', { p_count_id: countId });
      if (error) throw error;
      return data;
    },
    { table: 'inventory_counts', op: 'rpc', payload: { fn: 'finalize_inventory_count', args: { p_count_id: countId } }, tenantId, optimisticValue: { id: countId, status: 'finalized', queued: true } }
  );
}
