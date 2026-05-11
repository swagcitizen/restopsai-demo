-- Fix: fire_trial_welcome_email trigger called extensions.http_post(url, body, headers)
-- but the function actually lives at net.http_post with signature
--   (url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer).
-- This blew up Step 1 of onboarding (the moment a trialing subscription row is inserted)
-- with: function extensions.http_post(text, jsonb, jsonb) does not exist.
--
-- Replace with the correct net.http_post call. Wrap the call in EXCEPTION so a
-- transient http failure can never block subscription inserts (this trigger
-- fires on the user's onboarding/signup path).

CREATE OR REPLACE FUNCTION public.fire_trial_welcome_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  v_url     text := 'https://vmnhizmibdtlizigbzks.supabase.co/functions/v1/send-trial-emails';
  v_service text := current_setting('app.settings.service_role_key', true);
BEGIN
  IF NEW.status = 'trialing'
     AND NEW.tenant_id <> 'a2e00ee7-1f30-4fbd-86b9-e560fc062f72'::uuid THEN
    BEGIN
      PERFORM net.http_post(
        url     := v_url,
        body    := jsonb_build_object('tenant_id', NEW.tenant_id, 'reason', 'subscription_insert'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE(v_service, '')
        ),
        timeout_milliseconds := 5000
      );
    EXCEPTION WHEN others THEN
      -- Never block the insert because of a downstream email failure.
      RAISE WARNING 'fire_trial_welcome_email failed: %', sqlerrm;
    END;
  END IF;
  RETURN NEW;
END;
$$;
