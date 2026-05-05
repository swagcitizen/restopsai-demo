# Stationly Release Notes — Theoretical vs Actual Variance (TvA)

**Shipped:** May 5, 2026
**Commit:** `feat(variance): theoretical vs actual usage with inventory counts and drill-down`
**Migration:** `add_variance_inventory_counts_and_engine` (+ follow-ups `add_compute_variance_report_rpc`, `add_finalize_inventory_count_rpc`)

---

## What this is
The single most-cited reason operators pick Restaurant365 over MarginEdge is its theoretical-vs-actual usage report. Stationly already had recipes, sales (aggregate), invoices, waste, and (since last week) commissary transfers. This release closes the loop with inventory counts and a SQL-side variance engine that produces a per-item TvA report comparable to R365's flagship.

For any window defined by two finalized counts, the system now reports per inventory item:

- **Theoretical usage** = `sum(recipe_ingredient.qty × menu_item_sold_count)` for everything sold in the window
- **Actual usage** = `beginning_count + purchases − ending_count` (purchases = invoice lines + commissary transfers in − transfers out)
- **Variance** = actual − theoretical, in units, dollars, and %
- Color-coded severity: green ≤ 2%, yellow ≤ 5%, red > 5%; red+"no recipe coverage" if theoretical = 0 but actual > 0; gray "POS data needed" if no per-item POS rows exist in the window

## Schema additions

### `inventory_counts`
Header rows for each count session. RLS:
- `select` via `is_tenant_member(tenant_id)`
- `insert/update/delete` via `is_tenant_manager_or_owner(tenant_id)`
- Index: `(tenant_id, location_id, counted_at desc)`

### `inventory_count_lines`
One row per item per count, with a generated `extended_cost` column. RLS scoped to the line's `tenant_id`. Indexes: `(tenant_id, inventory_item_id)`, `(count_id)`.

### `pos_line_items`
Per-item POS sales (the engine input that aggregate `pos_transactions` couldn't provide). RLS via `is_tenant_member`; manager+ writes. Indexes: `(tenant_id, sold_at desc)`, `(tenant_id, menu_item_id, sold_at desc)`.

## RPCs

### `compute_variance_report(p_tenant_id, p_location_id, p_start_count_id, p_end_count_id)`
- `SECURITY DEFINER`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO authenticated`
- Asserts `is_tenant_member(p_tenant_id)`; raises `42501` otherwise
- Validates both counts belong to the tenant and match the requested location (when given)
- Auto-swaps start/end if the caller passed them in reverse chronological order
- CTEs: beginning, ending, scope (items present in either count), inv_window (invoices in window), invoice_purchases (matched_inventory_id OR fuzzy by `lower(trim(raw_description))`), transfers_in, transfers_out, sales (per menu_item from `pos_line_items`), theoretical (sales × `recipe_ingredients` joined via `recipes.linked_menu_item_id` and `lower(trim(name))`), waste
- Per-item severity:
  - `good` if `|pct| ≤ 2`
  - `warn` if `|pct| ≤ 5`
  - `bad` if `|pct| > 5`
  - `bad` (reason `"No recipe coverage"`) if theoretical = 0 and actual > 0
  - `unknown` (reason `"No per-item POS data in window"`) if zero `pos_line_items` rows in the window — theoretical / variance fields are NULL in that case so the engine never errors

### `finalize_inventory_count(p_count_id)`
- Manager+ only; flips the count to `status = 'finalized'` and snapshots each line's `counted_qty` back into `inventory_items.on_hand` for the count's location
- `SECURITY DEFINER`, `REVOKE/GRANT` as above

## Frontend
- **New repos:** `countsRepo.js`, `varianceRepo.js` — every write wrapped in `offline.withOffline()` (mirrors `dataRepo.js` / `transfersRepo.js`)
- **Variance tab** added between Commissary and Alerts (sidebar; existing IA preserved)
- **KPI tiles:** Theoretical $, Actual $, Variance $, Variance % of actual
- **Inventory counts table:** status pills, line counts, totals, finalize/delete actions (manager+)
- **Count modal:** pre-fills every active inventory item with current `on_hand`; one-click "pre-fill from on-hand"; save as draft or save+finalize
- **Variance report:** From / To dropdowns of finalized counts; sortable table (default variance $ desc); per-row severity badges
- **Drill-down drawer:** beginning / + purchases / − ending / theoretical / waste summary plus contributing recipes, recent invoice lines, and recent waste logs (lazy-loaded)
- **CSV export** of the active report
- **Service worker** bumped from `v4` to `v5` with the new repos in PRECACHE_URLS

## Tests
- **New:** `tests/e2e/tests/08-variance.spec.js`
  - Seeds a fresh tenant, inventory items, menu item, recipe with two ingredients, 10 POS line items, an invoice line, two finalized counts
  - Asserts mozzarella variance = +5 lb / +$20 / `bad`
  - Asserts flour variance = +1.5 lb / 20% / `bad`
  - Asserts a different tenant's user calling `compute_variance_report` is blocked (`42501`) and cannot read counts
- **Baseline preserved:** 39 passing tests still pass; the 2 pre-failing auth tests (signup → onboarding flow) remain failing because email confirmation is enabled in production — same as before this release. Cross-tenant tests skip when signup doesn't return a token (same pattern as `07-commissary.spec.js`).

## Deferred / known limitations
- **Auto-suggest ideal counts** based on `par` — out of scope for v1.
- **Multi-period trend chart** for variance — coming next.
- **Email/SMS variance digest** — easy follow-up via the existing `notify` edge function.
- **Recursive BOM (sub-recipes / modifiers)** — current schema is one-level. Recipe-of-recipe will need a separate migration.
- **Aggregate-POS fallback** — when a tenant has only `pos_transactions` (no `pos_line_items`) the engine returns rows with `severity = 'unknown'` instead of erroring. The intent is the UI nudges them to enable per-item ingestion. A best-effort line-item extraction from `pos_transactions.raw->'line_items'` could be added later.

## Verification
- `apply_migration` succeeded for all three migrations
- `pg_class.relrowsecurity = true` confirmed for `inventory_counts`, `inventory_count_lines`, `pos_line_items`
- All RPCs exist with correct signatures and `REVOKE EXECUTE FROM PUBLIC; GRANT EXECUTE TO authenticated`
- Production deploy reachable; `app.html` payload contains the `data-view="variance"` nav button and section
- Service-worker cache version is `stationly-v5`
