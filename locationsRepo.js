// locationsRepo.js — Supabase-backed CRUD for tenant locations.
//
// Locations represent physical sites a tenant operates. Every tenant has
// exactly one primary location and at most one commissary location. The
// commissary is a central kitchen that produces for satellite locations via
// commissary_transfers.
//
// All writes go through offline.withOffline() so they queue cleanly when the
// browser is offline, matching the rest of the app.

import { supabase } from './supabaseClient.js';
import * as offline from './offlineQueue.js';

function tenantOrNull() {
  return window.__RESTOPS_CTX__?.tenantId || null;
}

function ctx() {
  const c = window.__RESTOPS_CTX__;
  if (!c) throw new Error('Tenant context not loaded');
  return c;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export async function fetchLocations() {
  const { data, error } = await supabase
    .from('locations')
    .select('id, tenant_id, name, address_line1, city, state, postal_code, timezone, is_primary, is_commissary, active, created_at')
    .eq('active', true)
    .order('is_primary', { ascending: false })
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getLocation(id) {
  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
export async function addLocation({ name, address_line1 = null, city = null, state = null, postal_code = null, timezone = null, isCommissary = false } = {}) {
  const { tenantId } = ctx();
  if (!name || !name.trim()) throw new Error('Location name is required');
  const id = offline.newId();
  const row = {
    id,
    tenant_id: tenantId,
    name: name.trim(),
    address_line1: address_line1 || null,
    city: city || null,
    state: state || null,
    postal_code: postal_code || null,
    timezone: timezone || null,
    is_primary: false,
    is_commissary: !!isCommissary,
  };
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase.from('locations').insert(row).select().single();
      if (error) throw error;
      return data;
    },
    { table: 'locations', op: 'insert', payload: row, tenantId, optimisticValue: { ...row, queued: true } }
  );
}

export async function updateLocation(id, patch) {
  const dbPatch = {};
  for (const k of ['name', 'address_line1', 'city', 'state', 'postal_code', 'timezone', 'active']) {
    if (patch[k] !== undefined) dbPatch[k] = patch[k];
  }
  if (Object.keys(dbPatch).length === 0) return null;
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { error } = await supabase.from('locations').update(dbPatch).eq('id', id);
      if (error) throw error;
    },
    { table: 'locations', op: 'update', payload: { match: { id }, patch: dbPatch }, tenantId, optimisticValue: { id, queued: true } }
  );
}

export async function deleteLocation(id) {
  // Soft-delete via active=false. Hard deletes would orphan transfer history.
  return updateLocation(id, { active: false });
}

// Mark a location as the tenant's commissary. Clears commissary flag from any
// other location first (the partial unique index allows only one commissary).
export async function setCommissary(id, makeCommissary = true) {
  const { tenantId } = ctx();
  if (makeCommissary) {
    const { error: clrErr } = await supabase
      .from('locations')
      .update({ is_commissary: false })
      .eq('tenant_id', tenantId)
      .eq('is_commissary', true);
    if (clrErr) throw clrErr;
  }
  const { error } = await supabase
    .from('locations')
    .update({ is_commissary: makeCommissary })
    .eq('id', id);
  if (error) throw error;
}

// Mark a location as primary. Clears primary flag from any other location first.
export async function setPrimary(id) {
  const { tenantId } = ctx();
  const { error: clrErr } = await supabase
    .from('locations')
    .update({ is_primary: false })
    .eq('tenant_id', tenantId)
    .eq('is_primary', true);
  if (clrErr) throw clrErr;
  const { error } = await supabase
    .from('locations')
    .update({ is_primary: true })
    .eq('id', id);
  if (error) throw error;
}
