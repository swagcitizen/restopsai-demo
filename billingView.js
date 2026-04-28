// billingView.js — Billing tab + status banner + read-only enforcement.
//
// Wired from app.js bootApp() after tenant context is loaded.
// Demo tenant is exempt from all billing UI — they see "Demo \u2014 always active".

import {
  getBillingStatus, isDemo, trialDaysLeft, pastDueGraceDaysLeft,
  startCheckout, openPortal, statusBannerHTML, BILLING_CONFIG,
} from './stripeClient.js';
import { supabase } from './supabaseClient.js';

let _state = null; // { tenantId, status }

export async function initBilling(ctx) {
  const tenantId = ctx?.tenant?.id;
  if (!tenantId) return;

  _state = { tenantId, status: null };

  if (isDemo(tenantId)) {
    renderDemoBilling();
    return;
  }

  try {
    _state.status = await getBillingStatus(tenantId);
  } catch (e) {
    console.warn('billing status fetch failed', e);
  }

  renderStatusBanner();
  renderBillingView();
  enforceAccessGate();
  wireBillingHandlers();

  // Re-render when user navigates to the billing tab in case status changed
  // after a checkout return (?status=success).
  window.addEventListener('hashchange', maybeReloadOnReturn);
  maybeReloadOnReturn();
}

function renderDemoBilling() {
  const empty  = document.getElementById('billing-empty');
  const status = document.getElementById('billing-status-card');
  if (empty)  empty.hidden  = true;
  if (status) {
    status.hidden = false;
    document.getElementById('billing-plan-name').textContent = 'Demo \u00b7 always active';
    document.getElementById('billing-meta').textContent =
      'This is the public Bella Vita demo. Demo accounts are exempt from billing.';
    document.getElementById('billing-checkout-btn').hidden = true;
    document.getElementById('billing-portal-btn').hidden  = true;
  }
}

function renderStatusBanner() {
  const html = statusBannerHTML(_state.status);
  if (!html) return;
  // Insert at top of main app content
  const host = document.querySelector('.app-main, main, .content') || document.body;
  let mount = document.getElementById('billing-banner-mount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'billing-banner-mount';
    host.insertBefore(mount, host.firstChild);
  }
  mount.innerHTML = html;
}

function renderBillingView() {
  const empty   = document.getElementById('billing-empty');
  const card    = document.getElementById('billing-status-card');
  const events  = document.getElementById('billing-events-card');
  const status  = _state.status;

  const hasSub = status && status.status && status.status !== 'incomplete' &&
                 (status.stripe_customer_id || status.status !== 'trialing' || status.trial_ends_at);

  // We always have a status row (created by trigger). Distinguish:
  //   - never started Stripe checkout: show empty state
  //   - in trial / active / past_due / canceled: show summary
  const everCheckedOut = !!status?.stripe_customer_id;

  if (!everCheckedOut) {
    if (empty)  empty.hidden  = false;
    if (card)   card.hidden   = true;
    if (events) events.hidden = true;
  } else {
    if (empty)  empty.hidden  = true;
    if (card)   card.hidden   = false;
    document.getElementById('billing-plan-name').textContent =
      `Stationly \u00b7 all-in (${status.billing_interval === 'year' ? 'annual' : 'monthly'})`;

    const lines = [];
    const qty = status.quantity || 1;
    const monthly = status.billing_interval === 'year'
      ? Math.round(BILLING_CONFIG.annual.amount_cents / 12 / 100)
      : BILLING_CONFIG.monthly.amount_cents / 100;
    lines.push(`${qty} location${qty === 1 ? '' : 's'} \u00b7 $${monthly * qty}/month effective`);

    if (status.status === 'trialing') {
      const d = trialDaysLeft(status);
      lines.push(`Trial \u2014 ${d} day${d === 1 ? '' : 's'} left`);
    } else if (status.status === 'past_due') {
      const d = pastDueGraceDaysLeft(status);
      lines.push(`Payment failed \u2014 ${d} day${d === 1 ? '' : 's'} grace period`);
    } else if (status.cancel_at_period_end) {
      lines.push(`Cancels on ${formatDate(status.current_period_end)}`);
    } else if (status.current_period_end) {
      lines.push(`Renews on ${formatDate(status.current_period_end)}`);
    }
    document.getElementById('billing-meta').innerHTML = lines.join(' \u00b7 ');

    document.getElementById('billing-portal-btn').hidden = false;
    document.getElementById('billing-checkout-btn').hidden = !(status.status === 'trialing' && !status.stripe_subscription_id);

    // Events list (last 10)
    if (events) {
      events.hidden = false;
      loadRecentEvents().then(rows => {
        const list = document.getElementById('billing-events-list');
        if (!list) return;
        if (!rows.length) {
          list.innerHTML = '<div class="muted">No billing events yet.</div>';
          return;
        }
        list.innerHTML = rows.map(r => `
          <div class="billing-event-row">
            <span>${prettyEventType(r.type)}</span>
            <span class="muted">${formatDateTime(r.processed_at)}</span>
          </div>`).join('');
      });
    }
  }
}

async function loadRecentEvents() {
  const { data } = await supabase
    .from('billing_events')
    .select('type, processed_at')
    .eq('tenant_id', _state.tenantId)
    .order('processed_at', { ascending: false })
    .limit(10);
  return data || [];
}

function enforceAccessGate() {
  const ok = _state.status?.access_ok ?? true;
  document.body.classList.toggle('app-readonly', !ok);
}

function wireBillingHandlers() {
  // Top-banner buttons (delegated)
  document.body.addEventListener('click', async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.matches('[data-billing-portal]')) { await handlePortal(); }
    if (t.matches('[data-billing-checkout]')) { await handleCheckout(); }
  });

  // Empty-state form
  const startBtn = document.getElementById('billing-start-btn');
  const qtyInput = document.getElementById('billing-quantity');
  const totalEl  = document.getElementById('billing-total');
  const intervalRadios = document.querySelectorAll('input[name="billing-interval"]');

  function recalcTotal() {
    const interval = document.querySelector('input[name="billing-interval"]:checked')?.value || 'month';
    const qty = Math.max(1, Number(qtyInput?.value || 1));
    if (interval === 'year') {
      const yearly = (BILLING_CONFIG.annual.amount_cents / 100) * qty;
      totalEl.textContent = `Total: $${yearly.toFixed(0)}/year`;
    } else {
      const monthly = (BILLING_CONFIG.monthly.amount_cents / 100) * qty;
      totalEl.textContent = `Total: $${monthly.toFixed(0)}/month`;
    }
  }
  qtyInput?.addEventListener('input', recalcTotal);
  intervalRadios.forEach(r => r.addEventListener('change', recalcTotal));

  startBtn?.addEventListener('click', async () => {
    const interval = document.querySelector('input[name="billing-interval"]:checked')?.value || 'month';
    const quantity = Math.max(1, Number(qtyInput?.value || 1));
    startBtn.disabled = true;
    startBtn.textContent = 'Loading\u2026';
    try {
      await startCheckout({ tenantId: _state.tenantId, interval, quantity, withTrial: true });
    } catch (e) {
      alert(`Could not start checkout: ${e.message}`);
      startBtn.disabled = false;
      startBtn.textContent = 'Start 14-day free trial';
    }
  });

  document.getElementById('billing-portal-btn')?.addEventListener('click', handlePortal);
  document.getElementById('billing-checkout-btn')?.addEventListener('click', handleCheckout);
}

async function handlePortal() {
  try { await openPortal(_state.tenantId); }
  catch (e) { alert(`Could not open billing portal: ${e.message}`); }
}
async function handleCheckout() {
  try { await startCheckout({ tenantId: _state.tenantId, interval: 'month', quantity: 1 }); }
  catch (e) { alert(`Could not start checkout: ${e.message}`); }
}

function maybeReloadOnReturn() {
  // After Stripe Checkout success the browser returns to #billing?status=success.
  // Webhook will land within seconds; refetch a couple times to surface it.
  if (!location.hash.startsWith('#billing')) return;
  if (!location.hash.includes('status=success')) return;
  let tries = 0;
  const t = setInterval(async () => {
    tries++;
    _state.status = await getBillingStatus(_state.tenantId);
    renderBillingView();
    enforceAccessGate();
    if (tries >= 6 || _state.status?.stripe_subscription_id) clearInterval(t);
  }, 1500);
}

function formatDate(iso) {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function formatDateTime(iso) {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function prettyEventType(t) {
  const map = {
    'checkout.session.completed': 'Subscription started',
    'customer.subscription.created': 'Subscription activated',
    'customer.subscription.updated': 'Plan updated',
    'customer.subscription.deleted': 'Subscription canceled',
    'invoice.paid': 'Payment received',
    'invoice.payment_failed': 'Payment failed',
  };
  return map[t] || t;
}
