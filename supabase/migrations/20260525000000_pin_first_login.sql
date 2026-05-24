-- PIN-first staff login support.
--
-- Adds:
--   * tenants.settings.device_mode ('shared' | 'personal') with helpers
--   * public.get_tenant_device_mode_by_email(_email) — anon-readable, used
--     by the staff login flow to decide whether to render the staff grid
--   * public.list_active_staff_for_grid_by_email(_email) — anon-readable,
--     returns active staff for the same tenant as the given email so a
--     shared device can render the name grid.
--   * public.me_has_pin() — auth-only, returns true if employee_pins row
--     exists for current user. Used after a password login to decide
--     whether to redirect to PIN setup.
--
-- Security notes:
--   * The anon-readable helpers are SECURITY DEFINER and ONLY return
--     non-sensitive fields (staff name + tenant device_mode). They never
--     expose PIN hashes, emails, or user_ids. They are necessary because
--     a brand-new device has no session yet but still needs to know
--     whether to show a grid or a single PIN screen.
--   * The grid helper requires the caller to know at least one active
--     staff email at the tenant — same threat model as the existing
--     pin-login edge function which already accepts email+PIN with no
--     session. We do not enumerate tenants.

-- ----------------------------------------------------------------------------
-- 1. get_tenant_device_mode_by_email
-- ----------------------------------------------------------------------------
create or replace function public.get_tenant_device_mode_by_email(_email text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
begin
  if _email is null or length(trim(_email)) = 0 then
    return 'personal';
  end if;

  select coalesce(t.settings->>'device_mode', 'personal')
    into v_mode
  from public.staff s
  join public.tenants t on t.id = s.tenant_id
  where lower(s.email) = lower(trim(_email))
    and s.active = true
  limit 1;

  -- Fall back to personal when no match. Never error: this is a
  -- pre-auth probe and must not leak existence.
  return coalesce(v_mode, 'personal');
end;
$$;

revoke all on function public.get_tenant_device_mode_by_email(text) from public;
grant execute on function public.get_tenant_device_mode_by_email(text) to anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 2. list_active_staff_for_grid_by_email
--    Returns active staff at the same tenant as the given email so a
--    shared-device PWA can render the name grid. Only id + name + has_pin.
-- ----------------------------------------------------------------------------
create or replace function public.list_active_staff_for_grid_by_email(_email text)
returns table (staff_id uuid, name text, has_pin boolean)
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

  -- Only expose the grid for tenants that have opted into shared mode.
  if v_tenant is null or v_mode <> 'shared' then
    return;
  end if;

  return query
    select s.id, s.name,
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


-- ----------------------------------------------------------------------------
-- 3. me_has_pin — used after a password login to decide whether to force
--    the staff into PIN setup before they can clock in.
-- ----------------------------------------------------------------------------
create or replace function public.me_has_pin()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_has boolean;
begin
  if v_uid is null then return false; end if;
  select exists (
    select 1
      from public.employee_pins ep
      join public.staff s on s.id = ep.staff_id
     where s.user_id = v_uid
  ) into v_has;
  return coalesce(v_has, false);
end;
$$;

revoke all on function public.me_has_pin() from public, anon;
grant execute on function public.me_has_pin() to authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 4. set_tenant_device_mode — manager-only setter. Tenant settings is
--    JSONB; this merges device_mode without clobbering other keys.
-- ----------------------------------------------------------------------------
create or replace function public.set_tenant_device_mode(_tenant_id uuid, _mode text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_allowed boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if _mode not in ('shared', 'personal') then
    raise exception 'invalid_device_mode';
  end if;

  -- Caller must be owner/admin of the tenant.
  select exists (
    select 1 from public.memberships m
     where m.user_id = v_uid
       and m.tenant_id = _tenant_id
       and m.role::text in ('owner', 'manager')
  ) into v_allowed;

  if not coalesce(v_allowed, false) then
    raise exception 'forbidden';
  end if;

  update public.tenants
     set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('device_mode', _mode)
   where id = _tenant_id;

  return _mode;
end;
$$;

revoke all on function public.set_tenant_device_mode(uuid, text) from public, anon;
grant execute on function public.set_tenant_device_mode(uuid, text) to authenticated, service_role;
