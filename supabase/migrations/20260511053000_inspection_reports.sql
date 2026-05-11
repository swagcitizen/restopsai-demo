-- Migration: inspection_reports
-- Version: 20260511053000
-- Inspection Report Repository — health/safety inspection report archive.
--
-- Changes:
--   1. Storage bucket: 'inspections' (private, 25MB, image+pdf)
--   2. Storage RLS policies (tenant scoping by path prefix)
--   3. Table: inspection_reports
--   4. Indexes
--   5. RLS policies (read/write + billing gate)
--   6. updated_at trigger
--   7. View: inspection_reports_with_details (uploader_email via helper, trend deltas)

-- ─── 1. Storage bucket ───────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inspections',
  'inspections',
  false,
  26214400,   -- 25 MB
  array['image/jpeg','image/png','image/heic','image/heif','image/webp','application/pdf']
)
on conflict (id) do nothing;

-- ─── 2. Storage RLS policies ─────────────────────────────────────────────────
-- Path layout: {tenant_id}/{inspection_id}/{filename}

drop policy if exists "inspections_storage_select" on storage.objects;
create policy "inspections_storage_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'inspections'
    and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = (string_to_array(name, '/'))[1]::uuid
    )
  );

drop policy if exists "inspections_storage_insert" on storage.objects;
create policy "inspections_storage_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'inspections'
    and public.tenant_has_write_access((string_to_array(name, '/'))[1]::uuid)
    and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = (string_to_array(name, '/'))[1]::uuid
    )
  );

drop policy if exists "inspections_storage_delete" on storage.objects;
create policy "inspections_storage_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'inspections'
    and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = (string_to_array(name, '/'))[1]::uuid
        and m.role in ('owner', 'manager')
    )
  );

-- ─── 3. Table ────────────────────────────────────────────────────────────────

create table if not exists public.inspection_reports (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  uploaded_by         uuid references auth.users(id) on delete set null,
  uploaded_at         timestamptz not null default now(),

  -- Inspection metadata
  inspection_date     date not null,
  inspector_name      text,
  inspector_agency    text,                       -- e.g. "FL DBPR", "Stearns County Health"
  inspection_type     text not null default 'routine'
                        check (inspection_type in ('routine','complaint','followup','reinspection','permit','other')),
  result              text                        -- "Pass", "Pass w/ corrections", "Fail", etc. (free-form)
                        check (result is null or length(result) <= 80),

  -- Scoring
  score               numeric(5,2),               -- 0-100 numeric score (jurisdictions vary, store percentage)
  score_scale         text default 'percent'      -- 'percent', 'a-f', 'points'
                        check (score_scale in ('percent','a-f','points')),
  score_grade         text,                        -- 'A', 'B', 'C' for letter-grade jurisdictions
  violations_critical int default 0,
  violations_major    int default 0,
  violations_minor    int default 0,
  violations_total    int generated always as (
    coalesce(violations_critical,0) + coalesce(violations_major,0) + coalesce(violations_minor,0)
  ) stored,

  notes               text,
  followup_due_date   date,
  followup_status     text default 'none'
                        check (followup_status in ('none','pending','complete')),

  -- File reference (storage)
  storage_path        text,                       -- e.g. {tenant}/{id}/report.pdf
  file_name           text,
  file_size_bytes     int,
  mime_type           text,
  thumbnail_path      text,

  voided_at           timestamptz,
  void_reason         text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ─── 4. Indexes ──────────────────────────────────────────────────────────────

create index if not exists inspection_reports_tenant_date
  on public.inspection_reports (tenant_id, inspection_date desc);

create index if not exists inspection_reports_tenant_followup
  on public.inspection_reports (tenant_id, followup_status, followup_due_date)
  where followup_status = 'pending';

-- ─── 5. updated_at trigger ───────────────────────────────────────────────────

drop trigger if exists inspection_reports_updated_at on public.inspection_reports;
create trigger inspection_reports_updated_at
  before update on public.inspection_reports
  for each row execute function public.set_updated_at();

-- ─── 6. RLS ──────────────────────────────────────────────────────────────────

alter table public.inspection_reports enable row level security;

drop policy if exists "inspection_reports_read" on public.inspection_reports;
create policy "inspection_reports_read"
  on public.inspection_reports for select
  using (public.is_tenant_member(tenant_id));

drop policy if exists "inspection_reports_member_write" on public.inspection_reports;
create policy "inspection_reports_member_write"
  on public.inspection_reports for all
  using (
    public.is_tenant_member(tenant_id)
    and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = inspection_reports.tenant_id
        and m.role in ('owner','manager','staff')
    )
  )
  with check (
    public.is_tenant_member(tenant_id)
    and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = inspection_reports.tenant_id
        and m.role in ('owner','manager','staff')
    )
  );

drop policy if exists "inspection_reports_billing_gate" on public.inspection_reports;
create policy "inspection_reports_billing_gate"
  on public.inspection_reports as restrictive
  for all to authenticated
  using (public.tenant_has_write_access(tenant_id))
  with check (public.tenant_has_write_access(tenant_id));

-- ─── 7. View: inspection_reports_with_details ────────────────────────────────
-- Includes uploader_email (via tenant-scoped helper) and prev_score for trends.

create or replace view public.inspection_reports_with_details
with (security_invoker = true)
as
select
  r.*,
  public.user_email_for_tenant_member(r.uploaded_by) as uploader_email,
  lag(r.score) over (partition by r.tenant_id order by r.inspection_date asc, r.created_at asc) as prev_score,
  r.score - lag(r.score) over (partition by r.tenant_id order by r.inspection_date asc, r.created_at asc) as score_delta
from public.inspection_reports r
where r.voided_at is null;

grant select on public.inspection_reports_with_details to authenticated;
