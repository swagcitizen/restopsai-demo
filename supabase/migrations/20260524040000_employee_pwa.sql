-- =============================================================================
-- Phase 4: Employee PWA — schema additions
-- =============================================================================
-- Adds:
--   * employee_pins   — bcrypt-hashed 4-digit PIN per staff with lockout state
--   * shift_extensions — manager-approved overage flow
--   * time_off_requests — staff-initiated PTO requests
-- Extends:
--   * staff           — link to auth user, so staff can log in directly
--   * time_entries    — geofence + selfie + device fingerprint columns
-- Adds RPCs:
--   * staff_clock_in  — Haversine geofence check, returns time_entry id + flag
--   * staff_clock_out — closes open shift
--   * apply_extension_decision — manager approves/denies overage request
-- Storage:
--   * clock-selfies   — 5MB bucket, RLS scoped per tenant
-- =============================================================================

-- ----- 1. Extend staff to link to an auth user (for self-login) ---------------
-- The existing 4-digit PIN column stays for legacy shared-tablet flow.
-- New staff PWA logs in with email/password OR PIN-via-edge-function.
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS staff_user_idx ON public.staff(user_id) WHERE user_id IS NOT NULL;

-- ----- 2. employee_pins (bcrypt + lockout) ------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE UNIQUE,
  pin_hash TEXT NOT NULL,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  set_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_pins_tenant_idx ON public.employee_pins(tenant_id);
ALTER TABLE public.employee_pins ENABLE ROW LEVEL SECURITY;

-- A staff member can read/update only their own PIN row.
CREATE POLICY "employee_pins_self_select" ON public.employee_pins
  FOR SELECT USING (
    staff_id IN (SELECT id FROM public.staff WHERE user_id = auth.uid())
  );
CREATE POLICY "employee_pins_self_upsert" ON public.employee_pins
  FOR INSERT WITH CHECK (
    staff_id IN (SELECT id FROM public.staff WHERE user_id = auth.uid())
  );
CREATE POLICY "employee_pins_self_update" ON public.employee_pins
  FOR UPDATE USING (
    staff_id IN (SELECT id FROM public.staff WHERE user_id = auth.uid())
  );

-- Managers in the same tenant can read PIN metadata (NOT the hash via RLS,
-- but the edge function uses service-role to verify hashes).
CREATE POLICY "employee_pins_manager_select" ON public.employee_pins
  FOR SELECT USING (
    tenant_id IN (
      SELECT m.tenant_id FROM public.memberships m
      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'manager')
    )
  );

-- ----- 3. shift_extensions ----------------------------------------------------
DO $$ BEGIN
  CREATE TYPE extension_status AS ENUM ('pending', 'approved', 'denied', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.shift_extensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  time_entry_id UUID NOT NULL REFERENCES public.time_entries(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  requested_minutes INT NOT NULL CHECK (requested_minutes BETWEEN 5 AND 240),
  reason TEXT,
  status extension_status NOT NULL DEFAULT 'pending',
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shift_extensions_tenant_idx ON public.shift_extensions(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS shift_extensions_entry_idx ON public.shift_extensions(time_entry_id);

ALTER TABLE public.shift_extensions ENABLE ROW LEVEL SECURITY;

-- Staff can read + insert their own extensions; managers in the tenant can read/update all.
CREATE POLICY "shift_extensions_self_select" ON public.shift_extensions
  FOR SELECT USING (
    staff_id IN (SELECT id FROM public.staff WHERE user_id = auth.uid())
  );
CREATE POLICY "shift_extensions_self_insert" ON public.shift_extensions
  FOR INSERT WITH CHECK (
    staff_id IN (SELECT id FROM public.staff WHERE user_id = auth.uid())
  );
CREATE POLICY "shift_extensions_self_cancel" ON public.shift_extensions
  FOR UPDATE USING (
    staff_id IN (SELECT id FROM public.staff WHERE user_id = auth.uid())
    AND status = 'pending'
  );
CREATE POLICY "shift_extensions_manager_all" ON public.shift_extensions
  FOR ALL USING (
    tenant_id IN (
      SELECT m.tenant_id FROM public.memberships m
      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'manager')
    )
  );

-- ----- 4. time_off_requests ---------------------------------------------------
DO $$ BEGIN
  CREATE TYPE time_off_kind AS ENUM ('personal', 'sick', 'vacation', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE time_off_status AS ENUM ('pending', 'approved', 'denied', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.time_off_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  kind time_off_kind NOT NULL DEFAULT 'personal',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  note TEXT,
  status time_off_status NOT NULL DEFAULT 'pending',
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS time_off_tenant_idx ON public.time_off_requests(tenant_id, status, start_date DESC);
ALTER TABLE public.time_off_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "time_off_self_rw" ON public.time_off_requests
  FOR ALL USING (
    staff_id IN (SELECT id FROM public.staff WHERE user_id = auth.uid())
  );
CREATE POLICY "time_off_manager_all" ON public.time_off_requests
  FOR ALL USING (
    tenant_id IN (
      SELECT m.tenant_id FROM public.memberships m
      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'manager')
    )
  );

-- ----- 5. Extend time_entries with geofence + selfie + device ----------------
ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS clock_in_lat NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS clock_in_lng NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS clock_in_accuracy_m NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS clock_in_photo_path TEXT,
  ADD COLUMN IF NOT EXISTS clock_in_device_id TEXT,
  ADD COLUMN IF NOT EXISTS clock_in_distance_m NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS flagged_buddy_punch BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS scheduled_end_at TIMESTAMPTZ;

-- ----- 6. Storage bucket for clock-in selfies --------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'clock-selfies',
  'clock-selfies',
  FALSE,
  5242880,  -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Path convention: <tenant_id>/<staff_id>/<time_entry_id>.jpg
-- Staff can upload to their own folder; managers can read all in their tenant.
CREATE POLICY "clock_selfies_staff_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'clock-selfies'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM public.memberships WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "clock_selfies_manager_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'clock-selfies'
    AND (storage.foldername(name))[1] IN (
      SELECT m.tenant_id::text FROM public.memberships m
      WHERE m.user_id = auth.uid()
    )
  );

-- =============================================================================
-- RPCs
-- =============================================================================

-- Haversine distance in meters between two lat/lng pairs.
CREATE OR REPLACE FUNCTION public._haversine_m(
  lat1 NUMERIC, lng1 NUMERIC, lat2 NUMERIC, lng2 NUMERIC
) RETURNS NUMERIC AS $$
DECLARE
  R CONSTANT NUMERIC := 6371000;  -- Earth radius in meters
  phi1 NUMERIC; phi2 NUMERIC; dphi NUMERIC; dlam NUMERIC; a NUMERIC;
BEGIN
  IF lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN
    RETURN NULL;
  END IF;
  phi1 := radians(lat1::FLOAT);
  phi2 := radians(lat2::FLOAT);
  dphi := radians((lat2 - lat1)::FLOAT);
  dlam := radians((lng2 - lng1)::FLOAT);
  a := sin(dphi/2)^2 + cos(phi1) * cos(phi2) * sin(dlam/2)^2;
  RETURN R * 2 * atan2(sqrt(a), sqrt(1 - a));
END;
$$ LANGUAGE plpgsql IMMUTABLE
   SET search_path = public, pg_temp;

-- staff_clock_in: opens a time_entries row with geofence + selfie metadata.
-- Reads venue lat/lng/geofence from tenants.settings JSON.
CREATE OR REPLACE FUNCTION public.staff_clock_in(
  p_lat NUMERIC,
  p_lng NUMERIC,
  p_accuracy_m NUMERIC,
  p_photo_path TEXT,
  p_device_id TEXT,
  p_scheduled_end_at TIMESTAMPTZ DEFAULT NULL
) RETURNS public.time_entries AS $$
DECLARE
  v_staff public.staff%ROWTYPE;
  v_tenant public.tenants%ROWTYPE;
  v_venue_lat NUMERIC;
  v_venue_lng NUMERIC;
  v_geofence_m NUMERIC;
  v_distance_m NUMERIC;
  v_flagged BOOLEAN;
  v_entry public.time_entries%ROWTYPE;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE user_id = auth.uid() LIMIT 1;
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'Not enrolled as staff';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = v_staff.tenant_id;

  v_venue_lat := (v_tenant.settings->>'venue_lat')::NUMERIC;
  v_venue_lng := (v_tenant.settings->>'venue_lng')::NUMERIC;
  v_geofence_m := COALESCE((v_tenant.settings->>'geofence_meters')::NUMERIC, 300);

  IF v_venue_lat IS NOT NULL AND v_venue_lng IS NOT NULL AND p_lat IS NOT NULL THEN
    v_distance_m := public._haversine_m(v_venue_lat, v_venue_lng, p_lat, p_lng);
    v_flagged := v_distance_m > v_geofence_m;
  ELSE
    v_distance_m := NULL;
    v_flagged := FALSE;
  END IF;

  INSERT INTO public.time_entries (
    tenant_id, staff_id, clock_in_at,
    clock_in_lat, clock_in_lng, clock_in_accuracy_m,
    clock_in_photo_path, clock_in_device_id, clock_in_distance_m,
    flagged_buddy_punch, scheduled_end_at
  ) VALUES (
    v_staff.tenant_id, v_staff.id, now(),
    p_lat, p_lng, p_accuracy_m,
    p_photo_path, p_device_id, v_distance_m,
    COALESCE(v_flagged, FALSE), p_scheduled_end_at
  )
  RETURNING * INTO v_entry;

  RETURN v_entry;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.staff_clock_in(NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_clock_in(NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

-- staff_clock_out: closes the open shift for the calling staff member.
CREATE OR REPLACE FUNCTION public.staff_clock_out(p_note TEXT DEFAULT NULL)
RETURNS public.time_entries AS $$
DECLARE
  v_staff_id UUID;
  v_entry public.time_entries%ROWTYPE;
BEGIN
  SELECT id INTO v_staff_id FROM public.staff WHERE user_id = auth.uid() LIMIT 1;
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Not enrolled as staff';
  END IF;

  UPDATE public.time_entries
     SET clock_out_at = now(),
         note = COALESCE(note, p_note)
   WHERE staff_id = v_staff_id AND clock_out_at IS NULL
   RETURNING * INTO v_entry;

  IF v_entry IS NULL THEN
    RAISE EXCEPTION 'No open shift to clock out';
  END IF;

  RETURN v_entry;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.staff_clock_out(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_clock_out(TEXT) TO authenticated;

-- apply_extension_decision: manager approves/denies a shift_extensions row.
-- If approved, the scheduled_end_at on the time_entry is pushed forward.
CREATE OR REPLACE FUNCTION public.apply_extension_decision(
  p_extension_id UUID,
  p_status TEXT,           -- 'approved' or 'denied'
  p_note TEXT DEFAULT NULL
) RETURNS public.shift_extensions AS $$
DECLARE
  v_ext public.shift_extensions%ROWTYPE;
  v_can BOOLEAN;
BEGIN
  IF p_status NOT IN ('approved', 'denied') THEN
    RAISE EXCEPTION 'status must be approved or denied';
  END IF;

  SELECT * INTO v_ext FROM public.shift_extensions WHERE id = p_extension_id;
  IF v_ext IS NULL THEN
    RAISE EXCEPTION 'Extension not found';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.memberships
    WHERE user_id = auth.uid() AND tenant_id = v_ext.tenant_id
      AND role IN ('owner', 'manager')
  ) INTO v_can;
  IF NOT v_can THEN
    RAISE EXCEPTION 'Only managers can decide extensions';
  END IF;

  UPDATE public.shift_extensions
     SET status = p_status::extension_status,
         decided_by = auth.uid(),
         decided_at = now(),
         decision_note = p_note
   WHERE id = p_extension_id
   RETURNING * INTO v_ext;

  IF p_status = 'approved' THEN
    UPDATE public.time_entries
       SET scheduled_end_at = COALESCE(scheduled_end_at, now()) + (v_ext.requested_minutes || ' minutes')::INTERVAL
     WHERE id = v_ext.time_entry_id;
  END IF;

  RETURN v_ext;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.apply_extension_decision(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_extension_decision(UUID, TEXT, TEXT) TO authenticated;

-- Convenience view: my current open shift (for the staff PWA Today screen).
CREATE OR REPLACE VIEW public.v_my_open_shift AS
  SELECT
    te.*,
    s.name AS staff_name,
    s.role AS staff_role
  FROM public.time_entries te
  JOIN public.staff s ON s.id = te.staff_id
  WHERE s.user_id = auth.uid() AND te.clock_out_at IS NULL;

GRANT SELECT ON public.v_my_open_shift TO authenticated;
