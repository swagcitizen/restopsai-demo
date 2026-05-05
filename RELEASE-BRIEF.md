# Stationly Gap-Close + Offline Mega-Release — Build Brief

## Goal
Make Stationly competitively superior to MarginEdge / R365 / xtraCHEF in three dimensions:
1. **Tenant-defined CRUD** — owners add their own menu items, inventory items, recipes (plate cost), and custom prep checklist tasks.
2. **Recipe / plate costing UI** — currently the #1 missing feature flagged in the benchmark.
3. **Full offline mode** — IndexedDB write queue + service worker + last-write-wins conflict policy + sync-on-reconnect. Every write across the app must work offline.

This is one shipped release. Do all three.

## Repo
- Path: `/home/user/workspace/restopsai-app/`
- Live: https://stationly.ai
- Supabase project_id: `vmnhizmibdtlizigbzks`
- Auth: existing `supabase` connector + `bash` with `api_credentials=["github"]` for push

## Schema (DO NOT MIGRATE — already exists)

```
menu_items(id, tenant_id, name, price, food_cost, category, active, sort_order, created_at, updated_at)
inventory_items(id, tenant_id, name, unit, on_hand, par, unit_cost, supplier, created_at, updated_at)
recipes(id, tenant_id, name, yield, menu_price, linked_menu_item_id, notes, created_at, updated_at)
recipe_ingredients(id, recipe_id, tenant_id, name, qty, unit, unit_cost, sort_order)
tasks(id, tenant_id, library_id, title, detail, frequency, category, severity, estimated_minutes, is_vendor, assigned_staff_id, active, created_at, updated_at)
   -- Custom tasks = tasks where library_id IS NULL.
   -- frequency enum: check existing values via execute_sql
```

RLS already correct: members read, managers/owners write. All table writes require `is_tenant_manager_or_owner(tenant_id)`.

## Existing repo functions (already in `dataRepo.js`)
- `fetchMenu`, `addMenuItem({name, price, cost, category})`, `updateMenuItem(id, patch)`, `seedMenuFromSample`
- `fetchInventory`, `updateInventoryItem(id, patch)`, `seedInventoryFromSample`
- `fetchRecipes`, `updateRecipeMenuPrice`, `updateRecipeIngredient`, `seedRecipesFromSample`
- `tasksRepo.refreshTasks`, `getTasks`, `toggleTaskCompletion`, `cycleTaskAssignee`

## Repo functions to ADD in dataRepo.js + tasksRepo.js
- `deleteMenuItem(id)`
- `addInventoryItem({name, unit, par, on_hand, unit_cost, supplier})`
- `deleteInventoryItem(id)`
- `addRecipe({name, yield, menuPrice, linkedMenuItemId})` returns id
- `deleteRecipe(id)`
- `addRecipeIngredient(recipeId, {name, qty, unit, unitCost, sortOrder})`
- `deleteRecipeIngredient(ingId)`
- `recalcRecipeCost(recipeId)` — returns `{plateCost, foodCostPct}` from current ingredient unit_cost × qty / yield
- `tasksRepo.addCustomTask({title, detail, frequency, category, severity, estimatedMinutes, assignedStaffId})`
- `tasksRepo.deleteCustomTask(id)` — only delete tasks with `library_id IS NULL`
- `tasksRepo.updateCustomTask(id, patch)`

## UI work (in `app.js` + `app.html` + `styles.css`)

### 1. Sales & Menu tab — menu items CRUD
- "Add menu item" button → modal with name, price, cost, category.
- Each row gets edit + delete buttons.
- Show profit margin column (price - cost) / price as %.

### 2. Inventory tab — inventory CRUD
- "Add inventory item" button → modal with name, unit, par, on_hand, unit_cost, supplier.
- Each row: edit (inline or modal) + delete.
- Sort by name; visual flag when on_hand < par.

### 3. Recipe Costing tab — recipes CRUD with ingredient picker
This is the BIG one. The Recipe Costing tab currently exists but has no Add UI.
- "Add recipe" button → modal: name, yield, menu_price, optional link to a menu_item.
- Recipe detail panel with:
  - Ingredient list (table: name, qty, unit, unit_cost, line_cost = qty × unit_cost)
  - "Add ingredient" → inline row with type-ahead pulling from `inventory_items` (auto-fills unit + unit_cost from inventory) OR free-text.
  - Live recalc: `plate_cost = sum(line_cost) / yield`, `food_cost_pct = plate_cost / menu_price`.
  - Color the food_cost_pct: <30% green, 30-35% yellow, >35% red.
- Delete recipe + delete ingredient row buttons.

### 4. Task Assignments tab — custom tasks CRUD
- "Add custom task" button → modal: title, detail, frequency (daily/weekly/monthly), category, severity, estimated_minutes, assigned_staff_id (dropdown from staff).
- Custom tasks (library_id IS NULL) get edit + delete buttons; library tasks (library_id NOT NULL) only show "active" toggle.

## Offline Architecture

### Module: `offlineQueue.js` (NEW)
- Use IndexedDB via plain API (no library — keep deps zero).
- Database name: `stationly-offline-v1`
- Two stores:
  - `pendingWrites` — queued mutations; key: auto-incrementing id; fields: `{id, table, op, payload, attempts, createdAt, tenantId, clientId}`
  - `cachedReads` — last-known data per table; key: `${tenantId}:${table}`; field: `{data, fetchedAt}`
- API:
  - `enqueue({table, op, payload, tenantId})` — `op` in `['insert','update','delete','rpc']`
  - `flush()` — drains queue when online; calls Supabase; on failure increments attempts (max 5) and retries with backoff
  - `cacheRead(table, data)` / `getCachedRead(table)`
  - `pendingCount()` — for UI badge
- `clientId` = `crypto.randomUUID()` set per browser; persisted in localStorage. Used as a `client_id` column-NOT-NEEDED tag in payload metadata (no schema change).

### Module: `connectionStatus.js` (NEW)
- Listen to `online`/`offline` events.
- Poll `${SUPABASE_URL}/rest/v1/` every 30s while "online" to detect captive portals or upstream issues.
- Expose `isOnline()` + emit `connection:change` events on document.
- Render a small status pill in the app header: green "Online", amber "Offline — N pending", with auto-refresh count.

### Service Worker (`sw.js` — UPDATE existing)
Strategies:
- **App shell** (HTML/CSS/JS/icons): cache-first, network-fallback, version-bumped on each release. List all `.js`, `.html`, `.css`, `.svg`, `manifest.webmanifest`.
- **Supabase REST GETs**: stale-while-revalidate. Cache with 1-day TTL. Tag with tenant.
- **Supabase REST writes (POST/PATCH/DELETE)**: pass-through to network; if `fetch` throws (offline), respond with a synthetic `{queued: true}` 202 and the page-level `dataRepo.js` will have already enqueued via `offlineQueue.enqueue`.
- **Edge functions**: pass-through, no caching.

Bump cache version (e.g. `STATIONLY_CACHE_V3`).

### Wire offline into every repo write
Every mutation in `dataRepo.js`, `tasksRepo.js`, `clockRepo.js`, `invitesRepo.js` must:
1. Try the network call.
2. On `TypeError: Failed to fetch` (offline) → enqueue + return optimistic value.
3. UI updates from local state immediately (optimistic).

Helper: a `withOffline(fn, fallback)` wrapper to keep code DRY.

### Conflict policy
- **Last-write-wins** on `updated_at` server-side. Client doesn't fight; trusts server result on flush.
- For inserts, use client-generated UUID via `crypto.randomUUID()` so offline-created rows have a stable id when they sync. Table PKs already default to `gen_random_uuid()` server-side, but if the client supplies an `id`, Supabase honors it — confirm by passing `id` in payload.
- For deletes that race against updates: deletes win.

### UI
- Connection pill in `#app-header` (top right next to alerts bell).
- Pending-sync count badge (e.g. "3 syncing…") with a click-to-flush action.
- Toast notifications: "Saved offline — will sync when reconnected" (amber) / "Synced 5 changes" (green).

## Tests (Playwright)
Add `tests/e2e/tests/06-offline-flow.spec.js`:
1. Sign in (use signup → onboarding → app).
2. `context.setOffline(true)`.
3. Navigate to Inventory → add an item.
4. Verify pill shows "Offline — 1 pending".
5. `context.setOffline(false)`.
6. Wait up to 15s for sync; verify pill returns to "Online" and item persists after reload.

## Deploy
- Update `sw.js` cache version FIRST so clients pick up the new shell.
- `deploy_website` to push live to stationly.ai.
- Commit + push all changes to GitHub via `bash` with `api_credentials=["github"]`. Repo: `swagcitizen/restopsai-demo`, branch master.

## Style
- Match existing CSS variables (cocoa, cream, orange, Source Serif + Inter).
- Modals reuse existing `.modal` pattern (search app.html for examples).
- Buttons: `.btn .btn-primary`, `.btn .btn-ghost`, `.btn .btn-danger` for destructive.

## Verification Checklist (run before declaring done)
- [ ] Add menu item via UI on prod, refresh, item still there
- [ ] Edit + delete menu item works
- [ ] Add inventory item, edit, delete
- [ ] Add recipe + ingredients, plate cost recalcs live, food cost % colored
- [ ] Add custom prep task with assignee, recurs correctly
- [ ] Disconnect network, add menu item, see pending pill, reconnect, item syncs
- [ ] Reload page while offline, dashboard still loads from cache
- [ ] Service worker registers, manifest valid, install prompt appears
- [ ] All Playwright tests pass (00-06 specs)
- [ ] No console errors during any flow
- [ ] GitHub push succeeded
