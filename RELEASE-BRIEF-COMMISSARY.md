# Stationly Multi-Location Commissary — Build Brief

## Goal
Add multi-location commissary support to Stationly so multi-unit operators can run a central commissary kitchen that produces for N satellite locations. This is a strategic gap-close vs. Restaurant365 and xtraCHEF, and lays the foundation for franchise/chain customers.

This is a **production-grade** build: schema + RLS + indexes + UI + alerts + Playwright tests + deploy + commit.

## Repo
- Path: `/home/user/workspace/restopsai-app/`
- Live: https://stationly.ai
- Supabase project_id: `vmnhizmibdtlizigbzks`
- Push via `bash` with `api_credentials=["github"]`. Repo: `swagcitizen/restopsai-demo`, branch `master`.

## Current state (DO NOT BREAK)
- Today every tenant = one location implicitly. No `locations` table exists.
- Subscription `quantity` integer exists in `subscriptions` but isn't operationally tied to anything.
- All existing tenant-scoped tables (`menu_items`, `inventory_items`, `recipes`, `tasks`, `temperature_logs`, `prep_labels`, `time_clock_punches`, `invoices`, `employees`, etc.) have `tenant_id` only, no `location_id`.
- Just shipped: full offline mode + tenant CRUD. Don't undo any of that.

## Architecture decisions

1. **Add a `locations` table.** A tenant can have N locations (default 1). On migration, every existing tenant gets exactly one auto-created "primary" location.
2. **Optional `location_id` on operational tables.** New nullable `location_id` columns on inventory_items, prep_labels, tasks, temperature_logs, time_clock_punches, employees. NULL = "applies to all locations" (acts as a tenant-wide row). Indexed.
3. **Recipes + menu_items stay tenant-level (shared across all locations).** Commissary's whole point is centralized recipes.
4. **Commissary flag:** one location per tenant can be `is_commissary = true`. Optional — small operators don't need it.
5. **Transfers table:** ships inventory + prep batches from commissary → satellite locations.
6. **No subscription-pricing change yet.** Locations are free in this release; we'll wire to Stripe `quantity` in a follow-up so we don't risk breaking billing today.

## Schema (apply via migration `add_multi_location_commissary`)

```sql
-- locations: a tenant can have N locations
CREATE TABLE IF NOT EXISTS locations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  address_line1 text,
  city          text,
  state         text,
  postal_code   text,
  timezone      text,
  is_commissary boolean NOT NULL DEFAULT false,
  is_primary    boolean NOT NULL DEFAULT false,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- one primary per tenant
CREATE UNIQUE INDEX IF NOT EXISTS uniq_locations_primary_per_tenant
  ON locations(tenant_id) WHERE is_primary = true;
-- one commissary per tenant (optional — partial unique)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_locations_commissary_per_tenant
  ON locations(tenant_id) WHERE is_commissary = true;

CREATE INDEX IF NOT EXISTS idx_locations_tenant ON locations(tenant_id);

-- backfill: one primary location per existing tenant
INSERT INTO locations (tenant_id, name, city, state, timezone, is_primary, is_commissary)
SELECT id, COALESCE(name, 'Main Location'), city, state, timezone, true, false
FROM tenants
WHERE deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM locations WHERE locations.tenant_id = tenants.id);

-- transfers: commissary → satellite
CREATE TABLE IF NOT EXISTS commissary_transfers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_location_id uuid NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  to_location_id   uuid NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','received','cancelled')),
  scheduled_for   date,
  sent_at         timestamptz,
  received_at     timestamptz,
  notes           text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transfers_tenant_status ON commissary_transfers(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_transfers_to_loc ON commissary_transfers(to_location_id);

CREATE TABLE IF NOT EXISTS commissary_transfer_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id     uuid NOT NULL REFERENCES commissary_transfers(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  recipe_id       uuid REFERENCES recipes(id) ON DELETE SET NULL,
  -- one of inventory_item_id / recipe_id should be set; recipe_id used for prep batches
  description     text NOT NULL,
  qty             numeric NOT NULL DEFAULT 0,
  unit            text,
  unit_cost       numeric NOT NULL DEFAULT 0,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transfer_lines_transfer ON commissary_transfer_lines(transfer_id);

-- Add optional location_id to operational tables
ALTER TABLE inventory_items     ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE prep_labels         ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE tasks               ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE temperature_logs    ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE time_clock_punches  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE employees           ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_items_location ON inventory_items(location_id);
CREATE INDEX IF NOT EXISTS idx_prep_labels_location ON prep_labels(location_id);
CREATE INDEX IF NOT EXISTS idx_tasks_location ON tasks(location_id);
CREATE INDEX IF NOT EXISTS idx_temp_logs_location ON temperature_logs(location_id);
CREATE INDEX IF NOT EXISTS idx_clock_punches_location ON time_clock_punches(location_id);
CREATE INDEX IF NOT EXISTS idx_employees_location ON employees(location_id);
```

## RLS

```sql
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY locations_read ON locations FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY locations_mgr_write ON locations FOR ALL USING (is_tenant_manager_or_owner(tenant_id)) WITH CHECK (is_tenant_manager_or_owner(tenant_id));

ALTER TABLE commissary_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY transfers_read ON commissary_transfers FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY transfers_mgr_write ON commissary_transfers FOR ALL USING (is_tenant_manager_or_owner(tenant_id)) WITH CHECK (is_tenant_manager_or_owner(tenant_id));

ALTER TABLE commissary_transfer_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY transfer_lines_read ON commissary_transfer_lines FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY transfer_lines_mgr_write ON commissary_transfer_lines FOR ALL USING (is_tenant_manager_or_owner(tenant_id)) WITH CHECK (is_tenant_manager_or_owner(tenant_id));
```

## RPCs

```sql
-- Mark transfer sent: stamps sent_at, sets status='sent'.
CREATE OR REPLACE FUNCTION mark_transfer_sent(p_transfer_id uuid)
RETURNS commissary_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE r commissary_transfers;
BEGIN
  UPDATE commissary_transfers
    SET status = 'sent', sent_at = now(), updated_at = now()
    WHERE id = p_transfer_id AND is_tenant_manager_or_owner(tenant_id)
    RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Transfer not found or insufficient permissions'; END IF;
  RETURN r;
END $$;
REVOKE EXECUTE ON FUNCTION mark_transfer_sent(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_transfer_sent(uuid) TO authenticated, service_role;

-- Mark transfer received: stamps received_at, sets status='received', and decrements/increments inventory.
CREATE OR REPLACE FUNCTION mark_transfer_received(p_transfer_id uuid)
RETURNS commissary_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE r commissary_transfers; ln record;
BEGIN
  UPDATE commissary_transfers
    SET status='received', received_at=now(), updated_at=now()
    WHERE id=p_transfer_id AND is_tenant_manager_or_owner(tenant_id)
    RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Transfer not found or insufficient permissions'; END IF;
  -- Adjust inventory on hand for the destination location's matching items
  FOR ln IN SELECT * FROM commissary_transfer_lines WHERE transfer_id = p_transfer_id LOOP
    IF ln.inventory_item_id IS NOT NULL THEN
      UPDATE inventory_items SET on_hand = on_hand + ln.qty, updated_at = now()
        WHERE id = ln.inventory_item_id;
    END IF;
  END LOOP;
  RETURN r;
END $$;
REVOKE EXECUTE ON FUNCTION mark_transfer_received(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_transfer_received(uuid) TO authenticated, service_role;
```

## App-level changes

### `tenantContext.js`
Currently exposes `currentTenantId`. Add:
- `currentLocationId` (selected location; default = primary)
- `setCurrentLocation(id)` (persists in localStorage scoped per tenant)
- `getLocations()` — fetches and caches list

### New repo: `locationsRepo.js`
- `fetchLocations()`
- `addLocation({name, addressLine1, city, state, postalCode, timezone, isCommissary})` — accepts isPrimary internally
- `updateLocation(id, patch)`
- `deleteLocation(id)` — block if it's the only/primary location
- All wrapped via `offline.withOffline` for offline support.

### New repo: `transfersRepo.js`
- `fetchTransfers({status, limit})`
- `createTransfer({fromLocationId, toLocationId, scheduledFor, notes})`
- `addTransferLine(transferId, {inventoryItemId, recipeId, description, qty, unit, unitCost, notes})`
- `removeTransferLine(lineId)`
- `markSent(transferId)` → calls RPC
- `markReceived(transferId)` → calls RPC
- `cancelTransfer(transferId)`

### UI

1. **Locations tab** (NEW nav item, between "Team & Invites" and "Alerts"):
   - List of locations with primary/commissary flags, address, status.
   - "Add location" modal.
   - Edit + delete buttons. Cannot delete primary; cannot delete a location with active transfers.
   - Toggle commissary (only one allowed per tenant).

2. **Location switcher** in app header (next to connection pill):
   - Dropdown showing all tenant locations + "All locations" option.
   - Persists to localStorage. Other tabs filter by `currentLocationId` when set.
   - If tenant has only one location, hide the switcher entirely (no UI change for single-location operators).

3. **Inventory tab**: when a location is selected, filter rows by `location_id = current OR location_id IS NULL`. New items default to current location_id (or NULL if "All").

4. **Commissary Transfers tab** (NEW, only visible if tenant has a commissary):
   - Table of transfers (most recent first): from → to, status, line count, total cost, scheduled date.
   - "New transfer" → modal: pick to_location, scheduled_for, notes. Then Add Lines.
   - Add line: pick inventory item OR recipe (radio), qty, unit. Auto-fills unit_cost from inventory_items.
   - Status flow: draft → sent → received. Buttons: "Mark sent" (commissary), "Mark received" (destination). Cancel.
   - Receive triggers inventory increment via RPC.

5. **Tasks / Prep Labels / Temp Logs / Time Clock**: when a location is selected, scope writes to it. When "All locations", show all but show a Location column.

### Alerts integration
Add seed alert rules in `tg_seed_alert_rules` extension or a new migration:
- "Transfer overdue": transfer in `sent` status > 24h without `received_at`.
- "Commissary par low": when an inventory_item at the commissary drops below par (already covered by existing par alerts; ensure they fire per-location now).

If alerts schema doesn't make this trivial, ship a simple cron/SQL-based alerts entry instead. Keep it pragmatic.

### Onboarding
- After tenant creation, the existing "primary location" auto-created in migration is enough. No onboarding flow change required.

## Tests

`tests/e2e/tests/07-commissary.spec.js` — using `request` fixture + raw fetch (no supabase-js due to ws issue):
1. Sign up two users on two new tenants.
2. Tenant A: create a 2nd location, mark it commissary, create a transfer with 2 lines.
3. Verify tenant B cannot see tenant A's locations or transfers (RLS).
4. Mark transfer received, verify inventory on_hand incremented.

`tests/e2e/tests/02-app-navigation.spec.js` — add `locations` and `transfers` to the nav list.

## Style
- Match cocoa #1c1a15, cream #faf5ea, orange #e8a33d, Source Serif + Inter.
- Reuse existing modal/button/table classes.
- Status badges: draft (slate), sent (orange), received (green), cancelled (muted).

## Verification before declaring done
- [ ] Migration applied; `locations` table populated for all 3 existing tenants
- [ ] Existing tenants still work normally (single-location UX unchanged — no switcher, no Transfers tab)
- [ ] Add a 2nd location in QA, switcher appears, can scope inventory by location
- [ ] Mark one location as commissary, Transfers tab appears
- [ ] Create + send + receive a transfer; verify inventory on_hand updated
- [ ] RLS blocks cross-tenant reads on `locations`, `commissary_transfers`, `commissary_transfer_lines`
- [ ] Run advisor again — no new warnings
- [ ] All existing Playwright tests still pass + new commissary spec passes
- [ ] Deploy via `deploy_website` to stationly.ai
- [ ] Commit + push to GitHub. Message: "feat(commissary): multi-location + commissary transfers with location-scoped inventory and tasks"
- [ ] Update `stationly-feature-list.md` and `stationly-benchmark.md` to mark commissary ✅ instead of ❌

## Non-goals (explicitly out of scope)
- Per-location billing / Stripe quantity sync — follow-up release
- Cross-location P&L consolidation — follow-up
- Mobile-app native shell — already PWA-installable
- Recipe-as-product (commissary makes prep batches that satellites consume) — basic version via `recipe_id` on transfer line is enough; full BOM rollups are future work
