-- ============================================================================
-- Fix two bugs surfaced by live smoke test:
--   1. Client-side bcryptjs import from esm.sh fails at runtime
--      (`bcrypt.hash` is undefined). Move PIN hashing + verification to the
--      database using pgcrypto's crypt() / gen_salt('bf'). The plaintext PIN
--      never leaves Postgres after the RPC call.
--   2. accept_invite was deriving staff.name from the email local-part,
--      ignoring the full_name the user typed during signup. Read
--      auth.users.raw_user_meta_data->>'full_name' first.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1a. set_my_pin(_pin text): server-side bcrypt hash, upsert into employee_pins
-- ----------------------------------------------------------------------------
create or replace function public.set_my_pin(_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_staff record;
  v_hash text;
begin
  if v_user_id is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;

  if _pin is null or length(_pin) < 4 or length(_pin) > 8 or _pin !~ '^[0-9]+$' then
    raise exception 'invalid_pin_format' using errcode = 'P0001';
  end if;

  select id, tenant_id into v_staff
  from public.staff
  where user_id = v_user_id
  limit 1;

  if v_staff.id is null then
    raise exception 'not_enrolled_as_staff' using errcode = 'P0001';
  end if;

  v_hash := crypt(_pin, gen_salt('bf', 10));

  insert into public.employee_pins (tenant_id, staff_id, pin_hash, failed_attempts, locked_until, set_at, updated_at)
  values (v_staff.tenant_id, v_staff.id, v_hash, 0, null, now(), now())
  on conflict (staff_id) do update
    set pin_hash = excluded.pin_hash,
        failed_attempts = 0,
        locked_until = null,
        set_at = now(),
        updated_at = now();

  return true;
end;
$$;

grant execute on function public.set_my_pin(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 1b. verify_pin_by_email(_email text, _pin text): used by pin-login edge fn.
--     Returns the staff row + auth user id if PIN matches and not locked.
--     Otherwise returns nulls and increments failed_attempts.
--     SECURITY DEFINER + grant only to service_role so anon clients can't
--     brute-force directly; the edge function calls it with the service key.
-- ----------------------------------------------------------------------------
create or replace function public.verify_pin_by_email(_email text, _pin text)
returns table (
  ok boolean,
  reason text,
  user_id uuid,
  staff_id uuid,
  tenant_id uuid,
  staff_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_staff record;
  v_pin record;
  v_lockout_minutes int := 15;
  v_max_attempts int := 5;
begin
  -- Lookup the auth user by email
  select id into v_user_id from auth.users where lower(email) = lower(_email) limit 1;
  if v_user_id is null then
    return query select false, 'user_not_found'::text, null::uuid, null::uuid, null::uuid, null::text;
    return;
  end if;

  -- Lookup the staff row
  select s.id, s.tenant_id, s.name into v_staff
  from public.staff s
  where s.user_id = v_user_id
  limit 1;
  if v_staff.id is null then
    return query select false, 'not_enrolled'::text, v_user_id, null::uuid, null::uuid, null::text;
    return;
  end if;

  -- Lookup the PIN row
  select ep.pin_hash, ep.failed_attempts, ep.locked_until into v_pin
  from public.employee_pins ep
  where ep.staff_id = v_staff.id
  limit 1;
  if v_pin.pin_hash is null then
    return query select false, 'no_pin_set'::text, v_user_id, v_staff.id, v_staff.tenant_id, v_staff.name;
    return;
  end if;

  -- Check lockout
  if v_pin.locked_until is not null and v_pin.locked_until > now() then
    return query select false, 'locked'::text, v_user_id, v_staff.id, v_staff.tenant_id, v_staff.name;
    return;
  end if;

  -- Verify PIN
  if crypt(_pin, v_pin.pin_hash) = v_pin.pin_hash then
    -- Reset failures on success
    update public.employee_pins
       set failed_attempts = 0, locked_until = null, updated_at = now()
     where staff_id = v_staff.id;
    return query select true, 'ok'::text, v_user_id, v_staff.id, v_staff.tenant_id, v_staff.name;
    return;
  else
    -- Increment failures, lock if over threshold
    update public.employee_pins
       set failed_attempts = coalesce(failed_attempts,0) + 1,
           locked_until = case when coalesce(failed_attempts,0) + 1 >= v_max_attempts
                               then now() + (v_lockout_minutes || ' minutes')::interval
                               else null end,
           updated_at = now()
     where staff_id = v_staff.id;
    return query select false, 'invalid_pin'::text, v_user_id, v_staff.id, v_staff.tenant_id, v_staff.name;
    return;
  end if;
end;
$$;

-- Only the service role (used by the edge function) can call this.
revoke all on function public.verify_pin_by_email(text, text) from public, anon, authenticated;
grant execute on function public.verify_pin_by_email(text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 2. Rewrite accept_invite so new staff rows use the full_name supplied
--    during signup (auth.users.raw_user_meta_data->>'full_name'), falling
--    back to the email local-part only if that's missing.
-- ----------------------------------------------------------------------------
create or replace function public.accept_invite(_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
  v_user_id uuid := auth.uid();
  v_user record;
  v_existing_membership uuid;
  v_staff_id uuid;
  v_staff_name text;
begin
  if v_user_id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select email,
         coalesce(nullif(trim(raw_user_meta_data->>'full_name'), ''),
                  nullif(trim(raw_user_meta_data->>'name'), '')) as full_name
    into v_user
    from auth.users where id = v_user_id;

  select * into v_invite from public.invites where token = _token limit 1;

  if not found then
    raise exception 'Invite not found' using errcode = 'P0001';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'Invite has already been used' using errcode = 'P0001';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'Invite has expired' using errcode = 'P0001';
  end if;
  if lower(v_invite.email) <> lower(coalesce(v_user.email, '')) then
    raise exception 'This invite was sent to a different email address (%). Sign in with that account to accept it.', v_invite.email using errcode = 'P0001';
  end if;

  select id into v_existing_membership
  from public.memberships
  where tenant_id = v_invite.tenant_id and user_id = v_user_id
  limit 1;

  if v_existing_membership is null then
    insert into public.memberships (tenant_id, user_id, role)
    values (v_invite.tenant_id, v_user_id, v_invite.role);
  end if;

  if v_invite.role = 'staff' then
    -- Already linked?
    select id into v_staff_id from public.staff
     where tenant_id = v_invite.tenant_id and user_id = v_user_id limit 1;

    -- Match unlinked by email
    if v_staff_id is null then
      select id into v_staff_id from public.staff
       where tenant_id = v_invite.tenant_id and user_id is null
         and lower(coalesce(email, '')) = lower(v_user.email)
       order by created_at asc limit 1;

      if v_staff_id is not null then
        update public.staff
           set user_id = v_user_id,
               -- If the existing staff row has no name (or just the email),
               -- upgrade it with the signup name when we have one.
               name = case
                 when coalesce(nullif(trim(name), ''), '') = ''
                   or lower(name) = lower(v_user.email)
                 then coalesce(v_user.full_name, name)
                 else name
               end,
               active = true,
               updated_at = now()
         where id = v_staff_id;
      end if;
    end if;

    -- Auto-create with REAL name from signup metadata
    if v_staff_id is null then
      v_staff_name := coalesce(
        v_user.full_name,
        initcap(replace(split_part(v_user.email, '@', 1), '.', ' '))
      );
      if coalesce(trim(v_staff_name), '') = '' then v_staff_name := 'New Employee'; end if;

      insert into public.staff (tenant_id, user_id, name, role, email, active)
      values (v_invite.tenant_id, v_user_id, v_staff_name, 'staff', v_user.email, true)
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

-- ----------------------------------------------------------------------------
-- 3. Backfill: if a current staff row still has the email-derived placeholder
--    name, replace it with auth metadata's full_name when available.
-- ----------------------------------------------------------------------------
update public.staff s
set name = trim(u.raw_user_meta_data->>'full_name'),
    updated_at = now()
from auth.users u
where s.user_id = u.id
  and coalesce(trim(u.raw_user_meta_data->>'full_name'), '') <> ''
  and (
    s.name is null
    or s.name = ''
    or lower(s.name) = lower(u.email)
    or s.name = initcap(replace(split_part(u.email, '@', 1), '.', ' '))
  );
