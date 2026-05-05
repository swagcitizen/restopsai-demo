// barPoursRepo.js — Manual log of bar pours (spill / comp / training / tasting).
//
// Primary depletion still flows through pos_line_items × recipes; this is for
// off-menu liquid that POS doesn't see. Stored in fluid ounces. Inventory_items
// quantities stay in bottles — readers convert via inventory_items.bottle_size_oz.

import { supabase } from './supabaseClient.js';
import * as offline from './offlineQueue.js';

function ctx() {
  const c = window.__RESTOPS_CTX__;
  if (!c) throw new Error('Tenant context not loaded');
  return c;
}
function tenantOrNull() { return window.__RESTOPS_CTX__?.tenantId || null; }

export async function listPours({ limit = 100, locationId = null } = {}) {
  let q = supabase
    .from('bar_pours')
    .select('id, location_id, inventory_item_id, poured_oz, poured_at, reason, notes')
    .order('poured_at', { ascending: false })
    .limit(limit);
  if (locationId) q = q.eq('location_id', locationId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function logPour({ inventoryItemId, pouredOz, reason = 'spill', locationId = null, notes = null }) {
  const { tenantId, user } = ctx();
  if (!inventoryItemId) throw new Error('inventoryItemId required');
  const oz = Number(pouredOz);
  if (!Number.isFinite(oz) || oz <= 0) throw new Error('pouredOz must be > 0');
  const id = offline.newId();
  const row = {
    id,
    tenant_id: tenantId,
    location_id: locationId || null,
    inventory_item_id: inventoryItemId,
    poured_oz: oz,
    reason: reason || 'other',
    poured_by: user?.id || null,
    notes: notes || null,
  };
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase.from('bar_pours').insert(row).select().single();
      if (error) throw error;
      return data;
    },
    { table: 'bar_pours', op: 'insert', payload: row, tenantId, optimisticValue: { ...row, queued: true } }
  );
}

export async function deletePour(id) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { error } = await supabase.from('bar_pours').delete().eq('id', id);
      if (error) throw error;
    },
    { table: 'bar_pours', op: 'delete', payload: { match: { id } }, tenantId, optimisticValue: { id, queued: true } }
  );
}

// Convenience: per-category bar inventory snapshot (uses v_bar_inventory_status)
export async function listBarStatus({ locationId = null } = {}) {
  let q = supabase
    .from('v_bar_inventory_status')
    .select('inventory_item_id, name, category, unit, bottle_size_ml, bottle_size_oz, on_hand_bottles, on_hand_oz, par_bottles, on_hand_value, days_of_supply, reorder_flag, location_id, bin_location, vendor_sku, abv')
    .order('category', { ascending: true });
  if (locationId) q = q.eq('location_id', locationId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
