-- ============================================================
-- Migration: security_hardening
-- Version:   20260508120000
-- Purpose:   Fix security issues identified in 2026-05-08 audit
--
-- Changes:
--   1. Revoke EXECUTE from anon on SECURITY DEFINER functions
--      that should require authentication.
--   2. Fix mutable search_path on trigger helper functions
--      (touch_locations_updated_at, touch_transfers_updated_at).
--
-- NOTE: The following functions intentionally retain anon EXECUTE
--   and are NOT touched:
--     - accept_invite(_token text)   -- invite link flow requires anon
--     - invite_preview(_token text)  -- invite preview requires anon
--     - create_tenant_and_membership -- sign-up onboarding flow
--     - leads_rate_ok                -- used in anon lead capture
--     - tg_notify_new_lead           -- trigger for anon lead insert
--
-- Backup gap (Free tier → no PITR) must be addressed in Supabase
-- dashboard by upgrading to Pro tier. No SQL fix possible.
-- ============================================================

-- ----------------------------------------------------------
-- 1. REVOKE anon EXECUTE on sensitive SECURITY DEFINER RPCs
-- ----------------------------------------------------------

-- Financial mutation functions — must never be callable by anon
REVOKE EXECUTE ON FUNCTION public.approve_bill(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_bill_payment(uuid, numeric, text, date, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reject_bill(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_bill_from_invoice(uuid, date) FROM anon;

REVOKE EXECUTE ON FUNCTION public.generate_pay_run(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_pay_period_paid(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.unlock_pay_period(uuid) FROM anon;

REVOKE EXECUTE ON FUNCTION public.mark_transfer_received(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_transfer_sent(uuid) FROM anon;

-- Data mutation functions — must require authentication
REVOKE EXECUTE ON FUNCTION public.finalize_inventory_count(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.compute_variance_report(uuid, uuid, uuid, uuid) FROM anon;

-- Dangerous admin/seeding functions — must require authentication
REVOKE EXECUTE ON FUNCTION public.clear_sample_data(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.seed_sample_data(uuid) FROM anon;

-- ----------------------------------------------------------
-- 2. Fix mutable search_path on SECURITY INVOKER trigger fns
--    (flagged by Supabase advisor lint 0011)
-- ----------------------------------------------------------

ALTER FUNCTION public.touch_locations_updated_at() SET search_path = public;
ALTER FUNCTION public.touch_transfers_updated_at() SET search_path = public;

-- ----------------------------------------------------------
-- Verification queries (run manually to confirm):
--
-- Check no anon grants remain on the revoked functions:
--   SELECT routine_name, grantee, privilege_type
--   FROM information_schema.routine_privileges
--   WHERE specific_schema = 'public'
--     AND grantee = 'anon'
--     AND routine_name IN (
--       'approve_bill','record_bill_payment','reject_bill',
--       'generate_bill_from_invoice','generate_pay_run',
--       'mark_pay_period_paid','unlock_pay_period',
--       'mark_transfer_received','mark_transfer_sent',
--       'finalize_inventory_count','compute_variance_report',
--       'clear_sample_data','seed_sample_data'
--     );
-- Expected: 0 rows
--
-- Check search_path is set:
--   SELECT proname, proconfig
--   FROM pg_proc
--   WHERE pronamespace = 'public'::regnamespace
--     AND proname IN ('touch_locations_updated_at','touch_transfers_updated_at');
-- Expected: proconfig contains 'search_path=public'
-- ----------------------------------------------------------
