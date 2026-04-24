-- Migration: init_indexes_triggers
-- Version: 20260421185444
-- Pulled from production DB schema_migrations table

-- Indexes
create index if not exists idx_memberships_user on memberships(user_id);
create index if not exists idx_memberships_tenant on memberships(tenant_id);
create index if not exists idx_invites_tenant on invites(tenant_id);
create index if not exists idx_invites_email on invites(lower(email));
create index if not exists idx_staff_tenant on staff(tenant_id) where active = true;
create index if not exists idx_menu_tenant on menu_items(tenant_id) where active = true;
create index if not exists idx_inventory_tenant on inventory_items(tenant_id);
create index if not exists idx_recipes_tenant on recipes(tenant_id);
create index if not exists idx_recipe_ing_tenant on recipe_ingredients(tenant_id);
create index if not exists idx_recipe_ing_recipe on recipe_ingredients(recipe_id);
create index if not exists idx_customers_tenant on customers(tenant_id);
create index if not exists idx_shifts_tenant_date on schedule_shifts(tenant_id, shift_date);
create index if not exists idx_temp_tenant_time on temp_logs(tenant_id, logged_at desc);
create index if not exists idx_waste_tenant_time on waste_logs(tenant_id, logged_at desc);
create index if not exists idx_licenses_tenant on licenses(tenant_id);
create index if not exists idx_licenses_expires on licenses(tenant_id, expires_on) where status = 'active';
create index if not exists idx_inspections_tenant_date on inspections(tenant_id, inspection_date desc);
create index if not exists idx_checks_tenant on inspection_checks(tenant_id);
create index if not exists idx_tasks_tenant on tasks(tenant_id) where active = true;
create index if not exists idx_tasks_assignee on tasks(tenant_id, assigned_staff_id);
create index if not exists idx_completions_tenant_task on task_completions(tenant_id, task_id, completed_at desc);
create index if not exists idx_sales_tenant_date on daily_sales(tenant_id, sales_date desc);
create index if not exists idx_pos_imports_tenant on pos_imports(tenant_id, uploaded_at desc);
create index if not exists idx_pos_tx_tenant_time on pos_transactions(tenant_id, occurred_at desc);
create index if not exists idx_audit_tenant_time on audit_log(tenant_id, created_at desc);

-- updated_at triggers
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare
  t text;
  tables text[] := array['tenants','profiles','staff','menu_items','inventory_items','recipes','customers','licenses','tasks','daily_sales'];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists trg_%I_updated_at on %I', t, t);
    execute format('create trigger trg_%I_updated_at before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;
;
