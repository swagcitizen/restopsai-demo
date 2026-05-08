# Stationly Onboarding Polish — Release Notes

**Release date:** May 8, 2026
**Cache version:** stationly-v8

This release ships three small but high-impact onboarding improvements together.

## 1. Persistent activation checklist on dashboard

A collapsible activation panel now appears at the top of every dashboard tab until the operator has either completed every onboarding task or explicitly dismissed it.

- New table `public.activation_progress` (tenant_id, user_id, task_key, completed_at, dismissed) with RLS enforcing `is_tenant_member` on read and `auth.uid() = user_id` on write.
- New view `public.v_activation_status` (security_invoker = on) that derives boolean task status from real (non-sample) data: `has_inventory`, `has_recipe`, `has_temp_log`, `has_staff`, `has_invoice`, `has_count`, `has_team_invite`, `has_payroll_period`.
- Sample rows are excluded from activation booleans so the checklist reflects the operator's real progress, not the seeded demo data.
- New module `activationRepo.js` exposes `getStatus()`, `markComplete(taskKey)`, `dismiss(taskKey)`, `dismissAll()`. All writes are wrapped in `offline.withOffline()`.
- "Hide for now" uses sessionStorage (returns next session); "Don't show again" persists to the DB.

## 2. Sample data seeded for every new tenant

New tenants are automatically populated with a small but realistic demo dataset so the variance engine, recipes, and reports work out-of-the-box.

- Added `is_sample boolean default false` (with partial indexes) to `inventory_items`, `menu_items`, `recipes`, `staff`, `invoices`, `temp_logs`.
- New `seed_sample_data(p_tenant_id uuid)` SECURITY DEFINER function (REVOKE FROM PUBLIC, called only by trigger) seeds: 6 inventory items (Mozzarella, Pizza dough, Pepperoni, Marinara, Olive oil, Parmesan), 1 menu item (Sample Cheese Pizza, $14), 1 recipe with 3 ingredients linked to that menu item, 3 staff (manager, cook, server), 2 invoices ($124.50 and $58.20) with 2-3 line items each, and 1 temp log (Walk-in 38°F).
- Trigger `tenants_seed_sample_data_trg` runs AFTER INSERT on `tenants`, after the primary-location trigger so the seed function can resolve `location_id`.
- The seed is idempotent — early-returns if any sample row already exists for the tenant.
- New `clear_sample_data(p_tenant_id uuid)` RPC (SECURITY DEFINER, requires `is_tenant_manager_or_owner`) wipes all `is_sample = true` rows in one call.
- Dashboard shows a dismissible banner ("This is sample data — clear it before going live") whenever the workspace contains any sample rows. Inventory, menu, staff, invoice, and recipe tables tag sample rows with a small SAMPLE pill.

## 3. Onboarding bug fixes

- **Welcome name**: the wizard's "Welcome back, X" greeting now resolves from `user_metadata.full_name` first, then the restaurant name from step 1, then a friendly fallback — no more email local-parts shown to operators.
- **P&L import in step 4** opens in a new tab (`target="_blank" rel="noopener"`) so operators don't lose their wizard state.
- **Wizard → dashboard handoff** now does a pre-flight `getMemberships()` check before navigating; if tenant creation silently failed, the wizard surfaces the error and stays in step 6 instead of bouncing the user back to step 1.

## Migrations applied

1. `add_activation_checklist`
2. `add_sample_data_seeder`
3. `fix_activation_status_exclude_samples`

## Tests

- New spec: `tests/e2e/tests/12-onboarding-polish.spec.js` covering trigger seeding, view exclusions, `clear_sample_data` RPC, `activation_progress` writes, and RLS isolation.
- Test count: **48 passing** (was 47), 0 failing, 21 skipped (auth-confirmation gated).
