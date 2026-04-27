-- Onboarding wizard state
-- One row per tenant tracks which step they've completed and the per-step
-- payloads. RLS: any tenant member can read, but only owner/manager can write.

create table if not exists public.tenant_onboarding (
  tenant_id        uuid primary key references public.tenants(id) on delete cascade,
  step_completed   int  not null default 0,           -- 0..6
  service_types    text[] not null default '{}',      -- dine-in, takeout, delivery, catering, drive-thru, counter
  open_days        text[] not null default '{}',      -- mon..sun
  avg_ticket       numeric(10,2),
  seats            int,
  address          text,
  timezone         text,
  license_expires_at date,
  finished_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists tenant_onboarding_step_idx
  on public.tenant_onboarding (step_completed);

-- Auto-update updated_at
create or replace function public.tenant_onboarding_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tenant_onboarding_touch_trg on public.tenant_onboarding;
create trigger tenant_onboarding_touch_trg
  before update on public.tenant_onboarding
  for each row execute function public.tenant_onboarding_touch();

-- RLS
alter table public.tenant_onboarding enable row level security;

drop policy if exists tenant_onboarding_select on public.tenant_onboarding;
create policy tenant_onboarding_select on public.tenant_onboarding
  for select using (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = tenant_onboarding.tenant_id
        and m.user_id = (select auth.uid())
    )
  );

drop policy if exists tenant_onboarding_insert on public.tenant_onboarding;
create policy tenant_onboarding_insert on public.tenant_onboarding
  for insert with check (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = tenant_onboarding.tenant_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'manager')
    )
  );

drop policy if exists tenant_onboarding_update on public.tenant_onboarding;
create policy tenant_onboarding_update on public.tenant_onboarding
  for update using (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = tenant_onboarding.tenant_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'manager')
    )
  ) with check (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = tenant_onboarding.tenant_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'manager')
    )
  );

-- Auto-create an onboarding row for every new tenant.
create or replace function public.create_tenant_onboarding_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tenant_onboarding (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;
  return new;
end;
$$;

drop trigger if exists tenants_create_onboarding_trg on public.tenants;
create trigger tenants_create_onboarding_trg
  after insert on public.tenants
  for each row execute function public.create_tenant_onboarding_row();

-- Backfill existing tenants
insert into public.tenant_onboarding (tenant_id, step_completed, finished_at)
select t.id, 6, now()
from public.tenants t
left join public.tenant_onboarding o on o.tenant_id = t.id
where o.tenant_id is null;
