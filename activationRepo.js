// activationRepo.js — Persistent activation checklist data layer.
//
// The activation panel pinned to the top of the dashboard reads two sources:
//   1. v_activation_status — booleans for whether each underlying entity exists
//      (computed from inventory_items, recipes, temp_logs, staff, invoices,
//      inventory_counts, invites, pay_periods).
//   2. activation_progress — per-user dismissal flags. A user can dismiss
//      individual rows ("Don't show again") or all rows. Dismissals are
//      tenant + user scoped so different teammates manage their own state.
//
// Writes go through offline.withOffline() so a flaky tablet connection doesn't
// stall the user — the dismissal will replay from the queue when they're back.

import { supabase } from './supabaseClient.js';
import * as offline from './offlineQueue.js';

function ctx() {
  const c = window.__RESTOPS_CTX__;
  if (!c) throw new Error('Tenant context not loaded');
  return c;
}

// All eight checklist tasks the UI knows how to render. The order here is the
// order users see them — most-impactful onboarding moves first.
export const TASKS = [
  { key: 'add_inventory',     label: 'Add your first inventory item',  view: 'inventory', modalId: 'inv-modal',    icon: '📦' },
  { key: 'add_recipe',        label: 'Cost your first recipe',         view: 'recipes',   modalId: 'recipe-modal', icon: '📝' },
  { key: 'log_temp',          label: 'Log a temperature reading',      view: 'safety',    modalId: null,           icon: '🌡' },
  { key: 'add_staff',         label: 'Add your first staff member',    view: 'labor',     modalId: null,           icon: '🧑\u200d🍳' },
  { key: 'first_invoice',     label: 'Record your first invoice',      view: 'invoices',  modalId: null,           icon: '🧾' },
  { key: 'first_count',       label: 'Run your first inventory count', view: 'variance',  modalId: null,           icon: '🔢' },
  { key: 'invite_team',       label: 'Invite a teammate',              view: 'team',      modalId: null,           icon: '✉️' },
  { key: 'configure_payroll', label: 'Open your first pay period',     view: 'payroll',   modalId: null,           icon: '💵' },
];

// Map a task key to the corresponding boolean in v_activation_status.
const STATUS_FIELD = {
  add_inventory:     'has_inventory',
  add_recipe:        'has_recipe',
  log_temp:          'has_temp_log',
  add_staff:         'has_staff',
  first_invoice:     'has_invoice',
  first_count:       'has_count',
  invite_team:       'has_team_invite',
  configure_payroll: 'has_payroll_period',
};

// Returns array of { key, label, view, modalId, icon, complete, dismissed }.
// `complete` is auto-detected from underlying data; `dismissed` is per-user.
export async function getStatus() {
  const { tenantId, user } = ctx();
  if (!tenantId) return TASKS.map(t => ({ ...t, complete: false, dismissed: false }));

  let statusRow = null;
  try {
    const { data, error } = await supabase
      .from('v_activation_status')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    statusRow = data || null;
  } catch (err) {
    // RLS hiccup or offline — fall back to "nothing complete yet" so the panel
    // still renders. The user's view doesn't lie about completeness; it just
    // shows the checklist as if they hadn't done anything yet.
    console.warn('v_activation_status fetch failed:', err);
  }

  let dismissed = new Set();
  try {
    const userId = user?.id;
    if (userId) {
      const { data, error } = await supabase
        .from('activation_progress')
        .select('task_key, dismissed')
        .eq('tenant_id', tenantId)
        .eq('user_id', userId);
      if (error) throw error;
      for (const r of data || []) {
        if (r.dismissed) dismissed.add(r.task_key);
      }
    }
  } catch (err) {
    console.warn('activation_progress fetch failed:', err);
  }

  return TASKS.map(t => ({
    ...t,
    complete: !!statusRow?.[STATUS_FIELD[t.key]],
    dismissed: dismissed.has(t.key),
  }));
}

// Mark a single task dismissed for the current user.
export async function dismiss(taskKey) {
  const { tenantId, user } = ctx();
  const userId = user?.id;
  if (!tenantId || !userId) return;
  const row = {
    tenant_id: tenantId,
    user_id: userId,
    task_key: taskKey,
    dismissed: true,
    completed_at: null,
  };
  return offline.withOffline(
    async () => {
      const { error } = await supabase
        .from('activation_progress')
        .upsert(row, { onConflict: 'tenant_id,user_id,task_key' });
      if (error) throw error;
    },
    { table: 'activation_progress', op: 'upsert', payload: row, tenantId, optimisticValue: row }
  );
}

// Mark every visible task dismissed for the current user — used by the
// "Don't show again" link on the panel.
export async function dismissAll() {
  for (const t of TASKS) {
    try { await dismiss(t.key); } catch (e) { console.warn('dismiss', t.key, e); }
  }
}

// Mark a task complete (insert/update activation_progress with completed_at).
// Called when the UI detects the user just performed the action — purely
// cosmetic; the source of truth is v_activation_status.
export async function markComplete(taskKey) {
  const { tenantId, user } = ctx();
  const userId = user?.id;
  if (!tenantId || !userId) return;
  const row = {
    tenant_id: tenantId,
    user_id: userId,
    task_key: taskKey,
    completed_at: new Date().toISOString(),
    dismissed: false,
  };
  return offline.withOffline(
    async () => {
      const { error } = await supabase
        .from('activation_progress')
        .upsert(row, { onConflict: 'tenant_id,user_id,task_key' });
      if (error) throw error;
    },
    { table: 'activation_progress', op: 'upsert', payload: row, tenantId, optimisticValue: row }
  );
}
