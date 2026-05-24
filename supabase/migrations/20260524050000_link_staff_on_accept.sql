-- Migration: link_staff_on_accept
-- Version: 20260524050000
-- Purpose: Make accept_invite actually wire up the Employee PWA login.
--
-- Background: the Phase 4 staff PWA (/staff/) reads the current user's row
-- from public.staff by matching staff.user_id = auth.uid(). Until this
-- migration, accept_invite only created a memberships row, so a staff member
-- could redeem an invite, sign in, and still not have any staff record
-- attached to their auth user — which means clock-in/out, PIN setup, time-off
-- requests, etc. all fail silently.
--
-- This migration:
--   1. Replaces accept_invite so when role = 'staff' it ALSO links (or
--      creates) the staff row for that user.
--   2. Adds link_staff_to_user(_staff_id) for managers to retroactively
--      attach an existing staff row to a real auth user (e.g. they created
--      the staff record before inviting).

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
  v_staff_id uuid;
  v_staff_name text;
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

  -- Membership: idempotent insert.
  select id into v_existing_membership
  from public.memberships
  where tenant_id = v_invite.tenant_id and user_id = v_user_id
  limit 1;

  if v_existing_membership is null then
    insert into public.memberships (tenant_id, user_id, role)
    values (v_invite.tenant_id, v_user_id, v_invite.role);
  end if;

  -- Staff linking (only for staff-role invites). Owners/managers don't
  -- automatically get a staff row — they're not clocking in.
  if v_invite.role = 'staff' then
    -- 1. If a staff row already exists for this user_id in this tenant, do nothing.
    select id into v_staff_id
    from public.staff
    where tenant_id = v_invite.tenant_id and user_id = v_user_id
    limit 1;

    -- 2. Otherwise, try to find an unlinked staff row with matching email.
    if v_staff_id is null then
      select id into v_staff_id
      from public.staff
      where tenant_id = v_invite.tenant_id
        and user_id is null
        and lower(coalesce(email, '')) = lower(v_user_email)
      order by created_at asc
      limit 1;

      if v_staff_id is not null then
        update public.staff
           set user_id = v_user_id,
               active = true,
               updated_at = now()
         where id = v_staff_id;
      end if;
    end if;

    -- 3. Still no staff row? Auto-create one so the PWA works out of the box.
    if v_staff_id is null then
      -- Derive a reasonable display name from the email local-part.
      v_staff_name := initcap(replace(split_part(v_user_email, '@', 1), '.', ' '));
      if coalesce(v_staff_name, '') = '' then v_staff_name := 'New Employee'; end if;

      insert into public.staff (tenant_id, user_id, name, role, email, active)
      values (v_invite.tenant_id, v_user_id, v_staff_name, 'staff', v_user_email, true)
      returning id into v_staff_id;
    end if;
  end if;

  update public.invites
    set accepted_at = now(), accepted_by = v_user_id
    where id = v_invite.id;

  return v_invite.tenant_id;
end;
$$;

grant execute on function public.accept_invite(text) to authenticated;


-- link_staff_to_user: manager/owner-only RPC to retroactively attach a real
-- auth user to a pre-existing staff row by matching email. Useful when a
-- manager added staff manually months ago and only now invited them.
--
-- Strategy: find auth.users.id by lower(email), confirm there's an active
-- membership in this tenant for that user, then set staff.user_id.
create or replace function public.link_staff_to_user(_staff_id uuid)
returns uuid -- returns the linked user_id
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_staff record;
  v_caller_role text;
  v_target_user uuid;
begin
  if v_caller_id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into v_staff from public.staff where id = _staff_id;
  if not found then
    raise exception 'Staff member not found' using errcode = 'P0001';
  end if;

  -- Caller must be owner or manager in the same tenant.
  select role into v_caller_role
  from public.memberships
  where tenant_id = v_staff.tenant_id and user_id = v_caller_id
  limit 1;

  if v_caller_role is null or v_caller_role not in ('owner', 'manager') then
    raise exception 'Only owners and managers can link staff accounts' using errcode = '42501';
  end if;

  if v_staff.user_id is not null then
    return v_staff.user_id; -- already linked, no-op
  end if;

  if coalesce(v_staff.email, '') = '' then
    raise exception 'Staff member has no email on file. Edit their profile to add one before linking.' using errcode = 'P0001';
  end if;

  select u.id into v_target_user
  from auth.users u
  where lower(u.email) = lower(v_staff.email)
  limit 1;

  if v_target_user is null then
    raise exception 'No user account found for %. Send them an invite first; the staff row will link automatically when they accept.', v_staff.email using errcode = 'P0001';
  end if;

  -- Confirm they have a membership in this tenant.
  perform 1 from public.memberships
   where tenant_id = v_staff.tenant_id and user_id = v_target_user;
  if not found then
    raise exception 'User % is not a member of this tenant. Send them a staff invite first.', v_staff.email using errcode = 'P0001';
  end if;

  update public.staff
     set user_id = v_target_user,
         updated_at = now()
   where id = _staff_id;

  return v_target_user;
end;
$$;

grant execute on function public.link_staff_to_user(uuid) to authenticated;
