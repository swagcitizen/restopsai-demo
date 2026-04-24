-- Migration: add_create_tenant_rpc
-- Version: 20260421190319
-- Pulled from production DB schema_migrations table

-- RPC: create tenant + owner membership + profile + seed, all atomic.
-- Callable by any authenticated user for their own account.
create or replace function create_tenant_and_membership(
  _name text,
  _restaurant_type text default 'other',
  _state text default null,
  _city text default null,
  _timezone text default 'America/New_York'
) returns uuid language plpgsql security definer
set search_path = public as $fn$
declare
  _user_id uuid;
  _tenant_id uuid;
begin
  _user_id := auth.uid();
  if _user_id is null then
    raise exception 'Not authenticated';
  end if;
  if _name is null or length(trim(_name)) = 0 then
    raise exception 'Tenant name required';
  end if;

  -- Create tenant
  insert into tenants (name, restaurant_type, state, city, timezone)
  values (_name, coalesce(_restaurant_type, 'other'), _state, _city, coalesce(_timezone, 'America/New_York'))
  returning id into _tenant_id;

  -- Create owner membership for the caller
  insert into memberships (user_id, tenant_id, role)
  values (_user_id, _tenant_id, 'owner');

  -- Upsert profile, set default tenant
  insert into profiles (id, default_tenant_id)
  values (_user_id, _tenant_id)
  on conflict (id) do update set default_tenant_id = _tenant_id, updated_at = now();

  -- Seed defaults (checklist + tasks + license templates)
  perform seed_tenant_defaults(_tenant_id);

  return _tenant_id;
end $fn$;

-- Grant execute to authenticated users (anon cannot call it, no session = no auth.uid())
revoke all on function create_tenant_and_membership(text, text, text, text, text) from public;
grant execute on function create_tenant_and_membership(text, text, text, text, text) to authenticated;
;
