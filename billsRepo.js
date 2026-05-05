// billsRepo.js — Accounts payable: bills + payments.
//
// `bills` is the AP obligation; `invoices` is the receiving doc. They link
// 1:1 via bills.invoice_id when generated from an OCR'd invoice. Approval
// + payment lifecycle is managed by RPCs (security definer) so non-managers
// can read but only managers can move money on paper.

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
export async function listBills({ status = null, limit = 200 } = {}) {
  let q = supabase
    .from('bills')
    .select('id, vendor_id, invoice_id, bill_number, bill_date, due_date, amount, amount_paid, status, approval_status, approved_at, location_id, notes, created_at')
    .order('due_date', { ascending: true })
    .limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function listBillsAging() {
  const { data, error } = await supabase
    .from('v_bills_aging')
    .select('id, vendor_id, bill_number, bill_date, due_date, amount, amount_paid, balance, status, approval_status, days_overdue, aging_bucket')
    .order('due_date', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getBill(id) {
  const { data: hdr, error: e1 } = await supabase.from('bills').select('*').eq('id', id).maybeSingle();
  if (e1) throw e1;
  if (!hdr) return null;
  const { data: pays, error: e2 } = await supabase
    .from('bill_payments')
    .select('id, amount, payment_method, payment_date, reference, status, notes, created_at')
    .eq('bill_id', id)
    .order('payment_date', { ascending: false });
  if (e2) throw e2;
  return { ...hdr, payments: pays || [] };
}

export async function listPayments(billId) {
  const { data, error } = await supabase
    .from('bill_payments')
    .select('*')
    .eq('bill_id', billId)
    .order('payment_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
export async function createBill({ vendorId, invoiceId = null, billNumber = null, billDate, dueDate, amount, locationId = null, notes = null }) {
  const { tenantId } = ctx();
  if (!vendorId) throw new Error('vendorId required');
  if (!billDate) throw new Error('billDate required');
  if (!dueDate) throw new Error('dueDate required');
  const id = offline.newId();
  const row = {
    id,
    tenant_id: tenantId,
    vendor_id: vendorId,
    invoice_id: invoiceId || null,
    bill_number: billNumber || null,
    bill_date: billDate,
    due_date: dueDate,
    amount: Number(amount) || 0,
    amount_paid: 0,
    status: 'open',
    approval_status: 'pending',
    location_id: locationId || null,
    notes: notes || null,
  };
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase.from('bills').insert(row).select().single();
      if (error) throw error;
      return data;
    },
    { table: 'bills', op: 'insert', payload: row, tenantId, optimisticValue: { ...row, queued: true } }
  );
}

export async function updateBill(id, patch) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase
        .from('bills')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    { table: 'bills', op: 'update', payload: { match: { id }, patch }, tenantId, optimisticValue: { id, queued: true, ...patch } }
  );
}

export async function deleteBill(id) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { error } = await supabase.from('bills').delete().eq('id', id);
      if (error) throw error;
    },
    { table: 'bills', op: 'delete', payload: { match: { id } }, tenantId, optimisticValue: { id, queued: true } }
  );
}

export async function approveBill(billId) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase.rpc('approve_bill', { p_bill_id: billId });
      if (error) throw error;
      return data;
    },
    { table: 'bills', op: 'rpc', payload: { fn: 'approve_bill', args: { p_bill_id: billId } }, tenantId, optimisticValue: { id: billId, approval_status: 'approved', queued: true } }
  );
}

export async function rejectBill(billId, reason) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase.rpc('reject_bill', { p_bill_id: billId, p_reason: reason || '' });
      if (error) throw error;
      return data;
    },
    { table: 'bills', op: 'rpc', payload: { fn: 'reject_bill', args: { p_bill_id: billId, p_reason: reason || '' } }, tenantId, optimisticValue: { id: billId, approval_status: 'rejected', queued: true } }
  );
}

export async function recordPayment(billId, { amount, method, paymentDate, reference = null }) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase.rpc('record_bill_payment', {
        p_bill_id: billId,
        p_amount: Number(amount),
        p_method: method,
        p_payment_date: paymentDate,
        p_reference: reference || null,
      });
      if (error) throw error;
      return data;
    },
    { table: 'bill_payments', op: 'rpc', payload: { fn: 'record_bill_payment', args: { p_bill_id: billId, p_amount: amount, p_method: method, p_payment_date: paymentDate, p_reference: reference } }, tenantId, optimisticValue: { queued: true } }
  );
}

export async function generateFromInvoice(invoiceId, dueDate) {
  const tenantId = tenantOrNull();
  return offline.withOffline(
    async () => {
      const { data, error } = await supabase.rpc('generate_bill_from_invoice', {
        p_invoice_id: invoiceId,
        p_due_date: dueDate || null,
      });
      if (error) throw error;
      return data;
    },
    { table: 'bills', op: 'rpc', payload: { fn: 'generate_bill_from_invoice', args: { p_invoice_id: invoiceId, p_due_date: dueDate } }, tenantId, optimisticValue: { queued: true } }
  );
}
