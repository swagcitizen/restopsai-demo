// varianceRepo.js — Theoretical-vs-Actual variance report runner.
//
// Thin wrapper around the `compute_variance_report` SQL RPC. Read-only by
// nature, but we still let withOffline() pass the call through so the queue
// machinery stays consistent (it just rethrows network errors here — there's
// nothing to optimistically apply).

import { supabase } from './supabaseClient.js';

function ctx() {
  const c = window.__RESTOPS_CTX__;
  if (!c) throw new Error('Tenant context not loaded');
  return c;
}

/**
 * Compute the variance report between two finalized counts.
 *
 * @param {object} args
 * @param {string} args.fromCountId — start count id
 * @param {string} args.toCountId   — end count id
 * @param {string|null} args.locationId — optional location filter
 * @returns {Promise<Array>} rows shaped like the SQL function definition
 */
export async function runReport({ fromCountId, toCountId, locationId = null }) {
  const { tenantId } = ctx();
  if (!fromCountId || !toCountId) throw new Error('Both counts are required');
  const { data, error } = await supabase.rpc('compute_variance_report', {
    p_tenant_id: tenantId,
    p_location_id: locationId || null,
    p_start_count_id: fromCountId,
    p_end_count_id: toCountId,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/**
 * Aggregate KPI tiles for a report.
 * Returns { totalTheoretical$, totalActual$, varianceDollars, variancePctOfActual }.
 */
export function summarize(rows) {
  let theoretical = 0, actual = 0, variance = 0, knownItems = 0;
  for (const r of rows || []) {
    const uc = Number(r.unit_cost) || 0;
    const t = r.theoretical_used_qty == null ? null : Number(r.theoretical_used_qty);
    const a = Number(r.actual_used_qty) || 0;
    if (t == null) continue;
    knownItems += 1;
    theoretical += t * uc;
    actual += a * uc;
    variance += (Number(r.variance_dollars) || 0);
  }
  return {
    totalTheoretical: theoretical,
    totalActual: actual,
    varianceDollars: variance,
    variancePct: actual > 0 ? (variance / actual) * 100 : 0,
    knownItems,
    totalItems: (rows || []).length,
  };
}
