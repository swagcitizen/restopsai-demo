-- Auto-create a primary location row when a tenant is inserted.
-- Replaces the previous one-time backfill so newly-created tenants
-- always have a primary location for inventory + commissary flows.

CREATE OR REPLACE FUNCTION public.tg_create_primary_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.locations WHERE tenant_id = NEW.id AND is_primary = true
  ) THEN
    INSERT INTO public.locations (tenant_id, name, is_primary, is_commissary)
    VALUES (NEW.id, COALESCE(NEW.name, 'Main Location'), true, false);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_create_primary_location_trg ON public.tenants;
CREATE TRIGGER tenants_create_primary_location_trg
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tg_create_primary_location();
