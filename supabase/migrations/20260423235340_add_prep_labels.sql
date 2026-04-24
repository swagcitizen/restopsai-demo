-- Migration: add_prep_labels
-- Version: 20260423235340
-- Pulled from production DB schema_migrations table

-- Prep labels (day-dot / use-by labels for prepped items)
create table if not exists prep_labels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  item text not null,
  prep_type text not null default 'prep' check (prep_type in ('prep','thaw','open')),
  prepped_by text,
  prepped_by_user uuid references auth.users(id) on delete set null,
  prepped_at timestamptz not null default now(),
  use_by timestamptz not null,
  allergens text[] not null default '{}',
  station text,
  notes text,
  voided_at timestamptz,
  voided_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_prep_labels_tenant_use_by on prep_labels (tenant_id, use_by);
create index if not exists idx_prep_labels_tenant_active on prep_labels (tenant_id, voided_at) where voided_at is null;

alter table prep_labels enable row level security;

drop policy if exists "prep_labels_tenant_select" on prep_labels;
drop policy if exists "prep_labels_tenant_insert" on prep_labels;
drop policy if exists "prep_labels_tenant_update" on prep_labels;

create policy "prep_labels_tenant_select" on prep_labels
  for select using (tenant_id in (select tenant_id from memberships where user_id = auth.uid()));
create policy "prep_labels_tenant_insert" on prep_labels
  for insert with check (tenant_id in (select tenant_id from memberships where user_id = auth.uid()));
create policy "prep_labels_tenant_update" on prep_labels
  for update using (tenant_id in (select tenant_id from memberships where user_id = auth.uid()));
;
