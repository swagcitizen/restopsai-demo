-- Welcome-email trigger: shared-secret auth via app_settings
--
-- The fire_trial_welcome_email trigger fires inside the DB and calls the
-- send-trial-emails edge function via net.http_post. The function runs with
-- verify_jwt=false, so we authenticate the trigger -> function hop with a
-- shared secret carried in the x-stationly-trigger header.
--
-- The secret is stored in public.app_settings (singleton id=1) so it can be
-- rotated without redeploying the function. RLS keeps it readable only by
-- service_role; the trigger runs SECURITY DEFINER so it can read the row.
--
-- This migration is idempotent: it adds the column if missing, ensures a row
-- exists with a generated secret if none is set, and rewrites the trigger
-- function to read from app_settings and call net.http_post with the proper
-- named-arg signature (net.http_post(url, body, params, headers, timeout_milliseconds)).
--
-- Note: the actual secret value used in production was set out-of-band via
-- a one-off UPDATE; this migration only ensures *a* secret exists for fresh
-- environments. Production keeps its value.

-- 1. Ensure column exists.
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS trigger_secret text;

-- 2. Ensure singleton row exists with a secret (only if none present).
INSERT INTO public.app_settings (id, trigger_secret)
VALUES (1, encode(gen_random_bytes(24), 'base64'))
ON CONFLICT (id) DO UPDATE
  SET trigger_secret = COALESCE(public.app_settings.trigger_secret, EXCLUDED.trigger_secret);

-- 3. RLS: only service_role can read trigger_secret. Drop any prior overly
-- permissive policy on this row and re-add a service-role-only one.
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_settings_service_role_all ON public.app_settings;
CREATE POLICY app_settings_service_role_all
  ON public.app_settings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Rewrite the trigger function to use net.http_post with shared secret.
CREATE OR REPLACE FUNCTION public.fire_trial_welcome_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net'
AS $function$
DECLARE
  v_url    text := 'https://vmnhizmibdtlizigbzks.supabase.co/functions/v1/send-trial-emails';
  v_secret text;
BEGIN
  SELECT trigger_secret INTO v_secret FROM public.app_settings WHERE id = 1;

  IF NEW.status = 'trialing'
     AND NEW.tenant_id <> 'a2e00ee7-1f30-4fbd-86b9-e560fc062f72'::uuid THEN
    BEGIN
      PERFORM net.http_post(
        url     := v_url,
        body    := jsonb_build_object('tenant_id', NEW.tenant_id, 'reason', 'subscription_insert'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-stationly-trigger', COALESCE(v_secret, '')
        ),
        timeout_milliseconds := 5000
      );
    EXCEPTION WHEN others THEN
      -- Never block the INSERT/UPDATE; the daily cron will retry.
      RAISE WARNING 'fire_trial_welcome_email failed: %', sqlerrm;
    END;
  END IF;
  RETURN NEW;
END;
$function$;
