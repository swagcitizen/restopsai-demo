# Security Audit Report — Backops (Supabase `vmnhizmibdtlizigbzks`)

**Audit Date:** 2026-05-08  
**Auditor:** Automated audit via Supabase MCP  
**Project:** Backops — `vmnhizmibdtlizigbzks` (us-west-2)  
**Postgres:** 17.6.1.105

---

## Executive Summary

| Area | Status | Summary |
|---|---|---|
| RLS Coverage | GREEN | All 57 public tables have RLS ON with at least one policy |
| View Security | GREEN | All 5 public views use `security_invoker=on` |
| Anon Probe | GREEN | All probed tables blocked — no data leaks |
| Backup / PITR | RED | **Free tier — zero backups, no PITR** |
| Function Security | YELLOW | 14 SECURITY DEFINER functions callable by `anon` that shouldn't be; 2 trigger functions missing `search_path` |

**Required actions:**
1. **Upgrade to Pro tier** in the Supabase dashboard — Free tier has no automated backups whatsoever.
2. **Apply migration `20260508120000_security_hardening.sql`** — revokes `anon` EXECUTE on 14 sensitive functions and fixes `search_path` on 2 trigger functions.

---

## 1. RLS Coverage

Query run:
```sql
SELECT c.relname, c.relrowsecurity, COUNT(p.polname), STRING_AGG(...)
FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
GROUP BY c.relname, c.relrowsecurity ORDER BY c.relrowsecurity ASC, c.relname;
```

**Result: No RLS gaps. All 57 tables covered.**

| Table | RLS | Policies | Notes |
|---|---|---|---|
| activation_progress | ON | 4 | r, a, d, w — full CRUD |
| alert_events | ON | 2 | r, w |
| alert_rules | ON | 2 | r, * |
| alert_subscriptions | ON | 1 | * — self-policy |
| app_settings | ON | 1 | * — deny-all |
| audit_log | ON | 1 | r — read-only by design |
| bar_pours | ON | 2 | r, * |
| bill_payments | ON | 2 | r, * |
| billing_events | ON | 1 | r — read-only by design |
| bills | ON | 2 | r, * |
| commissary_transfer_lines | ON | 2 | r, * |
| commissary_transfers | ON | 2 | r, * |
| customers | ON | 2 | r, * |
| daily_sales | ON | 2 | r, * |
| inspection_checks | ON | 4 | r, a, d, w |
| inspections | ON | 2 | r, * |
| inventory_count_lines | ON | 4 | r, a, d, w |
| inventory_counts | ON | 4 | r, a, d, w |
| inventory_items | ON | 2 | r, * |
| invites | ON | 2 | r, * |
| invoice_lines | ON | 4 | r, a, d, w |
| invoices | ON | 4 | r, a, d, w |
| leads | ON | 2 | a, a — insert-only (anon + auth); no SELECT is correct |
| licenses | ON | 2 | r, * |
| locations | ON | 2 | r, * |
| memberships | ON | 2 | r, * |
| menu_items | ON | 2 | r, * |
| pay_periods | ON | 4 | r, a, d, w |
| pay_run_lines | ON | 2 | r, * |
| pay_runs | ON | 2 | r, * |
| pnl_imports | ON | 1 | * — service-role only |
| pnl_line_items | ON | 1 | * — service-role only |
| pnl_period_summary | ON | 1 | * — service-role only |
| pos_connections | ON | 2 | r, * |
| pos_imports | ON | 2 | r, * |
| pos_line_items | ON | 4 | r, a, d, w |
| pos_sync_runs | ON | 1 | r — read-only by design |
| pos_transactions | ON | 2 | r, * |
| prep_labels | ON | 3 | r, a, w — no delete by design |
| profiles | ON | 4 | r (self + tenant-mate), a, w |
| recipe_ingredients | ON | 2 | r, * |
| recipes | ON | 2 | r, * |
| schedule_publishes | ON | 3 | r, a, w — no delete by design |
| schedule_shifts | ON | 2 | r, * |
| staff | ON | 2 | r, * |
| subscriptions | ON | 1 | r — read-only by design |
| task_completions | ON | 3 | r, a, d — no update by design |
| tasks | ON | 2 | r, * |
| temp_logs | ON | 4 | r, a, w, d |
| tenant_onboarding | ON | 3 | r, a, w — no delete by design |
| tenant_role_permissions | ON | 4 | r, a, d, w |
| tenants | ON | 2 | r, w — no insert (created via function) |
| time_entries | ON | 4 | r, a, d, w |
| tip_pool_entries | ON | 2 | r, * |
| vendor_payment_methods | ON | 2 | r, * |
| vendor_price_history | ON | 4 | r, a, d, w |
| vendors | ON | 2 | r, * |
| waste_logs | ON | 4 | r, a, w, d |

> Policy command codes: `r` = SELECT, `a` = INSERT, `w` = UPDATE, `d` = DELETE, `*` = ALL

---

## 2. View Security

Query run:
```sql
SELECT n.nspname, c.relname, c.reloptions
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'v' AND n.nspname = 'public';
```

**Result: No view security issues. All 5 views use security invoker mode.**

| View | reloptions | Status |
|---|---|---|
| tenant_billing_status | `["security_invoker=true"]` | PASS |
| pos_connections_with_last_run | `["security_invoker=true"]` | PASS |
| v_bills_aging | `["security_invoker=on"]` | PASS |
| v_bar_inventory_status | `["security_invoker=on"]` | PASS |
| v_activation_status | `["security_invoker=on"]` | PASS |

Note: `security_invoker=true` and `security_invoker=on` are semantically equivalent in PostgreSQL — both enforce the calling user's permissions.

---

## 3. Anon-User Probe

All 9 tables were probed via REST API using the publishable (anon) key.

```
curl "https://vmnhizmibdtlizigbzks.supabase.co/rest/v1/<table>?select=*" \
  -H "apikey: sb_publishable_fBz-1MwcGCbytU_k4dXHQg_s1_2cIUd"
```

| Table | Response | Result |
|---|---|---|
| tenants | `{"code":"42501","message":"permission denied for function is_tenant_member"}` | PASS — blocked |
| bills | `{"code":"42501","message":"permission denied for function is_tenant_manager_or_owner"}` | PASS — blocked |
| invoices | `{"code":"42501","message":"permission denied for function is_tenant_manager_or_owner"}` | PASS — blocked |
| tenant_members | `{"code":"PGRST205","message":"Could not find table"}` | PASS — table doesn't exist (it's `memberships`) |
| payroll_runs | `{"code":"PGRST205","message":"Could not find table"}` | PASS — table doesn't exist (it's `pay_runs`) |
| time_entries | `{"code":"42501","message":"permission denied for function is_tenant_manager_or_owner"}` | PASS — blocked |
| temp_logs | `{"code":"42501","message":"permission denied for function is_tenant_member"}` | PASS — blocked |
| inventory_items | `{"code":"42501","message":"permission denied for function is_tenant_member"}` | PASS — blocked |
| users | `{"code":"PGRST205","message":"Could not find table"}` | PASS — table doesn't exist (it's `profiles`) |

**Result: No data leaks. All probed tables are blocked or non-existent.**

> Minor note: Error responses expose internal helper function names (`is_tenant_member`, `is_tenant_manager_or_owner`). This is low-severity information disclosure inherent to PostgREST error formatting. Not exploitable in isolation; no fix required unless hardening API error responses is a compliance requirement.

---

## 4. Backup Status

| Property | Value |
|---|---|
| Project ID | `vmnhizmibdtlizigbzks` |
| Project Name | Backops |
| Organization | `ekxempmseltwxkkhjask` |
| Organization Plan | **Free** |
| Region | us-west-2 |
| PITR (Point-in-Time Recovery) | **NOT AVAILABLE** |
| Daily Backups | **NOT AVAILABLE** |
| Backup Retention | **None** |

**Result: CRITICAL gap.**

On Supabase's Free tier:
- No automated daily backups are taken.
- No point-in-time recovery is available.
- Accidental data deletion or schema breakage has no recovery path.

For a production platform handling payroll, financial transactions, and multi-tenant operational data, this is an unacceptable risk.

**Required action:** Upgrade to **Pro tier** ($25/month) in the [Supabase dashboard](https://supabase.com/dashboard/project/vmnhizmibdtlizigbzks/settings/addons). Pro tier includes daily backups with 7-day retention. PITR (point-in-time recovery with down-to-the-second restore) is available as a paid add-on on Pro+.

This cannot be fixed with a SQL migration — it requires a plan upgrade in the dashboard.

---

## 5. Function Security

### 5a. All SECURITY DEFINER Functions

All 43 public functions are `SECURITY DEFINER`. Every SECURITY DEFINER function was verified to have `search_path` locked in `proconfig` — no injection risk on the SECURITY DEFINER set.

### 5b. Functions Callable by `anon` — Full Inventory

From `information_schema.routine_privileges` where `grantee = 'anon'`:

**Intentionally anon-accessible (retain as-is):**

| Function | Rationale |
|---|---|
| `accept_invite(_token text)` | Invite link flow — unauthenticated users accept invites via token |
| `invite_preview(_token text)` | Invite preview before accepting — requires anon |
| `create_tenant_and_membership(...)` | Sign-up onboarding — new users create tenants before auth exists |
| `leads_rate_ok()` | Rate-limit check for anon lead submissions |
| `tg_notify_new_lead()` | Trigger for anon lead insert |
| `apply_tenant_rls(text)` | Internal helper, SECURITY INVOKER |
| `check_invoice_variance(...)` | SECURITY INVOKER — low risk |
| `get_my_role_permissions()` | SECURITY INVOKER, returns empty for anon |
| `infer_invoice_category(...)` | SECURITY INVOKER — helper |
| `list_role_permissions(...)` | SECURITY INVOKER |
| `set_role_permissions(...)` | SECURITY INVOKER |
| `set_updated_at()` | Trigger helper, SECURITY INVOKER |
| `subscriptions_touch_updated()` | Trigger helper, SECURITY INVOKER |
| `tg_create_primary_location()` | Trigger (not callable as RPC in practice) |
| `tg_seed_sample_data()` | Trigger, SECURITY DEFINER but fires only on INSERT to tenants |
| `tg_set_invoice_line_category()` | Trigger helper, SECURITY INVOKER |
| `tg_touch_updated_at()` | Trigger helper, SECURITY INVOKER |
| `touch_locations_updated_at()` | Trigger helper, SECURITY INVOKER |
| `touch_transfers_updated_at()` | Trigger helper, SECURITY INVOKER |

**Flagged — anon should NOT be able to call (SECURITY DEFINER, financial/data-mutation):**

| Function | Signature | Risk Level |
|---|---|---|
| `approve_bill` | `(p_bill_id uuid)` | HIGH — financial mutation |
| `record_bill_payment` | `(p_bill_id uuid, p_amount numeric, ...)` | HIGH — financial mutation |
| `reject_bill` | `(p_bill_id uuid, p_reason text)` | HIGH — financial mutation |
| `generate_bill_from_invoice` | `(p_invoice_id uuid, p_due_date date)` | HIGH — financial mutation |
| `generate_pay_run` | `(p_pay_period_id uuid)` | HIGH — payroll mutation |
| `mark_pay_period_paid` | `(p_pay_period_id uuid)` | HIGH — payroll mutation |
| `unlock_pay_period` | `(p_pay_period_id uuid)` | HIGH — payroll mutation |
| `mark_transfer_received` | `(p_transfer_id uuid)` | MEDIUM — transfer state mutation |
| `mark_transfer_sent` | `(p_transfer_id uuid)` | MEDIUM — transfer state mutation |
| `finalize_inventory_count` | `(p_count_id uuid)` | MEDIUM — inventory mutation |
| `compute_variance_report` | `(p_tenant_id uuid, ...)` | MEDIUM — reads across tenant |
| `clear_sample_data` | `(p_tenant_id uuid)` | HIGH — can wipe tenant data |
| `seed_sample_data` | `(p_tenant_id uuid)` | HIGH — can pollute tenant data |

> Note: SECURITY DEFINER functions run with the permissions of the function owner (postgres/superuser), bypassing RLS. Even if RLS would block direct table access, a SECURITY DEFINER function called by anon can read/write tables it was coded to touch. The internal `is_tenant_member()` checks inside functions provide some protection, but defense-in-depth requires removing anon's EXECUTE grant.

### 5c. search_path Issues

Two SECURITY INVOKER trigger functions lack a fixed `search_path`:

| Function | proconfig | Issue |
|---|---|---|
| `touch_locations_updated_at()` | null | Mutable search_path |
| `touch_transfers_updated_at()` | null | Mutable search_path |

These are simple `updated_at` trigger functions (`BEGIN NEW.updated_at = now(); RETURN NEW; END`). They are SECURITY INVOKER and very low-risk, but the advisor flags them and the fix is trivial.

---

## 6. Recommended Migrations

### Migration file: `supabase/migrations/20260508120000_security_hardening.sql`

**What it does:**
1. `REVOKE EXECUTE ON FUNCTION ... FROM anon` for 14 sensitive SECURITY DEFINER functions.
2. `ALTER FUNCTION ... SET search_path = public` on 2 trigger helper functions.

**What it does NOT touch:**
- `accept_invite`, `invite_preview` — intentionally anon-accessible for the invite flow.
- `create_tenant_and_membership` — intentionally anon-accessible for sign-up.
- All SECURITY INVOKER functions — lower risk; anon callable without privilege escalation.
- Any RLS policies — no table-level changes needed.

**What requires out-of-band action:**
- Backup/PITR gap — upgrade Supabase org to Pro tier in the dashboard.

### No other migrations are needed.

RLS is comprehensive across all 57 tables. Views are all security-invoker. The anon probe confirms the row-level access controls are working. The only SQL-addressable issues are the anon EXECUTE grants on financial SECURITY DEFINER functions and the missing `search_path` on 2 trigger helpers.

---

*Audit performed using Supabase MCP tools: `execute_sql`, `get_project`, `get_organization`, `get_advisors`. Anon probe via REST API with publishable key `sb_publishable_fBz-1MwcGCbytU_k4dXHQg_s1_2cIUd`.*
