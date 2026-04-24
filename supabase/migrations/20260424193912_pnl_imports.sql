-- Migration: pnl_imports
-- Version: 20260424193912
-- Pulled from production DB schema_migrations table

-- P&L import pipeline

create table if not exists public.pnl_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  filename text not null,
  file_type text not null check (file_type in ('pdf','csv','xlsx')),
  storage_path text not null,
  status text not null default 'uploaded' check (status in ('uploaded','parsing','needs_review','confirmed','error')),
  period_start date,
  period_end date,
  raw_text text,
  parse_error text,
  uploaded_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index if not exists pnl_imports_tenant_idx on public.pnl_imports(tenant_id, created_at desc);

create table if not exists public.pnl_line_items (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.pnl_imports(id) on delete cascade,
  raw_label text not null,
  raw_amount numeric(14,2) not null,
  mapped_category text check (mapped_category in ('revenue','food_cost','beverage_cost','labor','rent','utilities','marketing','other_opex','ignore')),
  confidence numeric(3,2),
  ai_reasoning text,
  is_confirmed boolean not null default false,
  display_order int,
  created_at timestamptz not null default now()
);

create index if not exists pnl_line_items_import_idx on public.pnl_line_items(import_id, display_order);

-- Summary table populated on confirm (drives dashboard KPIs)
create table if not exists public.pnl_period_summary (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  import_id uuid references public.pnl_imports(id) on delete set null,
  period_start date not null,
  period_end date not null,
  revenue numeric(14,2) default 0,
  food_cost numeric(14,2) default 0,
  beverage_cost numeric(14,2) default 0,
  labor numeric(14,2) default 0,
  rent numeric(14,2) default 0,
  utilities numeric(14,2) default 0,
  marketing numeric(14,2) default 0,
  other_opex numeric(14,2) default 0,
  net_income numeric(14,2) generated always as (
    coalesce(revenue,0) - coalesce(food_cost,0) - coalesce(beverage_cost,0) - coalesce(labor,0)
    - coalesce(rent,0) - coalesce(utilities,0) - coalesce(marketing,0) - coalesce(other_opex,0)
  ) stored,
  created_at timestamptz not null default now(),
  unique (tenant_id, period_start, period_end)
);

create index if not exists pnl_period_summary_tenant_idx on public.pnl_period_summary(tenant_id, period_end desc);

alter table public.pnl_imports enable row level security;
alter table public.pnl_line_items enable row level security;
alter table public.pnl_period_summary enable row level security;

-- Service role only; edge functions perform tenant_id scoping in code
create policy pnl_imports_service on public.pnl_imports for all to service_role using (true) with check (true);
create policy pnl_line_items_service on public.pnl_line_items for all to service_role using (true) with check (true);
create policy pnl_period_summary_service on public.pnl_period_summary for all to service_role using (true) with check (true);

-- Private storage bucket
insert into storage.buckets (id, name, public) values ('pnl-uploads','pnl-uploads', false) on conflict (id) do nothing;;
