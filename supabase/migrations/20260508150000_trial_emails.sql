-- Trial conversion email infrastructure (Phase 3).
--
-- Schedule:
--   day  0 — welcome
--   day  7 — value check-in
--   day 15 — first conversion ask (weekly cadence begins)
--   day 22 — second ask
--   day 27 — "3 days left"
--   day 29 — "tomorrow"
--   day 30 — "trial ended" (one-time)
--   on conversion — receipt
--
-- Each (tenant, kind) row is unique so the cron can be safely re-run.

-- ---------- 1. tenant_email_log ----------

create table if not exists public.tenant_email_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  recipient_email text not null,
  kind text not null,        -- 'welcome' | 'day7' | 'day15' | 'day22' | 'day27' | 'day29' | 'day30_expired' | 'receipt'
  subject text not null,
  resend_id text,            -- id returned by Resend API
  sent_at timestamptz not null default now(),
  error text,
  unique (tenant_id, kind)
);

create index if not exists tenant_email_log_tenant_idx on public.tenant_email_log(tenant_id);
create index if not exists tenant_email_log_kind_idx   on public.tenant_email_log(kind);

alter table public.tenant_email_log enable row level security;

-- Owners of a tenant can see their own email log; nobody can write through PostgREST.
drop policy if exists tenant_email_log_owner_read on public.tenant_email_log;
create policy tenant_email_log_owner_read on public.tenant_email_log
  for select to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.tenant_id = tenant_email_log.tenant_id
      and m.user_id = auth.uid()
      and m.role in ('owner','manager')
  ));

drop policy if exists tenant_email_log_no_writes on public.tenant_email_log;
create policy tenant_email_log_no_writes on public.tenant_email_log
  as restrictive for all to authenticated
  using (false) with check (false);

-- Service role bypasses RLS for the edge function writes.

-- ---------- 2. tenants table — last_conversion_email_at ----------
-- (Optional convenience; primary dedup is via tenant_email_log unique constraint)

alter table public.tenants
  add column if not exists last_conversion_email_at timestamptz;

-- ---------- 3. View: trialing tenants with owner email + days_into_trial ----------
-- Used by the cron edge function to decide which tenants to email today.

create or replace view public.trial_email_targets
with (security_invoker = false) as
select
  t.id            as tenant_id,
  t.name          as tenant_name,
  s.status,
  s.trial_ends_at,
  -- days into trial = (now - trial_started). subscriptions.trial_ends_at is
  -- 30 days after trial_started, so days_into_trial = 30 - days_left.
  greatest(0, 30 - greatest(0, ceil(extract(epoch from (s.trial_ends_at - now())) / 86400)::int))
    as days_into_trial,
  greatest(0, ceil(extract(epoch from (s.trial_ends_at - now())) / 86400)::int)
    as days_left,
  -- Pick the owner's email; fallback to first member.
  (select au.email
     from public.memberships m
     join auth.users au on au.id = m.user_id
    where m.tenant_id = t.id
    order by case when m.role = 'owner' then 0 when m.role = 'manager' then 1 else 2 end,
             m.created_at asc
    limit 1) as recipient_email
from public.tenants t
join public.subscriptions s on s.tenant_id = t.id
where s.status = 'trialing'
  and t.id != 'a2e00ee7-1f30-4fbd-86b9-e560fc062f72'::uuid;  -- demo never gets emails

-- View runs as definer (default for non-invoker views) — okay because it's
-- only readable via the service role from the edge function.
revoke all on public.trial_email_targets from public, anon, authenticated;
grant select on public.trial_email_targets to service_role;
