-- Owner Dashboard: unified Expenses ledger + live KPI RPCs
--
-- Design:
--   * We do NOT collapse bills/invoices/receipts/payroll into one table.
--     Those each have their own lifecycle (bills have due dates + payments,
--     payroll has staff/hours/tips, receipts have OCR pipelines).
--   * Instead we add ONE small table for true one-off expenses
--     (public.expenses_misc) and ONE read-only VIEW (public.v_expense_ledger)
--     that UNIONs every expense source into a normalized shape the owner
--     dashboard can render and filter.
--   * RPCs return JSON aggregates the dashboard reads directly. They are
--     SECURITY DEFINER and gate by membership(owner|manager) so the
--     publishable anon key cannot read tenant numbers.

-- ============================================================================
-- 1. expenses_misc — for one-off expenses that aren't invoices/bills/receipts
-- ============================================================================
create table if not exists public.expenses_misc (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  occurred_on   date not null default current_date,
  vendor        text,
  category      text not null default 'other',
  amount        numeric(12,2) not null,
  notes         text,
  attachment_url text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_expenses_misc_tenant_date on public.expenses_misc(tenant_id, occurred_on desc);
create index if not exists idx_expenses_misc_category on public.expenses_misc(tenant_id, category);

alter table public.expenses_misc enable row level security;

drop policy if exists expenses_misc_read on public.expenses_misc;
create policy expenses_misc_read on public.expenses_misc
  for select using (
    exists (select 1 from public.memberships m
             where m.user_id = auth.uid() and m.tenant_id = expenses_misc.tenant_id)
  );

drop policy if exists expenses_misc_write on public.expenses_misc;
create policy expenses_misc_write on public.expenses_misc
  for all using (
    exists (select 1 from public.memberships m
             where m.user_id = auth.uid()
               and m.tenant_id = expenses_misc.tenant_id
               and m.role::text in ('owner','manager'))
  ) with check (
    exists (select 1 from public.memberships m
             where m.user_id = auth.uid()
               and m.tenant_id = expenses_misc.tenant_id
               and m.role::text in ('owner','manager'))
  );

-- updated_at trigger
create or replace function public.tg_expenses_misc_touch() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_expenses_misc_touch on public.expenses_misc;
create trigger trg_expenses_misc_touch before update on public.expenses_misc
  for each row execute function public.tg_expenses_misc_touch();


-- ============================================================================
-- 2. v_expense_ledger — read-only unified view of every expense source
-- ============================================================================
-- Categories used here are normalized so the dashboard cost-breakdown chart
-- can group cleanly. Source tables can store anything; the view maps it.
create or replace view public.v_expense_ledger as
  -- bills (the main AP flow — rent, utilities, vendor invoices that have a due date)
  select
    'bill'::text          as source_kind,
    b.id                  as source_id,
    b.tenant_id,
    b.bill_date           as occurred_on,
    coalesce(v.display_name, v.name, b.bill_number, 'Bill') as vendor,
    coalesce(
      case
        when lower(coalesce(v.name,'')) like any (array['%publix%','%sysco%','%us foods%','%restaurant depot%','%produce%','%meat%','%dairy%','%bakery%','%cheese%'])
          then 'food'
        when lower(coalesce(v.name,'')) like any (array['%duke energy%','%electric%','%water%','%gas%','%utility%','%comcast%','%verizon%','%internet%'])
          then 'utilities'
        when lower(coalesce(v.name,'')) like any (array['%rent%','%landlord%','%property%','%lease%'])
          then 'rent'
        when lower(coalesce(v.name,'')) like any (array['%insurance%'])
          then 'insurance'
        when lower(coalesce(v.name,'')) like any (array['%doordash%','%ubereats%','%grubhub%','%toast%','%square%','%stripe%','%pos%'])
          then 'fees'
        else 'other'
      end,
      'other'
    ) as category,
    b.amount              as amount,
    b.status              as status,
    b.notes               as notes,
    null::text            as attachment_url
  from public.bills b
  left join public.vendors v on v.id = b.vendor_id

  union all

  -- invoices (vendor invoices captured pre-AP — food cost shopping)
  select
    'invoice'::text       as source_kind,
    i.id                  as source_id,
    i.tenant_id,
    i.invoice_date        as occurred_on,
    coalesce(i.vendor, 'Vendor invoice') as vendor,
    'food'::text          as category,    -- invoices in this codebase are food vendor invoices
    coalesce(i.total, i.subtotal, 0) as amount,
    coalesce(i.status, 'open') as status,
    i.notes               as notes,
    i.image_url           as attachment_url
  from public.invoices i

  union all

  -- receipts (cash purchases / employee reimbursements / petty cash)
  select
    'receipt'::text       as source_kind,
    r.id                  as source_id,
    r.tenant_id,
    coalesce(r.receipt_date, r.uploaded_at::date) as occurred_on,
    coalesce(r.vendor_name, 'Receipt') as vendor,
    coalesce(r.category, 'other') as category,
    coalesce(r.total_amount, 0) as amount,
    coalesce(r.bill_status, 'recorded') as status,
    r.notes               as notes,
    null::text            as attachment_url
  from public.receipts r
  where r.voided_at is null

  union all

  -- payroll (one row per pay run — total gross including tips that came out of pocket)
  select
    'payroll'::text       as source_kind,
    pr.id                 as source_id,
    pr.tenant_id,
    pr.generated_at::date as occurred_on,
    'Payroll'::text       as vendor,
    'labor'::text         as category,
    coalesce(pr.total_gross, 0) as amount,
    'paid'::text          as status,
    pr.notes              as notes,
    null::text            as attachment_url
  from public.pay_runs pr

  union all

  -- waste (book it as a food loss against expenses — small but visible)
  select
    'waste'::text         as source_kind,
    w.id                  as source_id,
    w.tenant_id,
    w.logged_at::date     as occurred_on,
    coalesce(w.item, 'Waste') as vendor,
    'waste'::text         as category,
    coalesce(w.dollar_loss, 0) as amount,
    'logged'::text        as status,
    w.reason              as notes,
    null::text            as attachment_url
  from public.waste_logs w

  union all

  -- expenses_misc (true one-offs the user enters manually)
  select
    'misc'::text          as source_kind,
    e.id                  as source_id,
    e.tenant_id,
    e.occurred_on,
    coalesce(e.vendor, 'Other expense') as vendor,
    coalesce(e.category, 'other') as category,
    coalesce(e.amount, 0) as amount,
    'recorded'::text      as status,
    e.notes               as notes,
    e.attachment_url
  from public.expenses_misc e
;

-- The view inherits the underlying table RLS through Postgres rules — the
-- view itself doesn't need a separate policy. We grant select on the view
-- to authenticated; underlying RLS enforces tenant isolation.
grant select on public.v_expense_ledger to authenticated;


-- ============================================================================
-- 3. expense_ledger(tenant, range, filters) — paginated ledger query
-- ============================================================================
create or replace function public.expense_ledger(
  _tenant_id uuid,
  _from date default null,
  _to date default null,
  _category text default null,
  _source_kind text default null,
  _limit int default 200
) returns table (
  source_kind text,
  source_id uuid,
  occurred_on date,
  vendor text,
  category text,
  amount numeric,
  status text,
  notes text,
  attachment_url text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- tenant gate: caller must be a member of this tenant
  if not exists (
    select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = _tenant_id
        and m.role::text in ('owner','manager')
  ) then
    raise exception 'forbidden';
  end if;

  return query
    select l.source_kind, l.source_id, l.occurred_on, l.vendor, l.category, l.amount, l.status, l.notes, l.attachment_url
      from public.v_expense_ledger l
     where l.tenant_id = _tenant_id
       and (_from is null or l.occurred_on >= _from)
       and (_to   is null or l.occurred_on <= _to)
       and (_category is null or l.category = _category)
       and (_source_kind is null or l.source_kind = _source_kind)
     order by l.occurred_on desc, l.amount desc
     limit greatest(coalesce(_limit, 200), 1);
end;
$$;

revoke all on function public.expense_ledger(uuid, date, date, text, text, int) from public, anon;
grant execute on function public.expense_ledger(uuid, date, date, text, text, int) to authenticated;


-- ============================================================================
-- 4. dashboard_kpis(tenant, days) — single-call KPI bundle
-- ============================================================================
create or replace function public.dashboard_kpis(
  _tenant_id uuid,
  _days int default 30
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from date := current_date - greatest(_days, 1);
  v_prev_from date := v_from - greatest(_days, 1);
  v_prev_to   date := v_from - 1;

  v_rev numeric := 0;
  v_rev_prev numeric := 0;
  v_food numeric := 0;
  v_labor numeric := 0;
  v_ops numeric := 0;
  v_expenses_total numeric := 0;
  v_tx int := 0;
begin
  if not exists (
    select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = _tenant_id
        and m.role::text in ('owner','manager')
  ) then raise exception 'forbidden'; end if;

  -- Revenue: prefer daily_sales (already aggregated); fall back to pos_transactions
  select coalesce(sum(gross_revenue),0) into v_rev
    from public.daily_sales
    where tenant_id = _tenant_id and sales_date >= v_from;

  if v_rev = 0 then
    select coalesce(sum(gross_amount),0), count(*) into v_rev, v_tx
      from public.pos_transactions
      where tenant_id = _tenant_id and occurred_at >= v_from;
  else
    select coalesce(sum(transactions),0) into v_tx
      from public.daily_sales where tenant_id = _tenant_id and sales_date >= v_from;
  end if;

  -- Previous-period revenue for comparison delta
  select coalesce(sum(gross_revenue),0) into v_rev_prev
    from public.daily_sales
    where tenant_id = _tenant_id and sales_date between v_prev_from and v_prev_to;

  -- Food / labor / ops from the unified ledger
  select
    coalesce(sum(case when category in ('food','waste') then amount else 0 end),0),
    coalesce(sum(case when category = 'labor' then amount else 0 end),0),
    coalesce(sum(case when category not in ('food','waste','labor') then amount else 0 end),0),
    coalesce(sum(amount),0)
  into v_food, v_labor, v_ops, v_expenses_total
  from public.v_expense_ledger
  where tenant_id = _tenant_id
    and occurred_on >= v_from;

  return jsonb_build_object(
    'days', _days,
    'from', v_from,
    'to',   current_date,
    'revenue', v_rev,
    'revenue_prev', v_rev_prev,
    'revenue_delta_pct',
      case when v_rev_prev > 0 then round(((v_rev - v_rev_prev) / v_rev_prev) * 100, 1) else null end,
    'food_cost', v_food,
    'labor_cost', v_labor,
    'ops_cost', v_ops,
    'expenses_total', v_expenses_total,
    'transactions', v_tx,
    'food_pct',  case when v_rev > 0 then round((v_food  / v_rev) * 100, 1) else 0 end,
    'labor_pct', case when v_rev > 0 then round((v_labor / v_rev) * 100, 1) else 0 end,
    'prime_pct', case when v_rev > 0 then round(((v_food + v_labor) / v_rev) * 100, 1) else 0 end,
    'net_pct',   case when v_rev > 0 then round(((v_rev - v_expenses_total) / v_rev) * 100, 1) else 0 end,
    'net_amount', v_rev - v_expenses_total
  );
end;
$$;

revoke all on function public.dashboard_kpis(uuid, int) from public, anon;
grant execute on function public.dashboard_kpis(uuid, int) to authenticated;


-- ============================================================================
-- 5. dashboard_breakdown(tenant, days) — category-rollup for the donut chart
-- ============================================================================
create or replace function public.dashboard_breakdown(
  _tenant_id uuid,
  _days int default 30
) returns table (category text, amount numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = _tenant_id
        and m.role::text in ('owner','manager')
  ) then raise exception 'forbidden'; end if;

  return query
    select l.category, sum(l.amount)::numeric as amount
      from public.v_expense_ledger l
     where l.tenant_id = _tenant_id
       and l.occurred_on >= current_date - greatest(_days, 1)
     group by l.category
     order by amount desc;
end;
$$;

revoke all on function public.dashboard_breakdown(uuid, int) from public, anon;
grant execute on function public.dashboard_breakdown(uuid, int) to authenticated;


-- ============================================================================
-- 6. dashboard_revenue_series(tenant, days) — daily revenue + prime cost
-- ============================================================================
create or replace function public.dashboard_revenue_series(
  _tenant_id uuid,
  _days int default 30
) returns table (day date, revenue numeric, prime_cost numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_from date := current_date - greatest(_days, 1);
begin
  if not exists (
    select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = _tenant_id
        and m.role::text in ('owner','manager')
  ) then raise exception 'forbidden'; end if;

  return query
    with days as (
      select generate_series(v_from, current_date, '1 day'::interval)::date as day
    ),
    rev as (
      select sales_date as day, coalesce(sum(gross_revenue),0) as revenue
        from public.daily_sales
        where tenant_id = _tenant_id and sales_date >= v_from
        group by 1
    ),
    prime as (
      select occurred_on as day,
             coalesce(sum(case when category in ('food','waste','labor') then amount else 0 end),0) as prime_cost
        from public.v_expense_ledger
        where tenant_id = _tenant_id and occurred_on >= v_from
        group by 1
    )
    select d.day, coalesce(r.revenue,0), coalesce(p.prime_cost,0)
      from days d
      left join rev r on r.day = d.day
      left join prime p on p.day = d.day
      order by d.day asc;
end;
$$;

revoke all on function public.dashboard_revenue_series(uuid, int) from public, anon;
grant execute on function public.dashboard_revenue_series(uuid, int) to authenticated;


-- ============================================================================
-- 7. dashboard_top_items(tenant, days) — top selling menu items
-- ============================================================================
create or replace function public.dashboard_top_items(
  _tenant_id uuid,
  _days int default 30,
  _limit int default 8
) returns table (item_name text, units int, revenue numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = _tenant_id
        and m.role::text in ('owner','manager')
  ) then raise exception 'forbidden'; end if;

  return query
    select coalesce(p.item_name, 'Item') as item_name,
           sum(coalesce(p.quantity,1))::int as units,
           sum(coalesce(p.gross_amount,0))::numeric as revenue
      from public.pos_line_items p
      join public.pos_transactions t on t.id = p.transaction_id
     where t.tenant_id = _tenant_id
       and t.occurred_at >= current_date - greatest(_days, 1)
     group by p.item_name
     order by revenue desc nulls last
     limit greatest(coalesce(_limit, 8), 1);
end;
$$;

revoke all on function public.dashboard_top_items(uuid, int, int) from public, anon;
grant execute on function public.dashboard_top_items(uuid, int, int) to authenticated;
