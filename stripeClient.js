// stripeClient.js — billing helpers for Stationly.
//
// One flat plan ("all-in") at $89/loc/mo or $852/loc/yr. No tier gating.
//
// Pricing config lives in BILLING_CONFIG below. The price IDs ARE only used
// for display copy on the client; actual charging uses server-side env vars
// (STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ANNUAL) inside the edge functions.

import { supabase } from './supabaseClient.js';

export const BILLING_CONFIG = {
  monthly: {
    price_id: 'price_1TQtzeKEZmx2FnWM4tM864Gu',
    amount_cents: 8900,
    label: '$89',
    period: 'month',
  },
  annual: {
    price_id: 'price_1TQuJIKEZmx2FnWMO8eXbO39',
    amount_cents: 85200,
    label: '$71', // monthly equivalent
    period: 'month, billed annually',
    full_label: '$852/yr',
    discount_pct: 20,
  },
  trial_days: 14,
  demo_tenant_id: 'a2e00ee7-1f30-4fbd-86b9-e560fc062f72',
};

const FUNCTIONS_BASE = 'https://vmnhizmibdtlizigbzks.supabase.co/functions/v1';

async function authedFetch(path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('not signed in');
  const res = await fetch(`${FUNCTIONS_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

// ----------------- Status read -----------------

/**
 * Fetch the current billing status for a tenant. Returns:
 *   { tenant_id, status, plan, billing_interval, quantity, current_period_end,
 *     cancel_at_period_end, trial_ends_at, past_due_since,
 *     access_ok: boolean, banner: 'trial'|'past_due'|'lapsed'|null }
 */
export async function getBillingStatus(tenantId) {
  if (!tenantId) return null;
  const { data, error } = await supabase.rpc('get_my_billing_status', { p_tenant_id: tenantId });
  if (error) {
    console.warn('billing status read failed', error);
    return null;
  }
  return data;
}

export function isDemo(tenantId) {
  return tenantId === BILLING_CONFIG.demo_tenant_id;
}

export function trialDaysLeft(status) {
  if (!status?.trial_ends_at) return null;
  const ms = new Date(status.trial_ends_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

export function pastDueGraceDaysLeft(status) {
  if (status?.status !== 'past_due' || !status?.past_due_since) return null;
  const elapsed = Date.now() - new Date(status.past_due_since).getTime();
  const left = 7 - Math.floor(elapsed / 86400000);
  return Math.max(0, left);
}

// ----------------- Actions -----------------

export async function startCheckout({ tenantId, interval = 'month', quantity = 1, withTrial = true }) {
  const { url } = await authedFetch('/stripe-checkout', {
    tenant_id: tenantId, interval, quantity, with_trial: withTrial,
  });
  if (!url) throw new Error('no checkout url returned');
  window.location.assign(url);
}

export async function openPortal(tenantId) {
  const { url } = await authedFetch('/stripe-portal', { tenant_id: tenantId });
  if (!url) throw new Error('no portal url returned');
  window.location.assign(url);
}

export async function updateLocationCount(tenantId, quantity) {
  return authedFetch('/stripe-update-quantity', { tenant_id: tenantId, quantity });
}

// ----------------- UI helpers -----------------

export function statusBannerHTML(status) {
  if (!status) return '';
  if (status.status === 'past_due') {
    const days = pastDueGraceDaysLeft(status);
    return `<div class="billing-banner billing-banner-warn">
      <strong>Payment failed.</strong> ${days} day${days === 1 ? '' : 's'} left to update your card before your account is paused.
      <button data-billing-portal class="btn-link">Update payment</button>
    </div>`;
  }
  if (status.status === 'trialing') {
    const days = trialDaysLeft(status);
    if (days != null && days <= 14) {
      return `<div class="billing-banner billing-banner-info">
        <strong>Trial:</strong> ${days} day${days === 1 ? '' : 's'} left.
        <button data-billing-checkout class="btn-link">Add a card</button>
      </div>`;
    }
  }
  if (status.banner === 'lapsed') {
    return `<div class="billing-banner billing-banner-error">
      <strong>Subscription paused.</strong> Reactivate to keep using Stationly.
      <button data-billing-checkout class="btn-link">Reactivate</button>
    </div>`;
  }
  return '';
}

export function priceBlurb(interval = 'month') {
  return interval === 'year'
    ? `${BILLING_CONFIG.annual.label}/loc/mo · billed annually (${BILLING_CONFIG.annual.full_label}, save ${BILLING_CONFIG.annual.discount_pct}%)`
    : `${BILLING_CONFIG.monthly.label}/loc/month`;
}
