-- Migration: init_rls_policies
-- Version: 20260421185512
-- Pulled from production DB schema_migrations table

-- Enable RLS on every table
alter table tenants enable row level security;
alter table profiles enable row level security;
alter table memberships enable row level security;
alter table invites enable row level security;
alter table staff enable row level security;
alter table menu_items enable row level security;
alter table inventory_items enable row level security;
alter table recipes enable row level security;
alter table recipe_ingredients enable row level security;
alter table customers enable row level security;
alter table schedule_shifts enable row level security;
alter table temp_logs enable row level security;
alter table waste_logs enable row level security;
alter table licenses enable row level security;
alter table inspections enable row level security;
alter table inspection_checks enable row level security;
alter table tasks enable row level security;
alter table task_completions enable row level security;
alter table daily_sales enable row level security;
alter table pos_imports enable row level security;
alter table pos_transactions enable row level security;
alter table audit_log enable row level security;

-- TENANTS
drop policy if exists "tenants_members_read" on tenants;
create policy "tenants_members_read" on tenants for select using (is_tenant_member(id));
drop policy if exists "tenants_owner_updates" on tenants;
create policy "tenants_owner_updates" on tenants for update using (is_tenant_owner(id)) with check (is_tenant_owner(id));

-- PROFILES
drop policy if exists "profiles_self_select" on profiles;
create policy "profiles_self_select" on profiles for select using (id = auth.uid());
drop policy if exists "profiles_tenant_mate_select" on profiles;
create policy "profiles_tenant_mate_select" on profiles for select using (exists (select 1 from memberships m1 join memberships m2 on m1.tenant_id = m2.tenant_id where m1.user_id = auth.uid() and m2.user_id = profiles.id));
drop policy if exists "profiles_self_insert" on profiles;
create policy "profiles_self_insert" on profiles for insert with check (id = auth.uid());
drop policy if exists "profiles_self_update" on profiles;
create policy "profiles_self_update" on profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- MEMBERSHIPS
drop policy if exists "memberships_self_read" on memberships;
create policy "memberships_self_read" on memberships for select using (user_id = auth.uid() or is_tenant_manager_or_owner(tenant_id));
drop policy if exists "memberships_owner_writes" on memberships;
create policy "memberships_owner_writes" on memberships for all using (is_tenant_owner(tenant_id)) with check (is_tenant_owner(tenant_id));

-- INVITES
drop policy if exists "invites_mgr_read" on invites;
create policy "invites_mgr_read" on invites for select using (is_tenant_manager_or_owner(tenant_id));
drop policy if exists "invites_mgr_write" on invites;
create policy "invites_mgr_write" on invites for all using (is_tenant_manager_or_owner(tenant_id)) with check (is_tenant_manager_or_owner(tenant_id));

-- Generic helper for domain tables
create or replace function apply_tenant_rls(_table text)
returns void language plpgsql as $$
begin
  execute format('drop policy if exists "%1$s_read" on %1$I', _table);
  execute format('create policy "%1$s_read" on %1$I for select using (is_tenant_member(tenant_id))', _table);
  execute format('drop policy if exists "%1$s_mgr_write" on %1$I', _table);
  execute format('create policy "%1$s_mgr_write" on %1$I for all using (is_tenant_manager_or_owner(tenant_id)) with check (is_tenant_manager_or_owner(tenant_id))', _table);
end $$;

select apply_tenant_rls('staff');
select apply_tenant_rls('menu_items');
select apply_tenant_rls('inventory_items');
select apply_tenant_rls('recipes');
select apply_tenant_rls('recipe_ingredients');
select apply_tenant_rls('customers');
select apply_tenant_rls('schedule_shifts');
select apply_tenant_rls('licenses');
select apply_tenant_rls('inspections');
select apply_tenant_rls('tasks');
select apply_tenant_rls('daily_sales');
select apply_tenant_rls('pos_imports');
select apply_tenant_rls('pos_transactions');

-- temp_logs
drop policy if exists "temp_logs_read" on temp_logs;
create policy "temp_logs_read" on temp_logs for select using (is_tenant_member(tenant_id));
drop policy if exists "temp_logs_member_insert" on temp_logs;
create policy "temp_logs_member_insert" on temp_logs for insert with check (is_tenant_member(tenant_id));
drop policy if exists "temp_logs_mgr_update" on temp_logs;
create policy "temp_logs_mgr_update" on temp_logs for update using (is_tenant_manager_or_owner(tenant_id)) with check (is_tenant_manager_or_owner(tenant_id));
drop policy if exists "temp_logs_mgr_delete" on temp_logs;
create policy "temp_logs_mgr_delete" on temp_logs for delete using (is_tenant_manager_or_owner(tenant_id));

-- waste_logs
drop policy if exists "waste_logs_read" on waste_logs;
create policy "waste_logs_read" on waste_logs for select using (is_tenant_member(tenant_id));
drop policy if exists "waste_logs_member_insert" on waste_logs;
create policy "waste_logs_member_insert" on waste_logs for insert with check (is_tenant_member(tenant_id));
drop policy if exists "waste_logs_mgr_update" on waste_logs;
create policy "waste_logs_mgr_update" on waste_logs for update using (is_tenant_manager_or_owner(tenant_id)) with check (is_tenant_manager_or_owner(tenant_id));
drop policy if exists "waste_logs_mgr_delete" on waste_logs;
create policy "waste_logs_mgr_delete" on waste_logs for delete using (is_tenant_manager_or_owner(tenant_id));

-- task_completions
drop policy if exists "completions_read" on task_completions;
create policy "completions_read" on task_completions for select using (is_tenant_member(tenant_id));
drop policy if exists "completions_member_insert" on task_completions;
create policy "completions_member_insert" on task_completions for insert with check (is_tenant_member(tenant_id));
drop policy if exists "completions_mgr_delete" on task_completions;
create policy "completions_mgr_delete" on task_completions for delete using (is_tenant_manager_or_owner(tenant_id));

-- inspection_checks
drop policy if exists "checks_read" on inspection_checks;
create policy "checks_read" on inspection_checks for select using (is_tenant_member(tenant_id));
drop policy if exists "checks_member_update" on inspection_checks;
create policy "checks_member_update" on inspection_checks for update using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
drop policy if exists "checks_mgr_insert" on inspection_checks;
create policy "checks_mgr_insert" on inspection_checks for insert with check (is_tenant_manager_or_owner(tenant_id));
drop policy if exists "checks_mgr_delete" on inspection_checks;
create policy "checks_mgr_delete" on inspection_checks for delete using (is_tenant_manager_or_owner(tenant_id));

-- audit_log
drop policy if exists "audit_mgr_read" on audit_log;
create policy "audit_mgr_read" on audit_log for select using (is_tenant_manager_or_owner(tenant_id));
;
