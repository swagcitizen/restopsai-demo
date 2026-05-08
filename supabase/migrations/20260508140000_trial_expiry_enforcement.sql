-- Trial expiry enforcement (Phase 2).
--
-- Bug fix: tenant_billing_status returned access_ok=true for any 'trialing'
-- subscription, even after trial_ends_at had passed. Once the trial date
-- elapses we want the app to flip read-only.
--
-- Changes:
--   1. tenant_billing_status view:
--        - access_ok requires trial_ends_at > now() when status='trialing'
--        - new banner='trial_expired' state for trialing+expired
--   2. Helper public.tenant_has_write_access(uuid) — STABLE SECURITY DEFINER
--      so that RLS policies and edge functions can defense-in-depth check it
--      without leaking subscriptions rows.
--   3. Layer that helper into the most-hit user-facing write policies
--      (invoices, invoice_lines, time_entries, schedule_shifts, tasks,
--       inventory_counts, daily_sales) so a malicious client that bypasses
--      the JS gate still cannot write after trial expiry.
--      The demo tenant is exempt via tenant_has_write_access itself.

-- ---------- 1. Refresh view with trial_ends_at check ----------

create or replace view public.tenant_billing_status
with (security_invoker = true) as
select
  s.tenant_id,
  s.status,
  s.plan,
  s.billing_interval,
  s.quantity,
  s.current_period_end,
  s.cancel_at_period_end,
  s.trial_ends_at,
  s.past_due_since,
  s.current_price_id,
  s.stripe_customer_id,
  case
    when s.tenant_id = 'a2e00ee7-1f30-4fbd-86b9-e560fc062f72'::uuid then true
    when s.status = 'active' then true
    when s.status = 'trialing'
         and (s.trial_ends_at is null or s.trial_ends_at > now()) then true
    when s.status = 'past_due'
         and s.past_due_since is not null
         and s.past_due_since > (now() - interval '7 days') then true
    else false
  end as access_ok,
  case
    when s.status = 'trialing'
         and s.trial_ends_at is not null
         and s.trial_ends_at <= now() then 'trial_expired'
    when s.status = 'trialing' and s.trial_ends_at is not null then 'trial'
    when s.status = 'past_due' then 'past_due'
    when s.status = any (array['canceled','unpaid','incomplete_expired']) then 'lapsed'
    else null
  end as banner
from public.subscriptions s;

-- ---------- 2. Helper function for write-gate ----------

create or replace function public.tenant_has_write_access(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Demo tenant always writeable.
  -- Trialing tenants writeable only while trial_ends_at > now().
  -- Active and recent past_due (< 7 days) writeable.
  -- Anything else returns false.
  select coalesce(
    (
      select case
        when s.tenant_id = 'a2e00ee7-1f30-4fbd-86b9-e560fc062f72'::uuid then true
        when s.status = 'active' then true
        when s.status = 'trialing'
             and (s.trial_ends_at is null or s.trial_ends_at > now()) then true
        when s.status = 'past_due'
             and s.past_due_since is not null
             and s.past_due_since > (now() - interval '7 days') then true
        else false
      end
      from public.subscriptions s
      where s.tenant_id = p_tenant_id
      limit 1
    ),
    false
  );
$$;

revoke all on function public.tenant_has_write_access(uuid) from public;
grant execute on function public.tenant_has_write_access(uuid) to authenticated, service_role;

-- ---------- 3. Layer the gate into key write policies ----------
-- Strategy: keep existing policies (membership / role checks) intact and add
-- a parallel restrictive policy that requires write access. PostgreSQL ANDs
-- restrictive policies with permissive ones, so this acts as a hard gate.

-- Invoices + invoice_lines
drop policy if exists invoices_billing_gate on public.invoices;
create policy invoices_billing_gate on public.invoices
  as restrictive
  for all
  to authenticated
  using (public.tenant_has_write_access(tenant_id))
  with check (public.tenant_has_write_access(tenant_id));

drop policy if exists invoice_lines_billing_gate on public.invoice_lines;
create policy invoice_lines_billing_gate on public.invoice_lines
  as restrictive
  for all
  to authenticated
  using (public.tenant_has_write_access(tenant_id))
  with check (public.tenant_has_write_access(tenant_id));

-- Time entries
drop policy if exists time_entries_billing_gate on public.time_entries;
create policy time_entries_billing_gate on public.time_entries
  as restrictive
  for all
  to authenticated
  using (public.tenant_has_write_access(tenant_id))
  with check (public.tenant_has_write_access(tenant_id));

-- Schedule shifts
drop policy if exists schedule_shifts_billing_gate on public.schedule_shifts;
create policy schedule_shifts_billing_gate on public.schedule_shifts
  as restrictive
  for all
  to authenticated
  using (public.tenant_has_write_access(tenant_id))
  with check (public.tenant_has_write_access(tenant_id));

-- Tasks
drop policy if exists tasks_billing_gate on public.tasks;
create policy tasks_billing_gate on public.tasks
  as restrictive
  for all
  to authenticated
  using (public.tenant_has_write_access(tenant_id))
  with check (public.tenant_has_write_access(tenant_id));

-- Inventory counts + lines
drop policy if exists inventory_counts_billing_gate on public.inventory_counts;
create policy inventory_counts_billing_gate on public.inventory_counts
  as restrictive
  for all
  to authenticated
  using (public.tenant_has_write_access(tenant_id))
  with check (public.tenant_has_write_access(tenant_id));

drop policy if exists inventory_count_lines_billing_gate on public.inventory_count_lines;
create policy inventory_count_lines_billing_gate on public.inventory_count_lines
  as restrictive
  for all
  to authenticated
  using (public.tenant_has_write_access(tenant_id))
  with check (public.tenant_has_write_access(tenant_id));

-- Daily sales
drop policy if exists daily_sales_billing_gate on public.daily_sales;
create policy daily_sales_billing_gate on public.daily_sales
  as restrictive
  for all
  to authenticated
  using (public.tenant_has_write_access(tenant_id))
  with check (public.tenant_has_write_access(tenant_id));
