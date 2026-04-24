-- Migration: add_invoices_ap
-- Version: 20260424013550
-- Pulled from production DB schema_migrations table

-- Invoices table
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vendor text not null,
  invoice_number text,
  invoice_date date,
  subtotal numeric(12,2) default 0,
  tax numeric(12,2) default 0,
  total numeric(12,2) default 0,
  status text not null default 'draft' check (status in ('draft','reviewed','posted')),
  image_url text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  ocr_raw jsonb,
  notes text
);
create index idx_invoices_tenant on public.invoices(tenant_id);
create index idx_invoices_status on public.invoices(tenant_id, status);
create index idx_invoices_date on public.invoices(tenant_id, invoice_date desc);

-- Invoice lines table
create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  line_index int not null default 0,
  raw_description text not null,
  qty numeric(12,3) default 0,
  unit text,
  unit_price numeric(12,4) default 0,
  extended_price numeric(12,2) default 0,
  matched_inventory_id uuid references public.inventory_items(id) on delete set null,
  match_confidence numeric(4,3) default 0,
  created_new_sku boolean not null default false
);
create index idx_invoice_lines_invoice on public.invoice_lines(invoice_id);
create index idx_invoice_lines_tenant on public.invoice_lines(tenant_id);
create index idx_invoice_lines_match on public.invoice_lines(matched_inventory_id);

-- Vendor price history
create table public.vendor_price_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  vendor text not null,
  invoice_id uuid references public.invoices(id) on delete set null,
  unit_price numeric(12,4) not null,
  recorded_at timestamptz not null default now()
);
create index idx_vph_item on public.vendor_price_history(tenant_id, inventory_item_id, recorded_at desc);
create index idx_vph_vendor on public.vendor_price_history(tenant_id, vendor, recorded_at desc);

-- RLS
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.vendor_price_history enable row level security;

create policy "invoices_tenant_select" on public.invoices for select
  using (tenant_id in (select tenant_id from public.memberships where user_id = auth.uid()));
create policy "invoices_tenant_insert" on public.invoices for insert
  with check (tenant_id in (select tenant_id from public.memberships where user_id = auth.uid()));
create policy "invoices_tenant_update" on public.invoices for update
  using (tenant_id in (select tenant_id from public.memberships where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from public.memberships where user_id = auth.uid()));
create policy "invoices_tenant_delete" on public.invoices for delete
  using (tenant_id in (select tenant_id from public.memberships where user_id = auth.uid()));

create policy "invoice_lines_tenant_select" on public.invoice_lines for select
  using (tenant_id in (select tenant_id from public.memberships where user_id = auth.uid()));
create policy "invoice_lines_tenant_insert" on public.invoice_lines for insert
  with check (tenant_id in (select tenant_id from public.memberships where user_id = auth.uid()));
create policy "invoice_lines_tenant_update" on public.invoice_lines for update
  using (tenant_id in (select tenant_id from public.memberships where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from public.memberships where user_id = auth.uid()));
create policy "invoice_lines_tenant_delete" on public.invoice_lines for delete
  using (tenant_id in (select tenant_id from public.memberships where user_id = auth.uid()));

create policy "vph_tenant_select" on public.vendor_price_history for select
  using (tenant_id in (select tenant_id from public.memberships where user_id = auth.uid()));
create policy "vph_tenant_insert" on public.vendor_price_history for insert
  with check (tenant_id in (select tenant_id from public.memberships where user_id = auth.uid()));
create policy "vph_tenant_update" on public.vendor_price_history for update
  using (tenant_id in (select tenant_id from public.memberships where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from public.memberships where user_id = auth.uid()));
create policy "vph_tenant_delete" on public.vendor_price_history for delete
  using (tenant_id in (select tenant_id from public.memberships where user_id = auth.uid()));
;
