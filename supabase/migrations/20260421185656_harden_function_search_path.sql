-- Migration: harden_function_search_path
-- Version: 20260421185656
-- Pulled from production DB schema_migrations table

alter function public.set_updated_at() set search_path = public;
alter function public.apply_tenant_rls(text) set search_path = public;
;
