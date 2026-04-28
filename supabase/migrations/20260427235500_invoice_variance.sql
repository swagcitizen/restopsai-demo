-- Invoice variance detection
-- Adds auto-categorization on invoice_lines + a SQL function that computes
-- trailing-4-week mean per category and flags lines >threshold above mean.

-- 1. Category column on invoice_lines
alter table public.invoice_lines
  add column if not exists category text;

create index if not exists idx_invoice_lines_category
  on public.invoice_lines(tenant_id, category);

-- 2. Lightweight category inference function (keyword-based)
create or replace function public.infer_invoice_category(desc_text text)
returns text
language sql
immutable
as $$
  select case
    when desc_text is null then 'Other'
    when desc_text ~* '\m(beef|steak|chicken|pork|turkey|lamb|veal|sausage|bacon|ham|chorizo|prosciutto)\M' then 'Meat'
    when desc_text ~* '\m(fish|salmon|tuna|shrimp|cod|tilapia|crab|lobster|oyster|scallop|mussel|seafood)\M' then 'Seafood'
    when desc_text ~* '\m(milk|cheese|butter|cream|yogurt|mozz|cheddar|parm|ricotta|feta|gouda|brie)\M' then 'Dairy'
    when desc_text ~* '\m(lettuce|tomato|onion|pepper|carrot|potato|celery|garlic|mushroom|spinach|cucumber|broccoli|cabbage|kale|herb|cilantro|basil|produce|fruit|berry|apple|orange|lemon|lime|banana)\M' then 'Produce'
    when desc_text ~* '\m(flour|sugar|salt|pepper|spice|oil|vinegar|sauce|pasta|rice|bean|lentil|grain|cornmeal|breadcrumb|stock|broth)\M' then 'Dry Goods'
    when desc_text ~* '\m(bread|bun|roll|bagel|pita|tortilla|baguette|loaf)\M' then 'Bakery'
    when desc_text ~* '\m(beer|wine|liquor|vodka|whiskey|rum|gin|tequila|champagne|prosecco|cocktail|spirit)\M' then 'Alcohol'
    when desc_text ~* '\m(soda|cola|juice|water|coffee|tea|espresso|latte|smoothie|lemonade|beverage|drink)\M' then 'Beverage'
    when desc_text ~* '\m(napkin|cup|lid|straw|glove|towel|wrap|bag|container|togo|disposable|cleaner|sanitizer|soap|detergent|trash|liner)\M' then 'Supplies'
    else 'Other'
  end
$$;

-- 3. Backfill categories for existing rows
update public.invoice_lines
set category = public.infer_invoice_category(raw_description)
where category is null;

-- 4. Trigger to auto-categorize on insert/update if not provided
create or replace function public.tg_set_invoice_line_category()
returns trigger
language plpgsql
as $$
begin
  if new.category is null or new.category = '' then
    new.category := public.infer_invoice_category(new.raw_description);
  end if;
  return new;
end;
$$;

drop trigger if exists invoice_lines_set_category on public.invoice_lines;
create trigger invoice_lines_set_category
  before insert or update on public.invoice_lines
  for each row execute function public.tg_set_invoice_line_category();

-- 5. Variance check RPC: returns flagged lines for an invoice
create or replace function public.check_invoice_variance(p_invoice_id uuid, p_threshold numeric default 0.15)
returns table (
  line_id uuid,
  category text,
  raw_description text,
  current_unit_price numeric,
  baseline_avg_price numeric,
  variance_pct numeric,
  vendor text
)
language sql
stable
security invoker
as $$
  with target as (
    select il.id, il.tenant_id, il.category, il.raw_description, il.unit_price,
           i.vendor, i.invoice_date
    from public.invoice_lines il
    join public.invoices i on i.id = il.invoice_id
    where il.invoice_id = p_invoice_id
      and il.unit_price > 0
  ),
  baseline as (
    select t.id as line_id,
           avg(il.unit_price) as avg_price,
           count(il.id) as n_obs
    from target t
    left join public.invoice_lines il on il.tenant_id = t.tenant_id
      and il.category = t.category
      and il.id <> t.id
      and il.unit_price > 0
    left join public.invoices i2 on i2.id = il.invoice_id
      and i2.invoice_date >= (t.invoice_date - interval '28 days')
      and i2.invoice_date < t.invoice_date
    group by t.id
  )
  select t.id, t.category, t.raw_description, t.unit_price,
         round(b.avg_price::numeric, 4),
         round(((t.unit_price - b.avg_price) / nullif(b.avg_price, 0))::numeric, 4),
         t.vendor
  from target t
  join baseline b on b.line_id = t.id
  where b.avg_price is not null
    and b.n_obs >= 2
    and t.unit_price > b.avg_price * (1 + p_threshold)
  order by ((t.unit_price - b.avg_price) / nullif(b.avg_price, 0)) desc;
$$;

grant execute on function public.check_invoice_variance(uuid, numeric) to authenticated, service_role;
grant execute on function public.infer_invoice_category(text) to authenticated, service_role;

-- Note: invoice_variance alert rule is already seeded via the existing
-- public.seed_default_alert_rules(uuid) function; no need to redefine here.
