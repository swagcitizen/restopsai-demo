-- Migration: init_domain_tables
-- Version: 20260421185427
-- Pulled from production DB schema_migrations table

create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  role text not null,
  hourly_rate numeric(6,2) default 0,
  phone text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  price numeric(8,2) not null default 0,
  food_cost numeric(8,2) not null default 0,
  category text,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  unit text not null,
  on_hand numeric(10,2) not null default 0,
  par numeric(10,2) not null default 0,
  unit_cost numeric(8,2) not null default 0,
  supplier text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  yield int not null default 1,
  menu_price numeric(8,2),
  linked_menu_item_id uuid references menu_items(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  qty numeric(10,3) not null default 0,
  unit text,
  unit_cost numeric(8,3) not null default 0,
  sort_order int not null default 0
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  orders int not null default 0,
  total_spent numeric(10,2) not null default 0,
  last_order_date date,
  tags text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists schedule_shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  shift_date date not null,
  start_time time,
  end_time time,
  hours numeric(4,2),
  notes text,
  created_at timestamptz not null default now(),
  unique (tenant_id, staff_id, shift_date)
);

create table if not exists temp_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  logged_at timestamptz not null default now(),
  logged_by uuid references auth.users(id) on delete set null,
  equipment text not null,
  temp_f numeric(5,2) not null,
  within_range boolean,
  notes text
);

create table if not exists waste_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  logged_at timestamptz not null default now(),
  logged_by uuid references auth.users(id) on delete set null,
  item text not null,
  qty numeric(8,2),
  reason text,
  dollar_loss numeric(8,2) not null default 0
);

create table if not exists licenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  agency text,
  number text,
  issued_on date,
  expires_on date,
  status text not null default 'active',
  doc_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists inspections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  inspection_date date not null,
  agency text,
  score int,
  violations jsonb not null default '[]'::jsonb,
  notes text,
  doc_url text,
  created_at timestamptz not null default now()
);

create table if not exists inspection_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null,
  title text,
  passed boolean not null default false,
  last_checked_at timestamptz,
  checked_by uuid references auth.users(id) on delete set null,
  notes text,
  unique (tenant_id, code)
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  library_id text,
  title text not null,
  detail text,
  frequency task_frequency not null,
  category text,
  severity task_severity not null default 'routine',
  estimated_minutes int not null default 0,
  is_vendor boolean not null default false,
  assigned_staff_id uuid references staff(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists task_completions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  completed_at timestamptz not null default now(),
  completed_by uuid references auth.users(id) on delete set null,
  notes text
);

create table if not exists daily_sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sales_date date not null,
  gross_revenue numeric(10,2) not null default 0,
  net_revenue numeric(10,2),
  transactions int not null default 0,
  food_cost numeric(10,2) not null default 0,
  labor_cost numeric(10,2) not null default 0,
  occupancy_cost numeric(10,2) not null default 0,
  other_cost numeric(10,2) not null default 0,
  source pos_provider not null default 'manual',
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, sales_date)
);

create table if not exists pos_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider pos_provider not null,
  filename text not null,
  storage_path text,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  status text not null default 'pending',
  error text,
  rows_total int,
  rows_imported int,
  rows_skipped int,
  date_range_start date,
  date_range_end date
);

create table if not exists pos_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  import_id uuid references pos_imports(id) on delete cascade,
  provider pos_provider not null,
  external_id text,
  occurred_at timestamptz not null,
  gross_amount numeric(10,2) not null default 0,
  discount_amount numeric(10,2) not null default 0,
  tax_amount numeric(10,2) not null default 0,
  tip_amount numeric(10,2) not null default 0,
  net_amount numeric(10,2) not null default 0,
  item_count int,
  payment_method text,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider, external_id)
);

create table if not exists audit_log (
  id bigserial primary key,
  tenant_id uuid references tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  payload jsonb,
  created_at timestamptz not null default now()
);
;
