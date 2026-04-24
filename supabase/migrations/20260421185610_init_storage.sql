-- Migration: init_storage
-- Version: 20260421185610
-- Pulled from production DB schema_migrations table

-- Create bucket
insert into storage.buckets (id, name, public)
values ('tenant-docs', 'tenant-docs', false)
on conflict (id) do nothing;

-- Storage RLS policies
drop policy if exists "tenant_docs_member_read" on storage.objects;
create policy "tenant_docs_member_read" on storage.objects for select
  using (bucket_id = 'tenant-docs' and is_tenant_member((storage.foldername(name))[1]::uuid));

drop policy if exists "tenant_docs_mgr_insert" on storage.objects;
create policy "tenant_docs_mgr_insert" on storage.objects for insert
  with check (bucket_id = 'tenant-docs' and is_tenant_manager_or_owner((storage.foldername(name))[1]::uuid));

drop policy if exists "tenant_docs_mgr_update" on storage.objects;
create policy "tenant_docs_mgr_update" on storage.objects for update
  using (bucket_id = 'tenant-docs' and is_tenant_manager_or_owner((storage.foldername(name))[1]::uuid));

drop policy if exists "tenant_docs_mgr_delete" on storage.objects;
create policy "tenant_docs_mgr_delete" on storage.objects for delete
  using (bucket_id = 'tenant-docs' and is_tenant_manager_or_owner((storage.foldername(name))[1]::uuid));
;
