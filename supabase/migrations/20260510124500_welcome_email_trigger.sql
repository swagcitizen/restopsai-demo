-- Welcome email trigger: fires the send-trial-emails edge function the
-- moment a trialing subscription row is inserted, instead of waiting for
-- the daily cron. The edge function is idempotent (unique constraint on
-- tenant_email_log.tenant_id+kind) so the cron will safely no-op the
-- welcome later.

create or replace function public.fire_trial_welcome_email()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text := 'https://vmnhizmibdtlizigbzks.supabase.co/functions/v1/send-trial-emails';
begin
  if NEW.status = 'trialing'
     and NEW.tenant_id != 'a2e00ee7-1f30-4fbd-86b9-e560fc062f72'::uuid then
    -- Async fire-and-forget. pg_net returns a request id we don't need.
    perform extensions.http_post(
      url := v_url,
      body := jsonb_build_object('tenant_id', NEW.tenant_id, 'reason', 'subscription_insert'),
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_subscriptions_fire_welcome on public.subscriptions;
create trigger trg_subscriptions_fire_welcome
  after insert on public.subscriptions
  for each row
  execute function public.fire_trial_welcome_email();
