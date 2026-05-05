// transfersRepo.js — Commissary transfers (commissary kitchen → satellite).
//
// A transfer moves prepped batches or raw inventory from one location to
// another. Status flow: draft → sent → received. Receive triggers a server-side
// RPC that increments inventory at the destination location.
//
// Writes go through offline.withOffline() so partial connectivity doesn't
// strand the operator mid-flow.

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
export async function listTransfers({ status = null, limit = 100 } = {}) {
  let q = supabase
    .from('commissary_transfers')
    .select('id, from_location_id, to_location_id, status, scheduled_for, sent_at, received_at, notes, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getTransfer(transferId) {
  const { data: hdr, error: e1 } = await supabase
    .from('commissary_transfers')
    .select('*')
    .eq('id', transferId)
    .maybeSingle();
  if (e1) throw e1;
  if (!hdr) return null;
  const { data: lines, error: e2 } = await supabase
    .from('commissary_transfer_lines')
    .select('*')
    .eq('transfer_id', transferId)
    .order('created_at', { ascending: true });
  if (e2) throw e2;
  return { ...hdr, lines: lines || [] };
}

export async function listTransferLines(transferId) {
  const { data, error } = await supabase
    .from('commissary_transfer_lines')
    .select('*')
    .eq('transfer_id', transferId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
export async function createTransfer({ fromLocationId, toLocationId, scheduledFor = null, notes = null }) {
  const { tenantId } = ctx();
  if (!fromLocationId) throw new Error('From location is required');
  if (!toLocationId) throw new Error('To location is required');
  if (fromLocationId === toLocationId) throw new Error('From and to must differ');
  const id = offline.newId();
  const row = {
    id,
    tenant_id: tenantId,
    from_location_id: fromLocationId,
    to_location_id: toLocationId,
    scheduled_for: scheduledFor || null,
    notes: notes || null,
    status: 'draft',
  };
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase
        .from('commissary_transfers')
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    { table: 'commissary_transfers', op: 'insert', payload: row, tenantId, optimisticValue: { ...row, queued: true } }
  );
}

export async function addTransferLine(transferId, { inventoryItemId = null, recipeId = null, description, quantity, unit = null, unitCost = 0, notes = null }) {
  const { tenantId } = ctx();
  if (!description) throw new Error('Description required');
  const id = offline.newId();
  const row = {
    id,
    transfer_id: transferId,
    tenant_id: tenantId,
    inventory_item_id: inventoryItemId || null,
    recipe_id: recipeId || null,
    description,
    quantity: Number(quantity) || 0,
    unit: unit || null,
    unit_cost: Number(unitCost) || 0,
    notes: notes || null,
  };
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase
        .from('commissary_transfer_lines')
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    { table: 'commissary_transfer_lines', op: 'insert', payload: row, tenantId, optimisticValue: { ...row, queued: true } }
  );
}

export async function removeTransferLine(lineId) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { error } = await supabase.from('commissary_transfer_lines').delete().eq('id', lineId);
      if (error) throw error;
    },
    { table: 'commissary_transfer_lines', op: 'delete', payload: { match: { id: lineId } }, tenantId, optimisticValue: { id: lineId, queued: true } }
  );
}

export async function markSent(transferId) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase.rpc('mark_transfer_sent', { p_transfer_id: transferId });
      if (error) throw error;
      return data;
    },
    { table: 'commissary_transfers', op: 'rpc', payload: { fn: 'mark_transfer_sent', args: { p_transfer_id: transferId } }, tenantId, optimisticValue: { id: transferId, status: 'sent', queued: true } }
  );
}

export async function markReceived(transferId) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase.rpc('mark_transfer_received', { p_transfer_id: transferId });
      if (error) throw error;
      return data;
    },
    { table: 'commissary_transfers', op: 'rpc', payload: { fn: 'mark_transfer_received', args: { p_transfer_id: transferId } }, tenantId, optimisticValue: { id: transferId, status: 'received', queued: true } }
  );
}

export async function cancelTransfer(transferId) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { error } = await supabase
        .from('commissary_transfers')
        .update({ status: 'cancelled' })
        .eq('id', transferId);
      if (error) throw error;
    },
    { table: 'commissary_transfers', op: 'update', payload: { match: { id: transferId }, patch: { status: 'cancelled' } }, tenantId, optimisticValue: { id: transferId, queued: true } }
  );
}
