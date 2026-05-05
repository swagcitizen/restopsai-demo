// vendorsRepo.js — Vendor master records for AP / Bill Pay.
//
// invoices.vendor was a free-text field; bills require a vendor_id. This
// repo manages the canonical vendor list plus optional payment methods
// (last-4 only — no full account numbers in this release).

import { supabase } from './supabaseClient.js';
import * as offline from './offlineQueue.js';

function ctx() {
  const c = window.__RESTOPS_CTX__;
  if (!c) throw new Error('Tenant context not loaded');
  return c;
}
function tenantOrNull() { return window.__RESTOPS_CTX__?.tenantId || null; }

export async function listVendors({ activeOnly = true } = {}) {
  let q = supabase
    .from('vendors')
    .select('id, name, display_name, email, phone, default_payment_method, default_terms_days, active, created_at')
    .order('name', { ascending: true });
  if (activeOnly) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getVendor(id) {
  const { data, error } = await supabase.from('vendors').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createVendor({ name, displayName = null, email = null, phone = null, address = null, defaultPaymentMethod = 'check', defaultTermsDays = 30, accountNumber = null, ein = null, notes = null }) {
  const { tenantId } = ctx();
  if (!name) throw new Error('Vendor name is required');
  const id = offline.newId();
  const row = {
    id,
    tenant_id: tenantId,
    name,
    display_name: displayName || null,
    email: email || null,
    phone: phone || null,
    address: address || null,
    default_payment_method: defaultPaymentMethod || 'check',
    default_terms_days: Number(defaultTermsDays) || 30,
    account_number: accountNumber || null,
    ein: ein || null,
    notes: notes || null,
    active: true,
  };
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase.from('vendors').insert(row).select().single();
      if (error) throw error;
      return data;
    },
    { table: 'vendors', op: 'insert', payload: row, tenantId, optimisticValue: { ...row, queued: true } }
  );
}

export async function updateVendor(id, patch) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase
        .from('vendors')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    { table: 'vendors', op: 'update', payload: { match: { id }, patch }, tenantId, optimisticValue: { id, queued: true, ...patch } }
  );
}

export async function deactivateVendor(id) {
  return updateVendor(id, { active: false });
}

// Payment methods — store last 4 only (no full bank info in this release).
export async function listPaymentMethods(vendorId) {
  const { data, error } = await supabase
    .from('vendor_payment_methods')
    .select('id, method_type, bank_name, routing_number_last4, account_number_last4, nickname, is_default, created_at')
    .eq('vendor_id', vendorId)
    .order('is_default', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addPaymentMethod(vendorId, { methodType, bankName = null, routingLast4 = null, accountLast4 = null, nickname = null, isDefault = false }) {
  const { tenantId } = ctx();
  const id = offline.newId();
  const row = {
    id,
    tenant_id: tenantId,
    vendor_id: vendorId,
    method_type: methodType,
    bank_name: bankName || null,
    routing_number_last4: routingLast4 ? String(routingLast4).slice(-4) : null,
    account_number_last4: accountLast4 ? String(accountLast4).slice(-4) : null,
    nickname: nickname || null,
    is_default: !!isDefault,
  };
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase.from('vendor_payment_methods').insert(row).select().single();
      if (error) throw error;
      return data;
    },
    { table: 'vendor_payment_methods', op: 'insert', payload: row, tenantId, optimisticValue: { ...row, queued: true } }
  );
}

export async function removePaymentMethod(id) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { error } = await supabase.from('vendor_payment_methods').delete().eq('id', id);
      if (error) throw error;
    },
    { table: 'vendor_payment_methods', op: 'delete', payload: { match: { id } }, tenantId, optimisticValue: { id, queued: true } }
  );
}
