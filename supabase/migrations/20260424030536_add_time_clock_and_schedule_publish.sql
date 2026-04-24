-- Migration: add_time_clock_and_schedule_publish
-- Version: 20260424030536
-- Pulled from production DB schema_migrations table

-- Extend staff with a 4-digit PIN for tablet clock-in.
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS pin TEXT,
  ADD COLUMN IF NOT EXISTS pin_set_at TIMESTAMPTZ;

-- Uniqueness of PIN is scoped per tenant (two restaurants can both have PIN 1234).
CREATE UNIQUE INDEX IF NOT EXISTS staff_pin_per_tenant_idx
  ON public.staff(tenant_id, pin) WHERE pin IS NOT NULL;

-- TIME ENTRIES: one row per clock-in/clock-out pair.
CREATE TABLE IF NOT EXISTS public.time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  clock_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  clock_out_at TIMESTAMPTZ,
  break_minutes INTEGER DEFAULT 0,
  hourly_rate_snapshot NUMERIC(10,2),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS time_entries_staff_idx ON public.time_entries(staff_id, clock_in_at DESC);
CREATE INDEX IF NOT EXISTS time_entries_tenant_idx ON public.time_entries(tenant_id, clock_in_at DESC);

-- Only one open shift (no clock_out_at) per staff member at any time.
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_one_open_shift_idx
  ON public.time_entries(staff_id) WHERE clock_out_at IS NULL;

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "time_entries_tenant_select" ON public.time_entries
  FOR SELECT USING (tenant_id IN (SELECT m.tenant_id FROM public.memberships m WHERE m.user_id = auth.uid()));
CREATE POLICY "time_entries_tenant_insert" ON public.time_entries
  FOR INSERT WITH CHECK (tenant_id IN (SELECT m.tenant_id FROM public.memberships m WHERE m.user_id = auth.uid()));
CREATE POLICY "time_entries_tenant_update" ON public.time_entries
  FOR UPDATE USING (tenant_id IN (SELECT m.tenant_id FROM public.memberships m WHERE m.user_id = auth.uid()));
CREATE POLICY "time_entries_tenant_delete" ON public.time_entries
  FOR DELETE USING (tenant_id IN (SELECT m.tenant_id FROM public.memberships m WHERE m.user_id = auth.uid()));

-- SCHEDULE PUBLISHES: one row per time a manager publishes the weekly schedule.
-- Stores the snapshot + SMS delivery results so we can audit who got what text.
CREATE TABLE IF NOT EXISTS public.schedule_publishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  shifts JSONB NOT NULL,           -- snapshot of shifts published
  delivery_status TEXT DEFAULT 'pending',  -- pending | sent | partial | failed
  delivery_results JSONB,           -- [{ staffId, phone, status: 'sent'|'failed', twilio_sid?, error? }]
  note TEXT
);
CREATE INDEX IF NOT EXISTS schedule_publishes_tenant_week_idx ON public.schedule_publishes(tenant_id, week_start DESC);

ALTER TABLE public.schedule_publishes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schedule_publishes_tenant_select" ON public.schedule_publishes
  FOR SELECT USING (tenant_id IN (SELECT m.tenant_id FROM public.memberships m WHERE m.user_id = auth.uid()));
CREATE POLICY "schedule_publishes_tenant_insert" ON public.schedule_publishes
  FOR INSERT WITH CHECK (tenant_id IN (SELECT m.tenant_id FROM public.memberships m WHERE m.user_id = auth.uid()));
CREATE POLICY "schedule_publishes_tenant_update" ON public.schedule_publishes
  FOR UPDATE USING (tenant_id IN (SELECT m.tenant_id FROM public.memberships m WHERE m.user_id = auth.uid()));;
