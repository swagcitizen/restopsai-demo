# Stationly Onboarding Polish Release

User feedback after audit: the wizard structure is solid, but 3 friction points kill activation. Ship all 3 in one release.

## Release 1: Persistent Activation Checklist

**Goal**: Collapsible panel pinned to the top of the dashboard. Shows "X of Y complete" with one-click jumps to each task. Survives across sessions, dismissible only when 100% complete (or via "Hide for now").

### Migration: `add_activation_checklist`

**Table: `activation_progress`**
```
id uuid pk default gen_random_uuid()
tenant_id uuid not null fk tenants on delete cascade
user_id uuid not null fk auth.users on delete cascade
task_key text not null         -- 'add_inventory' | 'log_temp' | 'add_recipe' | 'add_staff' | 'first_invoice' | 'first_count' | 'invite_team' | 'configure_payroll'
completed_at timestamptz
dismissed boolean default false
created_at timestamptz default now()
unique (tenant_id, user_id, task_key)
```
RLS: tenant member select; user can write only their own rows.

**View: `v_activation_status(tenant_id, user_id, ...)`** — returns one row with booleans for each task by joining to actual data:
- `has_inventory` = exists row in inventory_items for tenant
- `has_recipe` = exists row in recipes for tenant
- `has_temp_log` = exists row in temperature_logs for tenant
- `has_staff` = exists row in staff for tenant
- `has_invoice` = exists row in invoices for tenant
- `has_count` = exists row in inventory_counts for tenant
- `has_team_invite` = exists row in invites for tenant where status='sent' or accepted
- `has_payroll_period` = exists row in pay_periods for tenant
Use security_invoker = on so RLS applies.

### Frontend
- New file: `activationRepo.js` — getStatus(), dismiss(taskKey), markComplete(taskKey)
- In `app.js`: add `renderActivationChecklist()` that runs once per app load and only shows if status incomplete. Collapsible panel pinned to top of every tab (or just the home/dashboard tab).
- Each row: icon + label + "Open" button that triggers tab nav. Examples:
  - "Add your first inventory item" → switch to Inventory tab + open #inv-modal
  - "Run a temperature log" → switch to Food Safety tab
  - "Add a recipe" → Recipes tab + open #recipe-modal
  - "Invite a teammate" → Team tab
  - "Add staff" → Schedule/Staff tab
  - "Record your first invoice" → Invoices tab
  - "Run your first inventory count" → Variance tab
- Auto-completion: detect when underlying data exists via `v_activation_status`. If a task auto-completes, show subtle ✓ animation.
- "Hide for now" button — dismisses for the session (no DB write, just localStorage)
- "Don't show again" — sets all `activation_progress.dismissed = true` for this user

### Styles
- Match Nexus design tokens (cream bg, accent orange for incomplete, muted green for complete)
- Progress bar at top, individual rows below
- Smooth collapse animation

---

## Release 2: Seed Sample Data on Tenant Creation

**Goal**: Every new tenant gets a realistic sandbox so the dashboard isn't empty on first login. Banner at top: "Showing sample data — [Clear and start fresh]".

### Migration: `add_sample_data_seeder`

**Function: `seed_sample_data(p_tenant_id uuid)`** — SECURITY DEFINER, called by trigger
- Inserts via direct SQL (bypassing RLS via SECURITY DEFINER):
  - 6 inventory items: Mozzarella (lb, $4.20, on_hand 12), Pizza dough (each, $0.85, on_hand 40), Pepperoni (lb, $6.10, on_hand 8), Marinara sauce (qt, $3.20, on_hand 6), Olive oil (gal, $32.00, on_hand 2), Parmesan (lb, $8.50, on_hand 4). All marked `is_sample = true`.
  - 1 menu item: "Sample Cheese Pizza" $14.00, marked is_sample = true
  - 1 recipe linked to that menu item with ingredients: 8oz mozz, 1 dough ball, 4oz marinara
  - 3 staff: Maria Conti (manager, $22/hr), James Wu (cook, $18/hr), Sarah Lopez (server, $15/hr) — all with `is_sample = true`
  - 2 invoices: one from "Sample Foods Co" $124.50 dated 7d ago, one from "Sample Produce" $58.20 dated 3d ago, both with 2-3 invoice_lines each
  - 1 temperature log entry from yesterday (walk-in 38°F)
  - All rows tagged `is_sample = true` in a new boolean column added to: `inventory_items`, `menu_items`, `recipes`, `staff`, `invoices`, `temperature_logs`. Use IF NOT EXISTS on the column add.

**Trigger**: `tenants_seed_sample_data_trg` AFTER INSERT on tenants → calls `seed_sample_data(NEW.id)`. Idempotent — checks if any sample row exists first.

**RPC: `clear_sample_data(p_tenant_id uuid)`** — manager+. Deletes all rows where `is_sample = true` for the tenant. Returns count deleted.

### Frontend
- In `app.js`: on app load, query `count(*) where is_sample = true`. If > 0, show banner: "Showing sample data so you can explore. [Clear and start fresh]"
- Banner button calls `clear_sample_data` RPC, then refreshes UI.
- Sample rows display a small "SAMPLE" tag in their row in tables (already-existing pattern from CUSTOM badge in tasks).

---

## Release 3: Bug fixes

### Bug 1: Welcome name reads from email local-part
- **File**: `onboarding.js` (find where it sets `#onb-name`)
- **Fix**: Use `user.user_metadata.full_name` if present, else extract first word of restaurant name from form-1, else fall back to "friend" (current default).
- The current behavior reads `email.split('@')[0]` and capitalizes — that produces "Qa" for `qa-test@x.com` and "Owner" for `owner@anthonyspizza.com`. Pull from auth metadata or restaurant name instead.

### Bug 2: P&L upload mid-onboarding takes user out of wizard
- **File**: `onboarding.html` line 205 — the P&L "option" link goes to `./app.html#pnl-import`
- **Fix**: Add `target="_blank" rel="noopener"` so it opens in a new tab; user stays in onboarding.

### Bug 3: Wizard → dashboard redirect issue
- The "Take me to my dashboard" button on step 6 sometimes returns to step-1 if the tenant wasn't fully created. Investigate `onboarding.js` — make sure the final form submit (step 5/6 transition) actually creates the tenant via SQL before the link is enabled. If creation fails, show an error inline rather than silently bouncing back.

---

## Verification (do all in this order)

1. `apply_migration` for all 3 migrations succeeds (`add_activation_checklist`, `add_sample_data_seeder`, idempotent)
2. `execute_sql` confirms `activation_progress` table, `v_activation_status` view, `seed_sample_data` and `clear_sample_data` functions exist
3. Manually test: sign up as new user → finish onboarding → land on dashboard → verify sample data banner shows + activation checklist visible
4. Click "Clear and start fresh" → confirm sample data gone, banner gone
5. Add an inventory item manually → confirm "Add your first inventory item" task auto-checks
6. Existing 47 Playwright tests must still pass (`npx playwright test` from `tests/e2e/`)
7. Add new test `tests/e2e/tests/12-onboarding-polish.spec.js`:
   - Signup as new user, complete wizard, assert sample data exists + banner visible
   - Call `clear_sample_data`, assert all rows with is_sample=true are deleted
   - Assert `v_activation_status` flips a task to true after seeding underlying data

## Deploy + commit

- Bump `sw.js` cache **v7 → v8**
- `deploy_website` (project_path=`/home/user/workspace/restopsai-app`)
- Commit + push to `swagcitizen/restopsai-demo` master via `bash` + `api_credentials=["github"]`. Message: `feat(onboarding): activation checklist + sample data seeding + welcome polish`
- Save `/home/user/workspace/restopsai-app/ONBOARDING-RELEASE-NOTES.md`

## Constraints
- All migrations idempotent
- All writes through `offline.withOffline()` for activation_progress
- All RPCs SECURITY DEFINER + REVOKE FROM PUBLIC + GRANT TO authenticated
- Match existing Nexus design language
- Single-location and multi-location tenants both get sample data
