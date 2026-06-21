// expensesRepo.js — Owner Expenses hub data layer
//
// Talks to:
//   * v_expense_ledger (read-only view) via the expense_ledger RPC
//   * dashboard_kpis / dashboard_breakdown / dashboard_revenue_series / dashboard_top_items RPCs
//   * expenses_misc table for one-off expenses
//
// All RPCs gate on memberships(owner|manager). RLS handles tenant isolation
// on expenses_misc directly.

import { supabase } from './supabaseClient.js';

function wrapError(e, msg) {
  const err = new Error(`${msg}: ${e?.message || e}`);
  err.original = e;
  return err;
}

// ─── Ledger / RPCs ────────────────────────────────────────────────────────────

/**
 * @param {string} tenantId
 * @param {{ from?: string, to?: string, category?: string, sourceKind?: string, limit?: number }} opts
 */
export async function listExpenseLedger(tenantId, opts = {}) {
  const { from = null, to = null, category = null, sourceKind = null, limit = 200 } = opts;
  const { data, error } = await supabase.rpc('expense_ledger', {
    _tenant_id: tenantId,
    _from: from,
    _to: to,
    _category: category,
    _source_kind: sourceKind,
    _limit: limit,
  });
  if (error) throw wrapError(error, 'Failed to load expenses');
  return Array.isArray(data) ? data : [];
}

export async function dashboardKpis(tenantId, days = 30) {
  const { data, error } = await supabase.rpc('dashboard_kpis', {
    _tenant_id: tenantId,
    _days: days,
  });
  if (error) throw wrapError(error, 'Failed to load KPIs');
  return data || null;
}

export async function dashboardBreakdown(tenantId, days = 30) {
  const { data, error } = await supabase.rpc('dashboard_breakdown', {
    _tenant_id: tenantId,
    _days: days,
  });
  if (error) throw wrapError(error, 'Failed to load breakdown');
  return Array.isArray(data) ? data : [];
}

export async function dashboardRevenueSeries(tenantId, days = 30) {
  const { data, error } = await supabase.rpc('dashboard_revenue_series', {
    _tenant_id: tenantId,
    _days: days,
  });
  if (error) throw wrapError(error, 'Failed to load revenue series');
  return Array.isArray(data) ? data : [];
}

export async function dashboardTopItems(tenantId, days = 30, limit = 8) {
  const { data, error } = await supabase.rpc('dashboard_top_items', {
    _tenant_id: tenantId,
    _days: days,
    _limit: limit,
  });
  if (error) throw wrapError(error, 'Failed to load top items');
  return Array.isArray(data) ? data : [];
}

// ─── expenses_misc CRUD ───────────────────────────────────────────────────────

/**
 * Insert a one-off misc expense.
 * @param {string} tenantId
 * @param {{ occurred_on?: string, vendor?: string, category?: string, amount: number, notes?: string, attachment_url?: string }} row
 */
export async function addMiscExpense(tenantId, row) {
  if (!row || row.amount == null) throw new Error('amount is required');
  const payload = {
    tenant_id: tenantId,
    occurred_on: row.occurred_on || new Date().toISOString().slice(0, 10),
    vendor: row.vendor || null,
    category: row.category || 'other',
    amount: Number(row.amount),
    notes: row.notes || null,
    attachment_url: row.attachment_url || null,
  };
  const { data, error } = await supabase
    .from('expenses_misc')
    .insert(payload)
    .select()
    .single();
  if (error) throw wrapError(error, 'Failed to add expense');
  return data;
}

export async function updateMiscExpense(id, patch) {
  const { data, error } = await supabase
    .from('expenses_misc')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw wrapError(error, 'Failed to update expense');
  return data;
}

export async function deleteMiscExpense(id) {
  const { error } = await supabase.from('expenses_misc').delete().eq('id', id);
  if (error) throw wrapError(error, 'Failed to delete expense');
  return true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const CATEGORY_LABELS = {
  food:      'Food',
  labor:     'Labor',
  rent:      'Rent',
  utilities: 'Utilities',
  insurance: 'Insurance',
  fees:      'Fees',
  waste:     'Waste',
  other:     'Other',
};

export const SOURCE_LABELS = {
  bill:    'Bill',
  invoice: 'Invoice',
  receipt: 'Receipt',
  payroll: 'Payroll',
  waste:   'Waste',
  misc:    'Misc',
};

export function categoryLabel(c) { return CATEGORY_LABELS[c] || (c || 'Other'); }
export function sourceLabel(s)   { return SOURCE_LABELS[s] || (s || ''); }

export function fmtCurrency(n) {
  const v = Number(n || 0);
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}
