-- Migration: prep_labels
-- Version: 20260510183000
-- Food prep / day-dot labels (FDA Food Code 3-501.17 compliant)
--
-- NOTE: The prep_labels table already existed with a legacy schema.
-- This migration:
--   1. Creates prep_label_templates (new)
--   2. Alters prep_labels to add new columns (keeping legacy columns for backwards compat)
--   3. Adds indexes
--   4. Adds/replaces RLS policies on both tables
--   5. Creates the prep_labels_active convenience view

-- ─── 1. prep_label_templates ─────────────────────────────────────────────────

create table if not exists public.prep_label_templates (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  name                   text not null,
  category               text,
  default_shelf_life_hours int not null default 96,
  storage                text not null default 'refrigerated'
                           check (storage in ('refrigerated','frozen','dry','hot_hold')),
  allergens              text[] not null default '{}'::text[],
  instructions           text,
  inventory_item_id      uuid references public.inventory_items(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references auth.users(id) on delete set null,
  unique (tenant_id, name)
);

create index if not exists prep_label_templates_tenant_name
  on public.prep_label_templates (tenant_id, name);

-- ─── 2. Alter prep_labels — add new columns ──────────────────────────────────
-- Existing legacy columns kept: item, prep_type, prepped_by, prepped_by_user, use_by, voided_reason

alter table public.prep_labels
  add column if not exists template_id          uuid references public.prep_label_templates(id) on delete set null,
  add column if not exists item_name            text,
  add column if not exists use_by_at            timestamptz,
  add column if not exists prepped_by_initials  text,
  add column if not exists prepped_by_user_id   uuid references auth.users(id) on delete set null,
  add column if not exists storage              text not null default 'refrigerated'
                                                  check (storage in ('refrigerated','frozen','dry','hot_hold')),
  add column if not exists lot_number           text,
  add column if not exists batch_quantity       numeric,
  add column if not exists batch_unit           text,
  add column if not exists printed_at           timestamptz,
  add column if not exists void_reason          text;

-- Backfill new columns from legacy columns
update public.prep_labels set
  item_name           = coalesce(item_name, item),
  use_by_at           = coalesce(use_by_at, use_by),
  prepped_by_initials = coalesce(prepped_by_initials, left(coalesce(prepped_by,'??'), 3))
where item_name is null or use_by_at is null or prepped_by_initials is null;

-- ─── 3. Indexes ──────────────────────────────────────────────────────────────

create index if not exists prep_labels_tenant_prepped_at
  on public.prep_labels (tenant_id, prepped_at desc);

create index if not exists prep_labels_tenant_use_by_active
  on public.prep_labels (tenant_id, use_by_at)
  where voided_at is null;

-- ─── 4. Updated_at trigger ───────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists prep_label_templates_updated_at on public.prep_label_templates;
create trigger prep_label_templates_updated_at
  before update on public.prep_label_templates
  for each row execute function public.set_updated_at();

-- ─── 5. RLS ──────────────────────────────────────────────────────────────────

alter table public.prep_label_templates enable row level security;
alter table public.prep_labels          enable row level security;

-- Templates
drop policy if exists "prep_label_templates_read" on public.prep_label_templates;
create policy "prep_label_templates_read"
  on public.prep_label_templates for select
  using (public.is_tenant_member(tenant_id));

drop policy if exists "prep_label_templates_member_write" on public.prep_label_templates;
create policy "prep_label_templates_member_write"
  on public.prep_label_templates for all
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists "prep_label_templates_billing_gate" on public.prep_label_templates;
create policy "prep_label_templates_billing_gate"
  on public.prep_label_templates as restrictive
  for all to authenticated
  using (public.tenant_has_write_access(tenant_id))
  with check (public.tenant_has_write_access(tenant_id));

-- Labels
drop policy if exists "prep_labels_read" on public.prep_labels;
create policy "prep_labels_read"
  on public.prep_labels for select
  using (public.is_tenant_member(tenant_id));

drop policy if exists "prep_labels_member_insert" on public.prep_labels;
create policy "prep_labels_member_insert"
  on public.prep_labels for insert
  with check (public.is_tenant_member(tenant_id));

drop policy if exists "prep_labels_member_update" on public.prep_labels;
create policy "prep_labels_member_update"
  on public.prep_labels for update
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists "prep_labels_mgr_delete" on public.prep_labels;
create policy "prep_labels_mgr_delete"
  on public.prep_labels for delete
  using (public.is_tenant_manager_or_owner(tenant_id));

drop policy if exists "prep_labels_billing_gate" on public.prep_labels;
create policy "prep_labels_billing_gate"
  on public.prep_labels as restrictive
  for all to authenticated
  using (public.tenant_has_write_access(tenant_id))
  with check (public.tenant_has_write_access(tenant_id));

-- ─── 6. View: prep_labels_active ─────────────────────────────────────────────

create or replace view public.prep_labels_active
with (security_invoker = true)
as
select
  pl.id,
  pl.tenant_id,
  pl.template_id,
  coalesce(pl.item_name, pl.item)                                          as item_name,
  pl.prepped_at,
  coalesce(pl.use_by_at, pl.use_by)                                        as use_by_at,
  coalesce(pl.prepped_by_initials, left(coalesce(pl.prepped_by,'??'), 3))  as prepped_by_initials,
  pl.prepped_by_user_id,
  pl.storage,
  pl.allergens,
  pl.lot_number,
  pl.batch_quantity,
  pl.batch_unit,
  pl.notes,
  pl.station,
  pl.printed_at,
  pl.created_at,
  round(extract(epoch from (coalesce(pl.use_by_at, pl.use_by) - now())) / 3600.0, 1) as expires_in_hours,
  case
    when coalesce(pl.use_by_at, pl.use_by) <= now()                                    then 'expired'
    when coalesce(pl.use_by_at, pl.use_by) <= now() + interval '6 hours'               then 'expiring'
    when coalesce(pl.use_by_at, pl.use_by) <= now() + interval '24 hours'              then 'warning'
    else 'fresh'
  end as status
from public.prep_labels pl
where pl.voided_at is null;

grant select on public.prep_labels_active to authenticated;
