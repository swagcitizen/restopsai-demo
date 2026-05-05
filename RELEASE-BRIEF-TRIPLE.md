# Stationly Triple Release — Payroll + Bill Pay + Bar Inventory

Single coordinated release closing the final 3 benchmark gaps. Ship in one push so we get one deploy, one commit, one cache bump (v5 → v6).

User explicitly requested all three in priority order: **(3) payroll integration → (2) bill pay → (1) bar inventory**.

---

## Confirmed existing schema (do not re-discover)

- `staff(id, tenant_id, name, role, hourly_rate, phone, email, active, pin, location_id, ...)`
- `time_entries(id, tenant_id, staff_id, clock_in_at, clock_out_at, break_minutes, hourly_rate_snapshot, location_id, ...)`
- `schedule_shifts(id, tenant_id, staff_id, shift_date, start_time, end_time, hours, ...)`
- `invoices(id, tenant_id, vendor, invoice_number, invoice_date, subtotal, tax, total, status, image_url, ocr_raw, notes, ...)`
- `invoice_lines(id, invoice_id, tenant_id, line_index, raw_description, qty, unit, unit_price, extended_price, matched_inventory_id, match_confidence, created_new_sku, category, ...)`
- `inventory_items(id, tenant_id, name, unit, on_hand, par, unit_cost, supplier, location_id, ...)`
- `vendor_price_history(id, tenant_id, inventory_item_id, vendor, invoice_id, unit_price, recorded_at)`
- `locations(id, tenant_id, name, is_commissary, is_primary, ...)` — already exists
- `recipes(id, tenant_id, name, yield, menu_price, linked_menu_item_id, ...)`
- `recipe_ingredients(id, recipe_id, tenant_id, name, qty, unit, unit_cost, sort_order)`
- `pos_line_items(id, tenant_id, location_id, transaction_id, menu_item_id, item_name, quantity, unit_price, gross_amount, sold_at, ...)` — added in TvA release

RLS helpers: `is_tenant_member(tenant_id)`, `is_tenant_manager_or_owner(tenant_id)`.

---

# Release 1: Payroll Integration

**Goal**: Match Gusto/ADP/Paychex export workflows. Most operators don't want a full-stack payroll engine inside Stationly — they want time-clock + tip data exported in the exact format their existing payroll provider accepts. We deliver: pay periods, run drafts, per-employee gross calc (regular + overtime + tips), provider-specific CSV exports for the big 3, and an audit trail.

## Migration: `add_payroll`

### Tables

**`pay_periods`**
```
id uuid pk
tenant_id uuid not null fk tenants
location_id uuid null fk locations           -- NULL = all locations
period_start date not null
period_end date not null
pay_date date
status text not null default 'draft'         -- draft | locked | exported | paid
provider text                                -- 'gusto' | 'adp' | 'paychex' | 'generic_csv' | NULL
created_at timestamptz default now()
created_by uuid
locked_at timestamptz
exported_at timestamptz
unique (tenant_id, location_id, period_start, period_end)
```

**`pay_runs`** (one per pay_period when generated)
```
id uuid pk
tenant_id uuid not null
pay_period_id uuid not null fk pay_periods on delete cascade
generated_at timestamptz default now()
generated_by uuid
total_hours numeric default 0
total_regular_pay numeric default 0
total_overtime_pay numeric default 0
total_tips numeric default 0
total_gross numeric default 0
notes text
```

**`pay_run_lines`** (one per staff per pay_run)
```
id uuid pk
tenant_id uuid not null
pay_run_id uuid not null fk pay_runs on delete cascade
staff_id uuid not null fk staff
regular_hours numeric default 0
overtime_hours numeric default 0
hourly_rate numeric                          -- snapshot from staff at run time
regular_pay numeric                          -- regular_hours * hourly_rate
overtime_pay numeric                         -- overtime_hours * hourly_rate * 1.5
tips numeric default 0
gross_pay numeric                            -- regular_pay + overtime_pay + tips
unique (pay_run_id, staff_id)
```

**`tip_pool_entries`** (optional tip pool tracking)
```
id uuid pk
tenant_id uuid not null
pay_period_id uuid not null
staff_id uuid not null
tip_amount numeric not null default 0
tip_type text default 'declared'             -- declared | pooled | credit_card_auto
recorded_at timestamptz default now()
recorded_by uuid
notes text
```

Indexes: `(tenant_id, period_start desc)` on pay_periods, `(pay_period_id)` on pay_runs/lines, `(tenant_id, pay_period_id, staff_id)` on tip_pool_entries.

RLS:
- All tables: select via `is_tenant_member(tenant_id)`, write via `is_tenant_manager_or_owner(tenant_id)`.

### RPCs

**`generate_pay_run(p_pay_period_id uuid)`** — SECURITY DEFINER, manager+
- Asserts member of the period's tenant + manager
- Refuses if period status != 'draft' (must unlock if exported)
- Sums `time_entries` for each staff where `clock_out_at` is between period_start and period_end. Hours = (clock_out - clock_in - break_minutes) / 3600.
- Overtime: per US FLSA default = anything over 40 hours/week. Use a simple weekly bucket (not state-specific — leave a `notes` field for managers to override). For each ISO week in the period, anything > 40 hours becomes OT for that week; aggregate across weeks for the period.
- Sums `tip_pool_entries.tip_amount` per staff in period.
- Inserts pay_run + pay_run_lines, returns pay_run_id.
- Updates pay_period status to 'locked'.

**`unlock_pay_period(p_pay_period_id uuid)`** — manager+, refuses if status='paid'. Deletes the pay_run/lines, sets period back to 'draft'.

**`mark_pay_period_paid(p_pay_period_id uuid)`** — manager+, sets status='paid'. Idempotent.

REVOKE EXECUTE FROM PUBLIC, GRANT TO authenticated.

## Frontend

- New tab: **Payroll** (after Variance, before Settings)
- Files: `payrollRepo.js`, `tipPoolRepo.js`. Writes wrapped in `offline.withOffline()`.
- Sub-views inside the tab (segmented control at top):
  - **Pay Periods** — list of periods, "+ New Period" with start/end date pickers, per-row actions Generate Run / View Run / Export / Unlock / Mark Paid.
  - **Run Detail** — table of pay_run_lines: staff, reg hrs, OT hrs, rate, reg $, OT $, tips, gross $. Inline editable tips. KPI tiles for total hours, total gross.
  - **Tips** — quick add tip entries per staff per period.
  - **Export** — picks provider (Gusto / ADP / Paychex / Generic CSV), generates CSV client-side from pay_run_lines, downloads.

### CSV column maps (client-side, hardcoded)

- **Gusto**: `Employee Name, Hours, Overtime Hours, Tips, Other Earnings, Pay Type` (Pay Type = "Hourly")
- **ADP RUN**: `Employee ID, First Name, Last Name, Reg Hours, O/T Hours, Tips`
- **Paychex Flex**: `Employee Number, Name, Regular Hours, Overtime Hours, Tip Income`
- **Generic**: all our internal columns

Use existing `staff.name` (split on first space for ADP/Paychex first/last). Add a TODO note in the Export panel that this is best-effort and they should review before importing.

## Tests — `tests/e2e/tests/09-payroll.spec.js`
- Seed staff + time_entries spanning 2 weeks (one week = 50 hrs to trigger 10 hrs OT, one week = 35 hrs)
- Seed tip_pool_entries
- Create pay_period, call `generate_pay_run`
- Assert: regular_hours = 75, overtime_hours = 10, regular_pay = 75 × rate, overtime_pay = 10 × rate × 1.5, tips populated, gross matches
- Test unlock + regenerate idempotency
- RLS check: another tenant cannot read these runs

---

# Release 2: Bill Pay (Vendor ACH Out)

**Goal**: Approve vendor invoices, schedule payments, log when paid. We do NOT actually move money via Stripe/Plaid in this release (would require ACH licensing + Plaid Auth setup) — we ship the **workflow + audit trail** so operators can stop using paper checks and Excel. Phase 2 follow-up will plug into Plaid ACH or Stripe Treasury for actual money movement.

## Migration: `add_bill_pay`

### Tables

**`vendors`** (first-class vendor records — invoices currently store vendor as text only)
```
id uuid pk
tenant_id uuid not null
name text not null
display_name text
email text
phone text
address text
default_payment_method text default 'check'  -- check | ach | wire | card | other
default_terms_days integer default 30
account_number text                           -- their account # for us
ein text
notes text
active boolean default true
created_at timestamptz default now()
updated_at timestamptz default now()
unique (tenant_id, lower(name))
```

**`vendor_payment_methods`** (encrypted-at-rest at app layer; we just store last4)
```
id uuid pk
tenant_id uuid not null
vendor_id uuid not null fk vendors on delete cascade
method_type text not null                    -- ach | check | wire
bank_name text
routing_number_last4 text
account_number_last4 text
nickname text
is_default boolean default false
created_at timestamptz default now()
```

**`bills`** (1:1 mirror of `invoices` for AP workflow — invoices is the receiving doc, bills is the payable obligation)
```
id uuid pk
tenant_id uuid not null
vendor_id uuid not null fk vendors
invoice_id uuid null fk invoices             -- link if generated from invoice OCR
bill_number text                             -- vendor's invoice number
bill_date date not null
due_date date not null
amount numeric not null
amount_paid numeric not null default 0
status text not null default 'open'          -- open | scheduled | paid | partial | void | overdue
approval_status text not null default 'pending'  -- pending | approved | rejected
approved_at timestamptz
approved_by uuid
location_id uuid null
notes text
created_at timestamptz default now()
updated_at timestamptz default now()
```

**`bill_payments`** (one per actual payment event)
```
id uuid pk
tenant_id uuid not null
bill_id uuid not null fk bills on delete cascade
amount numeric not null
payment_method text not null                 -- ach | check | wire | card | cash | other
payment_date date not null
reference text                               -- check #, ACH trace, etc.
status text not null default 'completed'     -- pending | completed | failed | voided
notes text
created_at timestamptz default now()
created_by uuid
```

Add indexes: `(tenant_id, due_date)` on bills, `(tenant_id, status)` on bills, `(bill_id)` on bill_payments.

RLS: select tenant_member, write manager+.

### Views

**`v_bills_aging`** — for the AP aging dashboard
```sql
select bills.*,
  (amount - amount_paid) as balance,
  (current_date - due_date) as days_overdue,
  case
    when status = 'paid' then 'paid'
    when (current_date - due_date) <= 0 then 'current'
    when (current_date - due_date) <= 30 then '1-30'
    when (current_date - due_date) <= 60 then '31-60'
    when (current_date - due_date) <= 90 then '61-90'
    else '90+'
  end as aging_bucket
from bills;
```

### RPCs

**`approve_bill(p_bill_id uuid)`** — manager+; sets approval_status='approved', approved_at=now(), approved_by=auth.uid(); only if 'pending'.
**`reject_bill(p_bill_id uuid, p_reason text)`** — manager+; sets approval_status='rejected', appends reason to notes.
**`record_bill_payment(p_bill_id uuid, p_amount numeric, p_method text, p_payment_date date, p_reference text)`** — manager+; inserts bill_payment, increments bills.amount_paid, sets bills.status to 'paid' if amount_paid >= amount else 'partial'.
**`generate_bill_from_invoice(p_invoice_id uuid, p_due_date date)`** — manager+; auto-creates a vendor record from invoices.vendor if it doesn't exist, then a bill from the invoice. Returns bill_id. Idempotent: if invoice already linked, returns existing bill_id.

REVOKE EXECUTE FROM PUBLIC, GRANT TO authenticated.

## Frontend

- New tab: **Bills** (between Invoices and Payroll)
- Files: `vendorsRepo.js`, `billsRepo.js`. All writes wrapped in `offline.withOffline()`.
- Sub-views (segmented control):
  - **Bills** — table with columns Vendor, Bill #, Bill Date, Due Date, Amount, Balance, Status, Approval, Actions. Filters: status, aging bucket, vendor. Quick actions per row: Approve, Reject, Record Payment, Schedule.
  - **Vendors** — CRUD vendors with payment methods sub-modal.
  - **Aging Dashboard** — KPI tiles: Total Open AP, Overdue, Due This Week, Paid This Month. Aging buckets bar chart (current / 1-30 / 31-60 / 61-90 / 90+).
  - **Payment Schedule** — calendar/list view of upcoming scheduled payments.
- "+ New Bill" modal: pick vendor (or create inline), bill #, dates, amount, link to invoice (optional dropdown of unlinked invoices).
- "Record Payment" modal: amount (defaults to balance), method, date, reference.
- From the existing **Invoices** tab, add a "Create Bill" button per row that calls `generate_bill_from_invoice` then jumps to Bills.

## Tests — `tests/e2e/tests/10-bill-pay.spec.js`
- Create vendor, create bill, approve, record partial payment, assert balance and status='partial'
- Record final payment, assert status='paid'
- Generate bill from existing invoice, assert vendor auto-created
- Aging bucket assertions: insert a bill due 45 days ago, assert it appears in '31-60'
- RLS isolation

---

# Release 3: Bar / Liquor Inventory

**Goal**: BevSpot-style bottle-level tracking. Beer/wine/spirits have unique needs: per-bottle inventory (not just lb/oz), pour costs in fluid ounces, depletion by drink served, par per bottle, vendor SKU codes. We add a `category` column to inventory_items, build pour-cost-aware drink recipes, and offer a "tenths-of-a-bottle" count UI.

## Migration: `add_bar_inventory`

### Schema changes

Add to `inventory_items`:
- `category text default 'food'` — values: food | beer | wine | spirits | n/a_beverage | dry_goods | smallwares | other
- `bottle_size_ml numeric` — for beer/wine/spirits, e.g. 750 for standard wine, 355 for can, 1750 for handle
- `bottle_size_oz numeric generated always as (bottle_size_ml / 29.5735) stored`
- `unit_yield_oz numeric` — usable oz per bottle (accounts for spillage default 1.5oz lost on spirits)
- `vendor_sku text`
- `upc text`
- `abv numeric` — alcohol by volume %, optional
- `bin_location text` — physical location, e.g. "Back bar shelf 3"

Add to `recipe_ingredients` (so drink recipes can use fluid ounces cleanly):
- `pour_oz numeric` — for bar recipes; if set, takes precedence over qty/unit when computing depletion against bottle inventory.

### New table: `bar_pours` (optional manual log; primary depletion is via pos_line_items + recipes)
```
id uuid pk
tenant_id uuid not null
location_id uuid null
inventory_item_id uuid not null fk inventory_items
poured_oz numeric not null
poured_at timestamptz default now()
poured_by uuid
reason text                                  -- spill | comp | training | tasting | other
notes text
```

### View: `v_bar_inventory_status`
Per inventory_item where category in ('beer','wine','spirits','n/a_beverage'), returns: name, on_hand_bottles, on_hand_oz (on_hand × bottle_size_oz), par_bottles, days_of_supply (uses last 14 days avg depletion from pos_line_items × recipes), reorder_flag (on_hand < par).

### Updates to `compute_variance_report` RPC
Already handles per-item; bar items "just work" because the engine uses recipe_ingredients. But if `pour_oz` is set on the recipe ingredient, multiply pour_oz × sold_count and convert to bottles using `bottle_size_oz` for the variance comparison. Add this conversion logic to the existing RPC (CREATE OR REPLACE).

### New table: `bar_drinks_menu` view (just a filter, not a real table)
Use existing `menu_items` with category='drinks' or 'cocktails' or 'beer' or 'wine'. No schema change needed.

## Frontend

- Add a **category filter** at the top of the existing **Inventory** tab: All / Food / Beer / Wine / Spirits / N/A / Other.
- Add fields to the inventory create/edit modal: category (dropdown), bottle_size_ml, vendor_sku, upc, abv, bin_location, unit_yield_oz (auto-calc default for spirits).
- In the **Inventory count modal** (added in TvA release), when an item is bar category: show the qty input as a "bottles + tenths" UI: `[ 3 ]bottles + [ .4 ]tenths` with a hint "= 3.4 bottles (~85 oz)". Accept fractional input.
- New **"Bar"** sub-section in the Inventory tab (segmented control: Inventory | Bar | Counts):
  - Bar dashboard: cards per category showing total bottles on hand, total $ value, items below par
  - Pour log table with "+ Log Pour" button (spill/comp/training)
  - "Days of supply" sortable list
- Recipe editor: when a recipe has bar ingredients, show a "pour_oz" input alongside qty/unit so bartenders can enter "1.5 oz" naturally.

Files: extend existing `dataRepo.js` (no new repo file needed); add `barPoursRepo.js`. All writes wrapped in `offline.withOffline()`.

## Tests — `tests/e2e/tests/11-bar-inventory.spec.js`
- Create a spirits item: Tito's Vodka, bottle_size_ml=1000, unit_yield_oz=32, unit_cost=$25
- Create a drink recipe: Vodka Soda, pour_oz=1.5
- Create menu item Vodka Soda $9, link recipe
- Insert 10 sales of Vodka Soda
- Run variance report: theoretical = 10 × 1.5 oz = 15 oz = 0.469 bottles. Assert engine returns this in bottles correctly.
- Log a bar_pour (spill 0.5 oz), assert recorded
- Assert v_bar_inventory_status returns reorder_flag correctly when on_hand < par

---

# Shared / Cross-Cutting

## Files modified across all 3 releases
- `app.html` — add 3 tabs (Bills, Payroll), bar inventory category filter & sub-section
- `app.js` — `renderBills()`, `renderVendors()`, `renderBillsAging()`, `renderPayroll()`, `renderPayrollPeriods()`, `renderPayRunDetail()`, `renderPayrollExport()`, `renderBarDashboard()`, `renderPourLog()`. Update `renderInventory()` for category filter and `renderInventoryCountModal()` for bar UI.
- `styles.css` — bar category badges, AP aging color buckets, payroll OT highlighting, segmented control for sub-views
- `sw.js` — bump cache **v5 → v6**, add new repo files to precache list
- `dataRepo.js` — extend inventory CRUD for new bar fields

## Verification (do all in this order at the end)
1. `apply_migration` for all 3 migrations succeeds
2. `execute_sql` confirms all new tables present, RLS enabled, RPCs exist
3. `npx playwright test` — assert tests 09, 10, 11 pass alongside existing suite
4. `deploy_website` — single deploy
5. Single git commit + push: `feat(triple): payroll exports + bill-pay AP + bar inventory tracking`
6. Update `/home/user/workspace/stationly-feature-list.md` (add Sections 17, 18, 19)
7. Update `/home/user/workspace/stationly-benchmark.md` (flip 3 rows: bar inventory, bill pay, payroll integration to ✅)
8. Save full release notes to `/home/user/workspace/restopsai-app/TRIPLE-RELEASE-NOTES.md`

## Constraints
- All migrations idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`)
- Every mutation goes through `offline.withOffline()`
- All new RPCs SECURITY DEFINER, REVOKE FROM PUBLIC, GRANT TO authenticated
- Match existing Nexus design language; reuse CSS variables
- Single-location tenants see no UX change (everything respects existing location switcher)
- Existing 39 passing tests must remain green
- DO NOT actually integrate with Plaid/Stripe Treasury for ACH — workflow + audit only this release; document deferred items clearly
- DO NOT integrate Gusto/ADP API — CSV export only

## Out of scope (deferred — flag in release notes)
- Real ACH/wire money movement (needs Plaid Auth + ACH license)
- Direct Gusto/ADP API push (vs CSV export)
- State-specific overtime rules (CA daily OT, etc.)
- Beer keg depletion via flow meters
- Wine BTG (by the glass) per-bottle tracking with auto-86 alerts
- Vendor invoice PDF generation
- Tip credit / minimum wage compliance reporting
