-- Expand grid RPC to include email so pin-login can be called per staff.
-- Same threat model as list_active_staff_for_grid_by_email v1: caller
-- must know an active staff email at a tenant that has opted into
-- shared mode. Co-worker emails on the same shared device are
-- acceptable to expose (the manager set up the device).

drop function if exists public.list_active_staff_for_grid_by_email(text);

create or replace function public.list_active_staff_for_grid_by_email(_email text)
returns table (staff_id uuid, name text, email text, has_pin boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_mode text;
begin
  if _email is null or length(trim(_email)) = 0 then
    return;
  end if;

  select s.tenant_id, coalesce(t.settings->>'device_mode', 'personal')
    into v_tenant, v_mode
  from public.staff s
  join public.tenants t on t.id = s.tenant_id
  where lower(s.email) = lower(trim(_email))
    and s.active = true
  limit 1;

  if v_tenant is null or v_mode <> 'shared' then
    return;
  end if;

  return query
    select s.id, s.name, s.email,
           exists (select 1 from public.employee_pins ep where ep.staff_id = s.id) as has_pin
    from public.staff s
    where s.tenant_id = v_tenant
      and s.active = true
      and s.email is not null
    order by s.name asc;
end;
$$;

revoke all on function public.list_active_staff_for_grid_by_email(text) from public;
grant execute on function public.list_active_staff_for_grid_by_email(text) to anon, authenticated, service_role;
