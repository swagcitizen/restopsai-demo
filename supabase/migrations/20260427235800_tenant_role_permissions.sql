-- Granular role permissions: owner can hide individual nav views per role,
-- on top of the existing owner/manager/staff base roles.

create table if not exists public.tenant_role_permissions (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role text not null check (role in ('owner','manager','staff')),
  hidden_views text[] not null default '{}'::text[],
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (tenant_id, role)
);

alter table public.tenant_role_permissions enable row level security;

-- Anyone in tenant can read their permissions
drop policy if exists trp_select on public.tenant_role_permissions;
create policy trp_select on public.tenant_role_permissions for select
  using (tenant_id in (select tenant_id from public.memberships where user_id = auth.uid()));

-- Only owners can write
drop policy if exists trp_insert on public.tenant_role_permissions;
create policy trp_insert on public.tenant_role_permissions for insert
  with check (tenant_id in (
    select tenant_id from public.memberships
    where user_id = auth.uid() and role::text = 'owner'
  ));

drop policy if exists trp_update on public.tenant_role_permissions;
create policy trp_update on public.tenant_role_permissions for update
  using (tenant_id in (
    select tenant_id from public.memberships
    where user_id = auth.uid() and role::text = 'owner'
  ))
  with check (tenant_id in (
    select tenant_id from public.memberships
    where user_id = auth.uid() and role::text = 'owner'
  ));

drop policy if exists trp_delete on public.tenant_role_permissions;
create policy trp_delete on public.tenant_role_permissions for delete
  using (tenant_id in (
    select tenant_id from public.memberships
    where user_id = auth.uid() and role::text = 'owner'
  ));

-- RPC: hidden_views for the calling user's role in tenant (everyone can call)
create or replace function public.get_my_role_permissions(p_tenant_id uuid)
returns text[]
language sql
stable
security invoker
as $$
  select coalesce(
    (select hidden_views
     from public.tenant_role_permissions trp
     join public.memberships m
       on m.tenant_id = trp.tenant_id and m.role::text = trp.role
     where trp.tenant_id = p_tenant_id
       and m.user_id = auth.uid()
     limit 1),
    '{}'::text[]
  );
$$;

grant execute on function public.get_my_role_permissions(uuid) to authenticated;

-- RPC: list (role, hidden_views) for all 3 roles — owner-only
create or replace function public.list_role_permissions(p_tenant_id uuid)
returns table(role text, hidden_views text[])
language sql
stable
security invoker
as $$
  select r.role, coalesce(trp.hidden_views, '{}'::text[]) as hidden_views
  from (values ('owner'::text), ('manager'), ('staff')) as r(role)
  left join public.tenant_role_permissions trp
    on trp.tenant_id = p_tenant_id and trp.role = r.role
  where exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant_id and m.user_id = auth.uid() and m.role::text = 'owner'
  );
$$;

grant execute on function public.list_role_permissions(uuid) to authenticated;

-- RPC: upsert hidden_views for a role — owner-only enforced inside fn
create or replace function public.set_role_permissions(
  p_tenant_id uuid,
  p_role text,
  p_hidden_views text[]
)
returns void
language plpgsql
security invoker
as $$
begin
  if p_role not in ('owner','manager','staff') then
    raise exception 'Invalid role: %', p_role;
  end if;
  if not exists (
    select 1 from public.memberships
    where tenant_id = p_tenant_id and user_id = auth.uid() and role::text = 'owner'
  ) then
    raise exception 'Only the owner can change role permissions';
  end if;
  insert into public.tenant_role_permissions (tenant_id, role, hidden_views, updated_by)
    values (p_tenant_id, p_role, coalesce(p_hidden_views, '{}'::text[]), auth.uid())
    on conflict (tenant_id, role) do update
      set hidden_views = excluded.hidden_views,
          updated_by = auth.uid(),
          updated_at = now();
end;
$$;

grant execute on function public.set_role_permissions(uuid, text, text[]) to authenticated;
