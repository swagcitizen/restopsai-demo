-- Migration: fix_platform_list_tenants_email_cast
-- Version: 20260424202350
-- Pulled from production DB schema_migrations table

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
    (SELECT u.email::text FROM public.memberships m JOIN auth.users u ON u.id = m.user_id WHERE m.tenant_id = t.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) AS owner_email
  FROM public.tenants t
  WHERE t.deleted_at IS NULL
  ORDER BY t.created_at DESC;
END;
$$;;
