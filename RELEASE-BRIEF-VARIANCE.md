# Stationly Release Brief — Theoretical vs Actual Variance (TvA)

**Goal**: Match (and exceed) R365's flagship feature. For any date range, show every inventory item with:
- **Theoretical usage** = sum of (recipe_ingredient.qty × menu_item_sold_count) for everything sold in the period
- **Actual usage** = beginning_count + purchases (invoices/transfers) − ending_count
- **Variance** = actual − theoretical (in units, dollars, and %)
- Color-coded rows (green ≤ 2%, yellow 2–5%, red > 5%)
- Drill-down per item showing the recipes that drove the theoretical, the invoices/transfers that drove purchases, and waste logs

**Why this wins**: R365's TvA report is the single most-cited reason operators pick R365 over MarginEdge. Stationly already has recipes, sales, invoices, waste, and (now) commissary transfers. Adding inventory counts + the variance engine closes the loop.

---

## Schema (migration: `add_variance_inventory_counts_and_engine`)

### New table: `inventory_counts` (one row per count session)
```
id uuid pk
tenant_id uuid not null fk tenants
location_id uuid null fk locations         -- NULL = tenant-wide
counted_at timestamptz not null default now()
counted_by uuid not null fk auth.users
period_label text                          -- "Week 18 close" / free text
status text not null default 'draft'       -- draft | finalized
notes text
created_at timestamptz default now()
updated_at timestamptz default now()
```
RLS: select via `is_tenant_member(tenant_id)`; write via `is_tenant_manager_or_owner(tenant_id)`.

### New table: `inventory_count_lines` (one row per item per count)
```
id uuid pk
count_id uuid not null fk inventory_counts on delete cascade
tenant_id uuid not null         -- denormalized for RLS perf
inventory_item_id uuid not null fk inventory_items
counted_qty numeric not null default 0
unit text                       -- snapshot from inventory_items.unit
unit_cost numeric               -- snapshot from inventory_items.unit_cost
extended_cost numeric generated always as (counted_qty * unit_cost) stored
notes text
unique (count_id, inventory_item_id)
```
RLS via parent count's tenant.

### New table: `pos_line_items` (per-item sales, used by the engine)
Some tenants have aggregate `pos_transactions` only. Going forward we want per-item. Add this table; the engine falls back to `pos_transactions.raw->'line_items'` if no rows exist.
```
id uuid pk
tenant_id uuid not null
location_id uuid null
transaction_id uuid null fk pos_transactions on delete set null
menu_item_id uuid null fk menu_items on delete set null
item_name text not null         -- snapshot for unmatched
quantity numeric not null default 1
unit_price numeric
gross_amount numeric
sold_at timestamptz not null
created_at timestamptz default now()
```
Indexes: (tenant_id, sold_at), (tenant_id, menu_item_id, sold_at).
RLS: tenant member.

### Indexes
- `inventory_counts(tenant_id, location_id, counted_at desc)`
- `inventory_count_lines(tenant_id, inventory_item_id)`
- `pos_line_items(tenant_id, sold_at desc)`

---

## RPC: `compute_variance_report(p_tenant_id uuid, p_location_id uuid, p_start_count_id uuid, p_end_count_id uuid)`

Returns a setof rows:
```
inventory_item_id uuid
item_name text
unit text
unit_cost numeric
beginning_qty numeric
ending_qty numeric
purchases_qty numeric         -- from invoices + commissary transfers received - transfers sent
theoretical_used_qty numeric  -- from recipe_ingredients × line items sold between start.counted_at and end.counted_at
waste_qty numeric             -- from waste_logs in the window
actual_used_qty numeric       -- beginning + purchases - ending
variance_qty numeric          -- actual - theoretical
variance_dollars numeric      -- variance_qty * unit_cost
variance_pct numeric          -- variance_qty / theoretical_used_qty (NULL if theoretical = 0)
severity text                 -- 'good' | 'warn' | 'bad' (thresholds 2%, 5%)
```

**Implementation outline**:
1. Resolve start/end counts; reject if same count or wrong tenant or different locations.
2. Build a CTE `period` (start_at = start_count.counted_at, end_at = end_count.counted_at).
3. CTE `beg` and `end_q`: per item from count lines.
4. CTE `purchases`: sum invoice line quantities in the window where invoice ingredient name matches inventory_item name (case-insensitive). Plus commissary transfers received at this location in the window minus transfers sent from this location.
5. CTE `sales`: per menu_item, total quantity sold in window from `pos_line_items` (fallback `daily_sales` if empty — in fallback we cannot do per-item; flag those items as `theoretical_used_qty = NULL` and `severity = 'unknown'`).
6. CTE `theoretical`: join sales → menu_item → recipe (`recipes.linked_menu_item_id`) → recipe_ingredients; sum `qty × sold_count`. Match recipe_ingredient.name → inventory_items.name (lower(trim())).
7. CTE `waste`: sum waste_logs.qty per item in window (match by name).
8. Final select joins all CTEs by inventory_item_id, computes actual = beginning + purchases - ending, variance, severity.

SECURITY DEFINER, REVOKE FROM PUBLIC, GRANT EXECUTE TO authenticated. Inside, `assert is_tenant_member(p_tenant_id)`.

---

## RPC: `finalize_inventory_count(p_count_id uuid)`
Sets status='finalized' and snapshots `inventory_items.on_hand` to `inventory_count_lines.counted_qty` for the location (so the count becomes the new on-hand). Manager+ only.

---

## Frontend

### New tab: **Variance** (between Cost and Settings)

**Top section — Inventory Counts**
- Table of recent counts for current location: date, label, status, lines count, total $, [Open] [Finalize] [Delete]
- "+ New Count" button → modal: pick location (defaults current), label, then a line-item editor that pre-fills every active inventory item with on_hand as suggested qty. Manager can override each line. Save as draft or finalize.

**Bottom section — Variance Report**
- Two dropdowns: "From count" / "To count" (lists finalized counts for this location, descending date)
- "Run Report" button → calls `compute_variance_report`
- Results table: Item, Unit, Theoretical, Actual, Variance Qty, Variance $, Variance %, severity badge
- Sortable by variance $ desc by default
- Row click → drawer showing the contributing recipes (with sold counts), purchases (invoices/transfers), and waste logs
- Top of report: 4 KPI tiles — Total Theoretical $, Total Actual $, Total Variance $, Variance % of Sales
- Export CSV button

### Files to add
- `countsRepo.js` — list/get/create/finalize/delete counts; addLine/updateLine/removeLine
- `varianceRepo.js` — runReport(tenantId, locationId, fromCountId, toCountId)
- All writes wrapped in `offline.withOffline()`

### Files to modify
- `app.html` — add Variance tab + 2 modals (`#count-modal`, `#count-line-edit-modal`)
- `app.js` — `renderVariance()`, `renderCountsTable()`, `renderVarianceTable()`, drill-down drawer
- `styles.css` — variance severity badges (.var-good/warn/bad), KPI tile component, drawer
- `sw.js` — bump cache to **v5**

### UX rules
- If tenant has no recipes OR no counts: show empty state with CTA "Add a recipe" / "Run your first count"
- If `theoretical_used_qty` is 0 but `actual_used_qty` > 0: severity = 'bad' with reason "no recipe coverage"
- If `severity = 'unknown'` (no per-item POS): badge is gray "POS data needed"
- Multi-location aware: respects current location switcher
- Single-location tenants see no UX change beyond the new tab

---

## Tests — `tests/e2e/tests/08-variance.spec.js`

1. Setup: for tenant Tony's Test, create 2 inventory items (Mozzarella lb @ $4, Flour lb @ $0.50), 1 menu item (Cheese Pizza $14), 1 recipe linked to that menu item with ingredients (8oz mozzarella, 12oz flour).
2. Create count A (beginning): mozzarella 50 lb, flour 100 lb. Finalize.
3. Insert 10 pos_line_items rows for Cheese Pizza in window between A and B.
4. Insert 1 invoice line: 20 lb mozzarella received.
5. Create count B (ending): mozzarella 60 lb, flour 91 lb. Finalize.
6. Call `compute_variance_report` from A to B.
7. Assert: theoretical mozzarella = 10 × 0.5 lb = 5 lb; actual = 50 + 20 - 60 = 10 lb; variance = +5 lb = +$20; severity = 'bad'.
8. Assert flour: theoretical = 10 × 0.75 lb = 7.5 lb; actual = 100 + 0 - 91 = 9 lb; variance = +1.5 lb; pct = 20% → 'bad'.
9. RLS: a different tenant's user calling `compute_variance_report` with these counts → expect error or empty.

---

## Verification checklist
1. `apply_migration` succeeds; `list_tables` shows 3 new tables.
2. `compute_variance_report` callable by authenticated, errors for anon.
3. All existing 39 Playwright tests still pass + new 08-variance passes.
4. Site loads at https://stationly.ai with Variance tab visible.
5. Cache bump to v5 forces clients to refresh.
6. Commit + push to `swagcitizen/restopsai-demo` master.
7. Update `/home/user/workspace/stationly-feature-list.md` and `stationly-benchmark.md` to mark TvA ✅.
8. Save release notes to `/home/user/workspace/restopsai-app/VARIANCE-RELEASE-NOTES.md`.

---

## Out of scope (deferred)
- Auto-suggest ideal counts based on par
- Multi-period trend chart for variance (we'll add later)
- Email/SMS variance digest (uses existing `notify` edge function — quick follow-up)
- Recipe modifier/sub-recipe support (recursive BOM) — current schema is one-level
