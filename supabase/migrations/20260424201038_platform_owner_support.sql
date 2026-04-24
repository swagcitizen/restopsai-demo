-- Migration: platform_owner_support
-- Version: 20260424201038
-- Pulled from production DB schema_migrations table

-- Add is_platform_owner flag to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_platform_owner boolean NOT NULL DEFAULT false;

-- Auto-promote the founder account when they sign up
CREATE OR REPLACE FUNCTION public.auto_promote_platform_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = NEW.id;
  IF lower(v_email) IN ('zoubha@gmail.com') THEN
    NEW.is_platform_owner := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_promote_platform_owner ON public.profiles;
CREATE TRIGGER trg_auto_promote_platform_owner
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.auto_promote_platform_owner();

-- Also promote any existing profile that matches (idempotent backfill)
UPDATE public.profiles
SET is_platform_owner = true
WHERE id IN (
  SELECT id FROM auth.users WHERE lower(email) IN ('zoubha@gmail.com')
);

-- RPC: list all tenants (platform owner only)
CREATE OR REPLACE FUNCTION public.platform_list_tenants()
RETURNS TABLE (
  id uuid,
  name text,
  restaurant_type text,
  city text,
  state text,
  plan text,
  subscription_status text,
  trial_ends_at timestamptz,
  created_at timestamptz,
  member_count bigint,
  owner_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_platform_owner = true) THEN
    RAISE EXCEPTION 'not_platform_owner';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    t.name,
    t.restaurant_type,
    t.city,
    t.state,
    t.plan::text,
    t.subscription_status::text,
    t.trial_ends_at,
    t.created_at,
    (SELECT count(*) FROM public.memberships m WHERE m.tenant_id = t.id) AS member_count,
    (SELECT u.email FROM public.memberships m JOIN auth.users u ON u.id = m.user_id WHERE m.tenant_id = t.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) AS owner_email
  FROM public.tenants t
  WHERE t.deleted_at IS NULL
  ORDER BY t.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_list_tenants() TO authenticated;

-- RPC: create a new tenant as platform owner (makes current user an owner so they can impersonate immediately)
CREATE OR REPLACE FUNCTION public.platform_create_tenant(
  _name text,
  _restaurant_type text,
  _state text DEFAULT 'FL',
  _city text DEFAULT NULL,
  _timezone text DEFAULT 'America/New_York'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_platform_owner = true) THEN
    RAISE EXCEPTION 'not_platform_owner';
  END IF;

  INSERT INTO public.tenants (name, restaurant_type, city, state, timezone, plan, subscription_status, trial_ends_at)
  VALUES (_name, _restaurant_type, _city, _state, _timezone, 'trial', 'trialing', now() + interval '14 days')
  RETURNING id INTO new_id;

  INSERT INTO public.memberships (user_id, tenant_id, role)
  VALUES (auth.uid(), new_id, 'owner');

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_create_tenant(text, text, text, text, text) TO authenticated;

-- RPC: impersonate a tenant — adds the platform owner as a member of the tenant
-- (RLS already gates data by membership, so adding a membership is the impersonation mechanism).
-- Role = 'owner' so they get full visibility inside that tenant.
CREATE OR REPLACE FUNCTION public.platform_impersonate_tenant(_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_platform_owner = true) THEN
    RAISE EXCEPTION 'not_platform_owner';
  END IF;

  -- Ensure a membership exists for the platform owner; upsert into owner role.
  INSERT INTO public.memberships (user_id, tenant_id, role)
  VALUES (auth.uid(), _tenant_id, 'owner')
  ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = 'owner';

  -- Set as their default tenant so next login lands there
  UPDATE public.profiles SET default_tenant_id = _tenant_id WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_impersonate_tenant(uuid) TO authenticated;
;
