-- Migration: trial_default_30_days
-- Version: 20260425111920
-- Pulled from production DB schema_migrations table

ALTER TABLE public.tenants ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '30 days');

-- Extend any currently-trialing tenants so existing trials become 30 days from creation
UPDATE public.tenants
   SET trial_ends_at = created_at + interval '30 days'
 WHERE subscription_status = 'trialing'
   AND trial_ends_at < (created_at + interval '30 days');
