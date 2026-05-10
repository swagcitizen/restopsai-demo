-- Migration: receipts
-- Version: 20260510190000
-- Receipt Repository — core infrastructure (OCR is a drop-in addition)
--
-- Changes:
--   1. Storage bucket: 'receipts' (private)
--   2. Table: receipts (with OCR fields, all nullable until OCR runs)
--   3. Table: receipt_line_items (denormalized from OCR)
--   4. Indexes on both tables
--   5. RLS policies on both tables + billing gate
--   6. Trigger: set_updated_at on receipts
--   7. View: receipts_with_details (line_item_count + uploader_email)
--   8. RLS policies on storage.objects for 'receipts' bucket

-- ─── 1. Storage bucket: 'receipts' ───────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  26214400,   -- 25 MB
  array['image/jpeg','image/png','image/heic','image/heif','image/webp','application/pdf']
)
on conflict (id) do nothing;

-- ─── 2. Storage RLS policies ─────────────────────────────────────────────────
-- Path layout: {tenant_id}/{receipt_id}/{filename}
-- We extract tenant_id as the first segment of the storage path.

drop policy if exists "receipts_storage_select" on storage.objects;
create policy "receipts_storage_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'receipts'
    and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = (string_to_array(name, '/'))[1]::uuid
    )
  );

drop policy if exists "receipts_storage_insert" on storage.objects;
create policy "receipts_storage_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'receipts'
    and public.tenant_has_write_access((string_to_array(name, '/'))[1]::uuid)
    and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = (string_to_array(name, '/'))[1]::uuid
    )
  );

drop policy if exists "receipts_storage_delete" on storage.objects;
create policy "receipts_storage_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'receipts'
    and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = (string_to_array(name, '/'))[1]::uuid
        and m.role in ('owner', 'manager')
    )
  );

-- ─── 3. Table: receipts ───────────────────────────────────────────────────────

create table if not exists public.receipts (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  uploaded_by         uuid references auth.users(id) on delete set null,
  uploaded_at         timestamptz not null default now(),
  source              text not null default 'upload'
                        check (source in ('upload','camera','email','import')),
  storage_path        text not null,
  file_name           text,
  file_size_bytes     int,
  mime_type           text,
  thumbnail_path      text,

  -- OCR extracted fields (all nullable until OCR runs)
  vendor_name         text,
  vendor_address      text,
  vendor_phone        text,
  receipt_date        date,
  total_amount        numeric(12,2),
  subtotal_amount     numeric(12,2),
  tax_amount          numeric(12,2),
  tip_amount          numeric(12,2),
  payment_method      text,
  payment_last4       text,
  currency            text default 'USD',
  ocr_status          text not null default 'pending'
                        check (ocr_status in ('pending','processing','done','failed','skipped')),
  ocr_processed_at    timestamptz,
  ocr_error           text,
  ocr_confidence      numeric(5,4),
  ocr_raw_json        jsonb,

  -- User-entered metadata
  category            text,
  vendor_id           uuid references public.vendors(id) on delete set null,
  notes               text,
  tags                text[] default '{}'::text[],

  -- AP integration
  bill_id             uuid references public.invoices(id) on delete set null,
  bill_status         text default 'unlinked'
                        check (bill_status in ('unlinked','draft','linked','reconciled')),

  voided_at           timestamptz,
  void_reason         text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ─── 4. Table: receipt_line_items ─────────────────────────────────────────────

create table if not exists public.receipt_line_items (
  id              uuid primary key default gen_random_uuid(),
  receipt_id      uuid not null references public.receipts(id) on delete cascade,
  tenant_id       uuid not null,
  position        int,
  description     text not null,
  quantity        numeric(12,3),
  unit_price      numeric(12,4),
  total_price     numeric(12,2),
  tax_amount      numeric(12,2),
  sku             text,
  category        text,
  ocr_confidence  numeric(5,4)
);

-- ─── 5. Indexes ───────────────────────────────────────────────────────────────

create index if not exists receipts_tenant_date
  on public.receipts (tenant_id, receipt_date desc);

create index if not exists receipts_tenant_vendor
  on public.receipts (tenant_id, vendor_name);

create index if not exists receipts_tenant_ocr_status
  on public.receipts (tenant_id, ocr_status)
  where voided_at is null;

create index if not exists receipt_line_items_receipt_position
  on public.receipt_line_items (receipt_id, position);

create index if not exists receipt_line_items_tenant
  on public.receipt_line_items (tenant_id);

-- ─── 6. updated_at trigger on receipts ───────────────────────────────────────
-- set_updated_at() already exists (created in prep_labels migration), reuse it.

drop trigger if exists receipts_updated_at on public.receipts;
create trigger receipts_updated_at
  before update on public.receipts
  for each row execute function public.set_updated_at();

-- ─── 7. RLS ───────────────────────────────────────────────────────────────────

alter table public.receipts          enable row level security;
alter table public.receipt_line_items enable row level security;

-- receipts
drop policy if exists "receipts_read"          on public.receipts;
create policy "receipts_read"
  on public.receipts for select
  using (public.is_tenant_member(tenant_id));

drop policy if exists "receipts_member_write"  on public.receipts;
create policy "receipts_member_write"
  on public.receipts for all
  using (
    public.is_tenant_member(tenant_id)
    and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = receipts.tenant_id
        and m.role in ('owner','manager','staff')
    )
  )
  with check (
    public.is_tenant_member(tenant_id)
    and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = receipts.tenant_id
        and m.role in ('owner','manager','staff')
    )
  );

drop policy if exists "receipts_billing_gate"  on public.receipts;
create policy "receipts_billing_gate"
  on public.receipts as restrictive
  for all to authenticated
  using (public.tenant_has_write_access(tenant_id))
  with check (public.tenant_has_write_access(tenant_id));

-- receipt_line_items
drop policy if exists "receipt_line_items_read"         on public.receipt_line_items;
create policy "receipt_line_items_read"
  on public.receipt_line_items for select
  using (public.is_tenant_member(tenant_id));

drop policy if exists "receipt_line_items_member_write" on public.receipt_line_items;
create policy "receipt_line_items_member_write"
  on public.receipt_line_items for all
  using (
    public.is_tenant_member(tenant_id)
    and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = receipt_line_items.tenant_id
        and m.role in ('owner','manager','staff')
    )
  )
  with check (
    public.is_tenant_member(tenant_id)
    and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = receipt_line_items.tenant_id
        and m.role in ('owner','manager','staff')
    )
  );

drop policy if exists "receipt_line_items_billing_gate" on public.receipt_line_items;
create policy "receipt_line_items_billing_gate"
  on public.receipt_line_items as restrictive
  for all to authenticated
  using (public.tenant_has_write_access(tenant_id))
  with check (public.tenant_has_write_access(tenant_id));

-- ─── 8. View: receipts_with_details ──────────────────────────────────────────

create or replace view public.receipts_with_details
with (security_invoker = true)
as
select
  r.*,
  count(li.id)::int          as line_item_count,
  u.email                    as uploader_email
from public.receipts r
left join public.receipt_line_items li on li.receipt_id = r.id
left join auth.users u                 on u.id = r.uploaded_by
group by r.id, u.email;

grant select on public.receipts_with_details to authenticated;
