-- ============================================================================
-- Platform / Tenant Hard Separation
--
-- Goal: Platform owner accounts must NOT also be tenant owners. Tenants
-- can never read or write platform data (already enforced by RPC guards).
-- Platform can access tenants only via explicit impersonation, which is
-- now session-scoped via platform_impersonate_tenant / platform_exit_impersonation.
--
-- Changes:
--   1. Delete the empty duplicate Anthony's Pizza tenant (f22e6bba...).
--   2. Promote swagenterpriseinc@gmail.com to platform owner; demote zoubha.
--   3. Add CHECK: a profile cannot be is_platform_owner=true AND have any
--      memberships at the same time, enforced via trigger on both sides.
--   4. Rewrite platform_create_tenant to NOT auto-add the creator as a member.
--      Tenant is created orphan; platform invites a real owner.
--   5. Add platform_exit_impersonation RPC that removes the impersonation
--      membership row.
--   6. Allow the existing platform_impersonate_tenant / exit RPCs to bypass
--      the trigger via a session GUC (app.allow_platform_membership).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Delete the empty duplicate tenant. All FKs cascade.
-- ----------------------------------------------------------------------------
DELETE FROM public.tenants
WHERE id = 'f22e6bba-265b-4fba-98fb-9b5e00f19b28'
  AND name = 'Anthony''s Pizza & Pasta St Cloud, Florida'
  AND NOT EXISTS (
    SELECT 1 FROM public.staff WHERE tenant_id = 'f22e6bba-265b-4fba-98fb-9b5e00f19b28'
    UNION ALL
    SELECT 1 FROM public.menu_items WHERE tenant_id = 'f22e6bba-265b-4fba-98fb-9b5e00f19b28'
    UNION ALL
    SELECT 1 FROM public.inventory_items WHERE tenant_id = 'f22e6bba-265b-4fba-98fb-9b5e00f19b28'
    UNION ALL
    SELECT 1 FROM public.time_entries WHERE tenant_id = 'f22e6bba-265b-4fba-98fb-9b5e00f19b28'
  );

-- ----------------------------------------------------------------------------
-- 2. Swap platform owner. We do this BEFORE the trigger exists so the swap
--    is unconstrained for the initial cleanup.
-- ----------------------------------------------------------------------------
-- Demote zoubha first (so he is no longer platform owner)
UPDATE public.profiles
SET is_platform_owner = false
WHERE id = 'ade967e0-5a2c-4e55-a3f6-73e653b569ec';

-- Make sure swag has a profile row (he should from earlier signup), then promote.
INSERT INTO public.profiles (id, is_platform_owner)
VALUES ('3b26154b-09f2-4634-abec-d1019ed4b06d', true)
ON CONFLICT (id) DO UPDATE SET is_platform_owner = true;

-- Clear swag's default_tenant_id since his tenant is gone.
UPDATE public.profiles
SET default_tenant_id = NULL
WHERE id = '3b26154b-09f2-4634-abec-d1019ed4b06d';

-- ----------------------------------------------------------------------------
-- 3. Triggers enforcing hard separation
-- ----------------------------------------------------------------------------
-- Trigger A: when a row is INSERTED/UPDATED in memberships, if the user is a
-- platform owner, reject unless the session GUC allows it (impersonation).
CREATE OR REPLACE FUNCTION public.block_platform_owner_memberships()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_po boolean;
  allow text;
BEGIN
  SELECT p.is_platform_owner INTO is_po
  FROM public.profiles p
  WHERE p.id = NEW.user_id;

  IF COALESCE(is_po, false) = false THEN
    RETURN NEW;
  END IF;

  -- Platform owner. Allow only when invoked from a platform RPC that set the GUC.
  allow := current_setting('app.allow_platform_membership', true);
  IF allow IS NULL OR allow <> 'true' THEN
    RAISE EXCEPTION 'platform_owner_cannot_have_membership' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_platform_owner_memberships ON public.memberships;
CREATE TRIGGER trg_block_platform_owner_memberships
BEFORE INSERT OR UPDATE ON public.memberships
FOR EACH ROW EXECUTE FUNCTION public.block_platform_owner_memberships();

-- Trigger B: when a profile is being flipped to is_platform_owner=true,
-- reject if the user has any memberships.
CREATE OR REPLACE FUNCTION public.block_membership_holder_from_platform()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_memb boolean;
BEGIN
  IF COALESCE(NEW.is_platform_owner, false) = false THEN
    RETURN NEW;
  END IF;

  -- About to be platform owner. Must have zero memberships.
  SELECT EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id = NEW.id) INTO has_memb;
  IF has_memb THEN
    RAISE EXCEPTION 'user_with_membership_cannot_be_platform_owner' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_membership_holder_from_platform ON public.profiles;
CREATE TRIGGER trg_block_membership_holder_from_platform
BEFORE INSERT OR UPDATE OF is_platform_owner ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.block_membership_holder_from_platform();

-- ----------------------------------------------------------------------------
-- 4. platform_create_tenant: do NOT auto-add creator as member.
--    Caller must subsequently issue an invite for the real owner.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_create_tenant(
  _name text,
  _restaurant_type text,
  _state text DEFAULT 'FL'::text,
  _city text DEFAULT NULL::text,
  _timezone text DEFAULT 'America/New_York'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.is_platform_owner = true
  ) THEN
    RAISE EXCEPTION 'not_platform_owner';
  END IF;

  INSERT INTO public.tenants (
    name, restaurant_type, city, state, timezone, plan, subscription_status, trial_ends_at
  )
  VALUES (
    _name, _restaurant_type, _city, _state, _timezone, 'trial', 'trialing', now() + interval '14 days'
  )
  RETURNING id INTO new_id;

  -- Intentionally NO membership insertion. Platform user remains separate.
  -- Use platform_invite_tenant_owner or platform_impersonate_tenant afterwards.

  RETURN new_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. platform_impersonate_tenant: keep behavior but mark membership rows as
--    transient by setting the GUC so the trigger lets them through.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_impersonate_tenant(_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.is_platform_owner = true
  ) THEN
    RAISE EXCEPTION 'not_platform_owner';
  END IF;

  -- Mark this transaction as allowed to give platform owners memberships.
  PERFORM set_config('app.allow_platform_membership', 'true', true);

  INSERT INTO public.memberships (user_id, tenant_id, role)
  VALUES (auth.uid(), _tenant_id, 'owner')
  ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = 'owner';

  UPDATE public.profiles SET default_tenant_id = _tenant_id WHERE id = auth.uid();
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. New: platform_exit_impersonation removes the membership and clears the
--    default tenant. Call this when the platform owner finishes impersonating.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_exit_impersonation(_tenant_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = uid AND p.is_platform_owner = true
  ) THEN
    RAISE EXCEPTION 'not_platform_owner';
  END IF;

  IF _tenant_id IS NULL THEN
    -- Remove all impersonation memberships for this platform user.
    DELETE FROM public.memberships WHERE user_id = uid;
  ELSE
    DELETE FROM public.memberships WHERE user_id = uid AND tenant_id = _tenant_id;
  END IF;

  UPDATE public.profiles SET default_tenant_id = NULL WHERE id = uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_exit_impersonation(uuid) TO authenticated;
