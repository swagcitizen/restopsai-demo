-- 20260515003000_recipes.sql
-- Recipe Book + Training + Cook Sessions.
-- Augments existing minimal `recipes` / `recipe_ingredients` (kept for variance)
-- with menu/training fields, plus new tables for steps, quizzes, training,
-- and cook sessions. Adds a storage bucket and a roll-up view.

-- ── Augment recipes ──────────────────────────────────────────────────────────
alter table recipes add column if not exists description text default '';
alter table recipes add column if not exists category text not null default 'entree';
alter table recipes add column if not exists yield_qty numeric(10,3) default 1;
alter table recipes add column if not exists yield_unit text default 'portions';
alter table recipes add column if not exists is_subrecipe boolean not null default false;
alter table recipes add column if not exists pizza_template boolean not null default false;
alter table recipes add column if not exists plate_price numeric(10,2);
alter table recipes add column if not exists allergens text[] default '{}';
alter table recipes add column if not exists status text not null default 'draft';
alter table recipes add column if not exists hero_photo_url text;
alter table recipes add column if not exists pizza_sizes jsonb default '{}'::jsonb;
alter table recipes add column if not exists created_by uuid references auth.users(id) on delete set null;

update recipes set status='published' where status is null or status='';
update recipes set plate_price = menu_price where plate_price is null and menu_price is not null;

-- ── Augment recipe_ingredients ───────────────────────────────────────────────
alter table recipe_ingredients add column if not exists inventory_item_id uuid references inventory_items(id) on delete set null;
alter table recipe_ingredients add column if not exists sub_recipe_id uuid references recipes(id) on delete restrict;
alter table recipe_ingredients add column if not exists display_name text;
alter table recipe_ingredients add column if not exists prep_note text default '';
alter table recipe_ingredients add column if not exists created_at timestamptz not null default now();

update recipe_ingredients set display_name = name where display_name is null and name is not null;

-- ── New tables ───────────────────────────────────────────────────────────────
create table if not exists recipe_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  step_no integer not null default 1,
  instruction text not null default '',
  photo_url text,
  timer_seconds integer,
  critical boolean not null default false,
  tip text default '',
  created_at timestamptz not null default now()
);
create index if not exists recipe_steps_recipe_idx on recipe_steps(recipe_id, step_no);

create table if not exists recipe_quiz (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  question text not null,
  choices jsonb not null default '[]'::jsonb,
  correct_idx integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists recipe_quiz_recipe_idx on recipe_quiz(recipe_id, sort_order);

create table if not exists recipe_training (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  walked_through_at timestamptz,
  quiz_completed_at timestamptz,
  quiz_score integer,
  quiz_total integer,
  certified boolean not null default false,
  certified_at timestamptz,
  certified_by uuid references staff(id) on delete set null,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipe_id, staff_id)
);
create index if not exists recipe_training_tenant_idx on recipe_training(tenant_id);
create index if not exists recipe_training_staff_idx  on recipe_training(staff_id);

create table if not exists recipe_cook_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  staff_id uuid references staff(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  batch_multiplier numeric(8,3) not null default 1.0,
  inventory_deducted boolean not null default false,
  prep_label_id uuid,
  notes text default '',
  created_at timestamptz not null default now()
);
create index if not exists cook_sessions_tenant_idx on recipe_cook_sessions(tenant_id, started_at desc);
create index if not exists cook_sessions_recipe_idx on recipe_cook_sessions(recipe_id, started_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table recipes               enable row level security;
alter table recipe_ingredients    enable row level security;
alter table recipe_steps          enable row level security;
alter table recipe_quiz           enable row level security;
alter table recipe_training       enable row level security;
alter table recipe_cook_sessions  enable row level security;

drop policy if exists "recipes_read" on recipes;
create policy "recipes_read" on recipes for select using (tenant_id in (select tenant_id from memberships where user_id = auth.uid()));
drop policy if exists "recipes_write" on recipes;
create policy "recipes_write" on recipes for all using (tenant_id in (select tenant_id from memberships where user_id = auth.uid() and role::text in ('owner','manager'))) with check (tenant_id in (select tenant_id from memberships where user_id = auth.uid() and role::text in ('owner','manager')));

drop policy if exists "ri_read"  on recipe_ingredients;
create policy "ri_read" on recipe_ingredients for select using (recipe_id in (select id from recipes where tenant_id in (select tenant_id from memberships where user_id = auth.uid())));
drop policy if exists "ri_write" on recipe_ingredients;
create policy "ri_write" on recipe_ingredients for all using (recipe_id in (select id from recipes where tenant_id in (select tenant_id from memberships where user_id = auth.uid() and role::text in ('owner','manager')))) with check (recipe_id in (select id from recipes where tenant_id in (select tenant_id from memberships where user_id = auth.uid() and role::text in ('owner','manager'))));

drop policy if exists "rs_read"  on recipe_steps;
create policy "rs_read" on recipe_steps for select using (recipe_id in (select id from recipes where tenant_id in (select tenant_id from memberships where user_id = auth.uid())));
drop policy if exists "rs_write" on recipe_steps;
create policy "rs_write" on recipe_steps for all using (recipe_id in (select id from recipes where tenant_id in (select tenant_id from memberships where user_id = auth.uid() and role::text in ('owner','manager')))) with check (recipe_id in (select id from recipes where tenant_id in (select tenant_id from memberships where user_id = auth.uid() and role::text in ('owner','manager'))));

drop policy if exists "rq_read"  on recipe_quiz;
create policy "rq_read" on recipe_quiz for select using (recipe_id in (select id from recipes where tenant_id in (select tenant_id from memberships where user_id = auth.uid())));
drop policy if exists "rq_write" on recipe_quiz;
create policy "rq_write" on recipe_quiz for all using (recipe_id in (select id from recipes where tenant_id in (select tenant_id from memberships where user_id = auth.uid() and role::text in ('owner','manager')))) with check (recipe_id in (select id from recipes where tenant_id in (select tenant_id from memberships where user_id = auth.uid() and role::text in ('owner','manager'))));

drop policy if exists "rt_read"  on recipe_training;
create policy "rt_read" on recipe_training for select using (tenant_id in (select tenant_id from memberships where user_id = auth.uid()));
drop policy if exists "rt_write" on recipe_training;
create policy "rt_write" on recipe_training for all using (tenant_id in (select tenant_id from memberships where user_id = auth.uid())) with check (tenant_id in (select tenant_id from memberships where user_id = auth.uid()));

drop policy if exists "rcs_read"  on recipe_cook_sessions;
create policy "rcs_read" on recipe_cook_sessions for select using (tenant_id in (select tenant_id from memberships where user_id = auth.uid()));
drop policy if exists "rcs_write" on recipe_cook_sessions;
create policy "rcs_write" on recipe_cook_sessions for all using (tenant_id in (select tenant_id from memberships where user_id = auth.uid())) with check (tenant_id in (select tenant_id from memberships where user_id = auth.uid()));

-- ── Storage bucket: 'recipes' (private, 25MB, image-only) ───────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('recipes', 'recipes', false, 26214400, array['image/png','image/jpeg','image/webp','image/heic'])
on conflict (id) do nothing;

drop policy if exists "recipes_storage_read"  on storage.objects;
create policy "recipes_storage_read" on storage.objects for select using (bucket_id = 'recipes' and (storage.foldername(name))[1] in (select tenant_id::text from memberships where user_id = auth.uid()));
drop policy if exists "recipes_storage_write" on storage.objects;
create policy "recipes_storage_write" on storage.objects for all using (bucket_id = 'recipes' and (storage.foldername(name))[1] in (select tenant_id::text from memberships where user_id = auth.uid() and role::text in ('owner','manager'))) with check (bucket_id = 'recipes' and (storage.foldername(name))[1] in (select tenant_id::text from memberships where user_id = auth.uid() and role::text in ('owner','manager')));

-- ── Roll-up view ─────────────────────────────────────────────────────────────
create or replace view recipe_summary as
select r.id, r.tenant_id, r.name, r.category, r.yield_qty, r.yield_unit, r.plate_price, r.status, r.is_subrecipe, r.pizza_template, r.allergens, r.hero_photo_url, r.updated_at,
  coalesce(sum(ri.qty * ii.unit_cost), 0)::numeric(10,2) as direct_cost,
  count(distinct ri.id) as ingredient_count,
  (select count(*) from recipe_steps s where s.recipe_id = r.id) as step_count,
  (select count(*) from recipe_quiz  q where q.recipe_id = r.id) as quiz_count
from recipes r
left join recipe_ingredients ri on ri.recipe_id = r.id
left join inventory_items ii on ii.id = ri.inventory_item_id
group by r.id;
