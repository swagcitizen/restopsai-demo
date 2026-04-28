-- Stripe billing schema for Stationly
-- One flat plan ("all-in") at $89/mo or $852/yr per location.
-- Demo tenant is exempt: row pinned to status='active' with far-future period.
--
-- Two tables:
--   subscriptions    one row per tenant (upserted by webhook)
--   billing_events   append-only audit log; stripe_event_id unique = idempotency

create extension if not exists "pgcrypto";

-- ---------- subscriptions -------------------------------------------------

create table if not exists public.subscriptions (
  tenant_id              uuid primary key references public.tenants(id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text unique,
  status                 text not null default 'trialing',
  -- canonical statuses: trialing, active, past_due, canceled, unpaid, incomplete, incomplete_expired
  plan                   text not null default 'allin',
  billing_interval       text not null default 'month' check (billing_interval in ('month','year')),
  quantity               int  not null default 1 check (quantity >= 1),
  current_period_end     timestamptz,
  cancel_at_period_end   boolean default false,
  trial_ends_at          timestamptz,
  past_due_since         timestamptz,
  -- price ids (stored so client can render the right toggle without env access)
  current_price_id       text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists subscriptions_status_idx
  on public.subscriptions(status);
create index if not exists subscriptions_period_end_idx
  on public.subscriptions(current_period_end);

-- updated_at trigger
create or replace function public.subscriptions_touch_updated()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch
  before update on public.subscriptions
  for each row execute function public.subscriptions_touch_updated();

-- RLS
alter table public.subscriptions enable row level security;

drop policy if exists subscriptions_member_read on public.subscriptions;
create policy subscriptions_member_read on public.subscriptions
  for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = subscriptions.tenant_id
        and m.user_id   = auth.uid()
    )
  );

-- No insert/update/delete for end users. Service role bypasses RLS.
-- (Edge Functions run with the service-role key.)

-- Auto-create a row when a tenant is created (so client can always read one).
-- Demo tenant gets a permanent active row via separate UPDATE below.
create or replace function public.create_subscription_for_new_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions (tenant_id, status, trial_ends_at)
  values (new.id, 'trialing', now() + interval '14 days')
  on conflict (tenant_id) do nothing;
  return new;
end $$;

drop trigger if exists tenants_create_subscription on public.tenants;
create trigger tenants_create_subscription
  after insert on public.tenants
  for each row execute function public.create_subscription_for_new_tenant();

-- Backfill: every existing tenant gets a row.
insert into public.subscriptions (tenant_id, status, trial_ends_at)
select t.id, 'trialing', now() + interval '14 days'
from public.tenants t
where not exists (select 1 from public.subscriptions s where s.tenant_id = t.id);

-- Demo tenant: pin to active forever.
update public.subscriptions
set status               = 'active',
    plan                 = 'allin',
    billing_interval     = 'month',
    current_period_end   = '2099-01-01'::timestamptz,
    trial_ends_at        = null,
    past_due_since       = null,
    cancel_at_period_end = false
where tenant_id = 'a2e00ee7-1f30-4fbd-86b9-e560fc062f72';

-- ---------- billing_events (audit log) -----------------------------------

create table if not exists public.billing_events (
  id                bigserial primary key,
  tenant_id         uuid references public.tenants(id) on delete cascade,
  stripe_event_id   text unique,
  type              text not null,
  livemode          boolean,
  payload           jsonb,
  processed_at      timestamptz not null default now()
);

create index if not exists billing_events_tenant_idx
  on public.billing_events(tenant_id, processed_at desc);
create index if not exists billing_events_type_idx
  on public.billing_events(type);

alter table public.billing_events enable row level security;

drop policy if exists billing_events_owner_read on public.billing_events;
create policy billing_events_owner_read on public.billing_events
  for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = billing_events.tenant_id
        and m.user_id   = auth.uid()
        and m.role in ('owner','manager')
    )
  );

-- ---------- helper view: tenant_billing_status --------------------------
-- Single read for the client. Encapsulates "is this tenant allowed to use the app?"

create or replace view public.tenant_billing_status as
select
  s.tenant_id,
  s.status,
  s.plan,
  s.billing_interval,
  s.quantity,
  s.current_period_end,
  s.cancel_at_period_end,
  s.trial_ends_at,
  s.past_due_since,
  s.current_price_id,
  s.stripe_customer_id,
  -- effective access: trialing/active are unrestricted; past_due gets 7-day grace.
  case
    when s.tenant_id = 'a2e00ee7-1f30-4fbd-86b9-e560fc062f72' then true
    when s.status in ('trialing','active') then true
    when s.status = 'past_due'
      and s.past_due_since is not null
      and s.past_due_since > (now() - interval '7 days') then true
    else false
  end as access_ok,
  -- show banner for trialing or past_due
  case
    when s.status = 'trialing' and s.trial_ends_at is not null then 'trial'
    when s.status = 'past_due' then 'past_due'
    when s.status in ('canceled','unpaid','incomplete_expired') then 'lapsed'
    else null
  end as banner
from public.subscriptions s;

grant select on public.tenant_billing_status to authenticated;

-- ---------- helper RPC: get_my_billing_status ---------------------------
-- Convenience for the client to read its tenant's billing in one call.

create or replace function public.get_my_billing_status(p_tenant_id uuid)
returns public.tenant_billing_status
language sql stable security definer set search_path = public as $$
  select v.* from public.tenant_billing_status v
  where v.tenant_id = p_tenant_id
    and exists (
      select 1 from public.memberships m
      where m.tenant_id = p_tenant_id and m.user_id = auth.uid()
    )
  limit 1;
$$;

grant execute on function public.get_my_billing_status(uuid) to authenticated;

comment on table  public.subscriptions   is 'One row per tenant. Upserted by stripe-webhook edge function. Demo tenant pinned active.';
comment on table  public.billing_events  is 'Append-only Stripe webhook log. stripe_event_id unique = idempotency guard.';
comment on view   public.tenant_billing_status is 'Computed access state for a tenant. Demo + trialing/active = ok; past_due gets 7d grace.';
