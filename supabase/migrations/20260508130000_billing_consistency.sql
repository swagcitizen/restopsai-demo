-- ============================================================
-- Migration: billing_consistency
-- Version:   20260508130000
-- Purpose:   Fix billing E2E findings (P0 + P1)
--
-- Findings addressed:
--   P0: Trial duration mismatch — `tenants.trial_ends_at` defaults to 30
--       days but the subscriptions trigger and stripe-checkout edge function
--       used 14 days. Marketing copy advertises 30 days. Decision: 30 days
--       everywhere. Edge function fixed in stripe-checkout/index.ts.
--   P1: `tenants.stripe_customer_id` and `tenants.stripe_subscription_id`
--       were never set; webhook updated only the `subscriptions` table.
--       Fix: trigger that mirrors to `tenants` on insert/update.
-- ============================================================

-- ----------------------------------------------------------
-- 1. Update trigger: 14 -> 30 days
-- ----------------------------------------------------------
create or replace function public.create_subscription_for_new_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions (tenant_id, status, trial_ends_at)
  values (new.id, 'trialing', now() + interval '30 days')
  on conflict (tenant_id) do nothing;
  return new;
end $$;

-- ----------------------------------------------------------
-- 2. Backfill existing 14-day-shaped trials to 30 days
-- ----------------------------------------------------------
update public.subscriptions s
   set trial_ends_at = t.created_at + interval '30 days'
  from public.tenants t
 where s.tenant_id = t.id
   and s.status = 'trialing'
   and s.trial_ends_at is not null
   and s.trial_ends_at < (t.created_at + interval '30 days');

update public.tenants
   set trial_ends_at = created_at + interval '30 days'
 where subscription_status = 'trialing'
   and trial_ends_at is not null
   and trial_ends_at < (created_at + interval '30 days');

-- ----------------------------------------------------------
-- 3. Mirror subscriptions -> tenants (IDs + trial + status)
--    subscriptions.status is text; tenants.subscription_status is
--    the `subscription_status` enum (trialing/active/past_due/canceled/frozen).
--    Stripe also emits `incomplete`, `incomplete_expired`, `paused`, `unpaid`.
--    We map those conservatively to existing enum values.
-- ----------------------------------------------------------
create or replace function public.mirror_subscription_to_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  mapped_status public.subscription_status;
begin
  -- Map free-form Stripe statuses to our enum.
  mapped_status := case lower(coalesce(new.status, ''))
    when 'trialing'           then 'trialing'::public.subscription_status
    when 'active'             then 'active'::public.subscription_status
    when 'past_due'           then 'past_due'::public.subscription_status
    when 'unpaid'             then 'past_due'::public.subscription_status
    when 'canceled'           then 'canceled'::public.subscription_status
    when 'incomplete_expired' then 'canceled'::public.subscription_status
    when 'incomplete'         then 'frozen'::public.subscription_status
    when 'paused'             then 'frozen'::public.subscription_status
    else null
  end;

  update public.tenants
     set stripe_customer_id     = coalesce(new.stripe_customer_id, stripe_customer_id),
         stripe_subscription_id = coalesce(new.stripe_subscription_id, stripe_subscription_id),
         subscription_status    = coalesce(mapped_status, subscription_status),
         trial_ends_at          = coalesce(new.trial_ends_at, trial_ends_at)
   where id = new.tenant_id;

  return new;
end $$;

drop trigger if exists subscriptions_mirror_to_tenant on public.subscriptions;
create trigger subscriptions_mirror_to_tenant
  after insert or update on public.subscriptions
  for each row execute function public.mirror_subscription_to_tenant();

-- Defense-in-depth: trigger fns are not callable directly by clients anyway,
-- but make sure anon/public have no EXECUTE.
revoke execute on function public.mirror_subscription_to_tenant() from public;
revoke execute on function public.mirror_subscription_to_tenant() from anon;

-- ----------------------------------------------------------
-- 4. Backfill tenants.stripe_* from existing subscriptions
-- ----------------------------------------------------------
update public.tenants t
   set stripe_customer_id     = coalesce(s.stripe_customer_id, t.stripe_customer_id),
       stripe_subscription_id = coalesce(s.stripe_subscription_id, t.stripe_subscription_id)
  from public.subscriptions s
 where s.tenant_id = t.id
   and (
        (s.stripe_customer_id     is not null and t.stripe_customer_id     is distinct from s.stripe_customer_id)
     or (s.stripe_subscription_id is not null and t.stripe_subscription_id is distinct from s.stripe_subscription_id)
   );
