-- Migration: accept_invite_rpc
-- Version: 20260421194630
-- Pulled from production DB schema_migrations table

-- accept_invite: allows any signed-in user to redeem an invite token.
-- Runs as definer so it can bypass RLS on invites/memberships when the token is valid.
create or replace function public.accept_invite(_token text)
returns uuid -- returns the tenant_id they joined
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_existing_membership uuid;
begin
  if v_user_id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select email into v_user_email from auth.users where id = v_user_id;

  select * into v_invite
  from public.invites
  where token = _token
  limit 1;

  if not found then
    raise exception 'Invite not found' using errcode = 'P0001';
  end if;

  if v_invite.accepted_at is not null then
    raise exception 'Invite has already been used' using errcode = 'P0001';
  end if;

  if v_invite.expires_at < now() then
    raise exception 'Invite has expired' using errcode = 'P0001';
  end if;

  if lower(v_invite.email) <> lower(coalesce(v_user_email, '')) then
    raise exception 'This invite was sent to a different email address (%). Sign in with that account to accept it.', v_invite.email using errcode = 'P0001';
  end if;

  -- If they're already a member, just mark invite accepted and return tenant
  select id into v_existing_membership
  from public.memberships
  where tenant_id = v_invite.tenant_id and user_id = v_user_id
  limit 1;

  if v_existing_membership is null then
    insert into public.memberships (tenant_id, user_id, role)
    values (v_invite.tenant_id, v_user_id, v_invite.role);
  end if;

  update public.invites
    set accepted_at = now(), accepted_by = v_user_id
    where id = v_invite.id;

  return v_invite.tenant_id;
end;
$$;

grant execute on function public.accept_invite(text) to authenticated;

-- invite_preview: allows anyone (even unauthenticated) to peek at a pending invite so the accept page
-- can show the tenant name and intended email without exposing the whole invites table.
create or replace function public.invite_preview(_token text)
returns table (
  email text,
  role app_role,
  tenant_name text,
  expires_at timestamptz,
  accepted boolean,
  expired boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select i.email,
         i.role,
         t.name as tenant_name,
         i.expires_at,
         (i.accepted_at is not null) as accepted,
         (i.expires_at < now()) as expired
  from public.invites i
  join public.tenants t on t.id = i.tenant_id
  where i.token = _token
  limit 1;
end;
$$;

grant execute on function public.invite_preview(text) to anon, authenticated;
;
