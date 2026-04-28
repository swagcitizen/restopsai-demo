-- Alerts engine: tenant-scoped rules, delivery log, per-user subscriptions.
-- Powers daily briefings, sales pacing, labor threshold, callout, invoice variance,
-- inspection due, schedule reminders. SMS-first; channels extensible.

-- ---------------------------------------------------------------------------
-- 1. alert_rules — what to watch for, per tenant
-- ---------------------------------------------------------------------------
create table if not exists public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rule_key text not null,                     -- 'daily_briefing', 'sales_pacing', 'labor_threshold', 'invoice_variance', 'inspection_due', 'callout', 'shift_reminder'
  is_enabled boolean not null default true,
  -- rule-specific config: thresholds, schedule, channels
  config jsonb not null default '{}'::jsonb,  -- e.g. { "labor_pct": 35, "send_at_local": "06:00", "tz": "America/New_York" }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, rule_key)
);

create index if not exists alert_rules_tenant_idx on public.alert_rules (tenant_id);

-- ---------------------------------------------------------------------------
-- 2. alert_subscriptions — which users get which alerts, on which channels
-- ---------------------------------------------------------------------------
create table if not exists public.alert_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_key text not null,                     -- matches alert_rules.rule_key
  channels text[] not null default '{sms}',   -- {sms, email, push, inapp}
  phone text,                                 -- E.164; cached for SMS delivery
  email text,                                 -- cached for email delivery
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id, rule_key)
);

create index if not exists alert_subs_tenant_idx on public.alert_subscriptions (tenant_id);
create index if not exists alert_subs_user_idx on public.alert_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- 3. alert_events — delivery log: what fired, what was sent, status
-- ---------------------------------------------------------------------------
create table if not exists public.alert_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rule_key text not null,
  severity text not null default 'info',      -- 'info', 'warn', 'critical'
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb, -- snapshot of metrics that triggered it
  -- delivery
  channels_attempted text[] not null default '{}',
  channels_succeeded text[] not null default '{}',
  recipient_count integer not null default 0,
  sms_count integer not null default 0,
  email_count integer not null default 0,
  -- audit
  created_at timestamptz not null default now(),
  -- in-app dismissal
  read_at timestamptz,
  read_by uuid references auth.users(id) on delete set null
);

create index if not exists alert_events_tenant_created_idx on public.alert_events (tenant_id, created_at desc);
create index if not exists alert_events_unread_idx on public.alert_events (tenant_id, read_at) where read_at is null;

-- ---------------------------------------------------------------------------
-- 4. RLS — only tenant members can see their alerts
-- ---------------------------------------------------------------------------
alter table public.alert_rules enable row level security;
alter table public.alert_subscriptions enable row level security;
alter table public.alert_events enable row level security;

-- alert_rules: owners/managers can read+write, staff read-only
drop policy if exists alert_rules_member_select on public.alert_rules;
create policy alert_rules_member_select on public.alert_rules for select
  using (exists (
    select 1 from public.memberships m
    where m.tenant_id = alert_rules.tenant_id and m.user_id = auth.uid()
  ));

drop policy if exists alert_rules_owner_write on public.alert_rules;
create policy alert_rules_owner_write on public.alert_rules for all
  using (exists (
    select 1 from public.memberships m
    where m.tenant_id = alert_rules.tenant_id
      and m.user_id = auth.uid()
      and m.role in ('owner','manager')
  ))
  with check (exists (
    select 1 from public.memberships m
    where m.tenant_id = alert_rules.tenant_id
      and m.user_id = auth.uid()
      and m.role in ('owner','manager')
  ));

-- alert_subscriptions: users manage their own; owners/managers can manage everyone's
drop policy if exists alert_subs_self on public.alert_subscriptions;
create policy alert_subs_self on public.alert_subscriptions for all
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.memberships m
      where m.tenant_id = alert_subscriptions.tenant_id
        and m.user_id = auth.uid()
        and m.role in ('owner','manager')
    )
  )
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.memberships m
      where m.tenant_id = alert_subscriptions.tenant_id
        and m.user_id = auth.uid()
        and m.role in ('owner','manager')
    )
  );

-- alert_events: any tenant member can read; only service role inserts (via edge fn)
drop policy if exists alert_events_member_select on public.alert_events;
create policy alert_events_member_select on public.alert_events for select
  using (exists (
    select 1 from public.memberships m
    where m.tenant_id = alert_events.tenant_id and m.user_id = auth.uid()
  ));

drop policy if exists alert_events_member_update_read on public.alert_events;
create policy alert_events_member_update_read on public.alert_events for update
  using (exists (
    select 1 from public.memberships m
    where m.tenant_id = alert_events.tenant_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.memberships m
    where m.tenant_id = alert_events.tenant_id and m.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- 5. Seed default rules for a tenant (called from trigger)
-- ---------------------------------------------------------------------------
create or replace function public.seed_default_alert_rules(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.alert_rules (tenant_id, rule_key, is_enabled, config) values
    (p_tenant_id, 'daily_briefing', true,
      '{"send_at_local":"06:00","tz":"America/New_York"}'::jsonb),
    (p_tenant_id, 'sales_pacing', true,
      '{"check_at_local":"19:00","tz":"America/New_York","threshold_pct":-20}'::jsonb),
    (p_tenant_id, 'labor_threshold', true,
      '{"max_labor_pct":35}'::jsonb),
    (p_tenant_id, 'invoice_variance', true,
      '{"variance_pct":15,"window_weeks":4}'::jsonb),
    (p_tenant_id, 'inspection_due', true,
      '{"days_before":14}'::jsonb),
    (p_tenant_id, 'callout', true,
      '{}'::jsonb),
    (p_tenant_id, 'shift_reminder', true,
      '{"hours_before":2}'::jsonb)
  on conflict (tenant_id, rule_key) do nothing;
end;
$$;

-- Auto-seed default rules on tenant insert
create or replace function public.tg_seed_alert_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_alert_rules(new.id);
  return new;
end;
$$;

drop trigger if exists trg_seed_alert_rules on public.tenants;
create trigger trg_seed_alert_rules
  after insert on public.tenants
  for each row execute function public.tg_seed_alert_rules();

-- Backfill existing tenants
do $$
declare t record;
begin
  for t in select id from public.tenants loop
    perform public.seed_default_alert_rules(t.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. RPC: get active alert events (unread first) for current tenant
-- ---------------------------------------------------------------------------
create or replace function public.get_my_alerts(p_tenant_id uuid, p_limit int default 50)
returns setof public.alert_events
language sql
security definer
set search_path = public
stable
as $$
  select * from public.alert_events
  where tenant_id = p_tenant_id
    and exists (
      select 1 from public.memberships m
      where m.tenant_id = p_tenant_id and m.user_id = auth.uid()
    )
  order by read_at nulls first, created_at desc
  limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- 7. RPC: mark alert as read
-- ---------------------------------------------------------------------------
create or replace function public.mark_alert_read(p_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.alert_events
  set read_at = now(), read_by = auth.uid()
  where id = p_alert_id
    and exists (
      select 1 from public.memberships m
      where m.tenant_id = alert_events.tenant_id and m.user_id = auth.uid()
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. updated_at trigger for alert_rules
-- ---------------------------------------------------------------------------
create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists trg_alert_rules_updated_at on public.alert_rules;
create trigger trg_alert_rules_updated_at
  before update on public.alert_rules
  for each row execute function public.tg_touch_updated_at();

grant execute on function public.get_my_alerts(uuid, int) to authenticated;
grant execute on function public.mark_alert_read(uuid) to authenticated;
grant execute on function public.seed_default_alert_rules(uuid) to authenticated;
