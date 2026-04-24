-- Migration: init_restopsai
-- Version: 20260421185354
-- Pulled from production DB schema_migrations table

-- RestOps AI initial schema

-- 1. EXTENSIONS
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- 2. ENUMS
do $$ begin
  create type app_role as enum ('owner', 'manager', 'staff');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_plan as enum ('trial', 'starter', 'pro', 'multi');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'frozen');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_frequency as enum ('daily', 'weekly', 'monthly', 'quarterly', 'annual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_severity as enum ('critical', 'important', 'routine');
exception when duplicate_object then null; end $$;

do $$ begin
  create type pos_provider as enum ('toast', 'square', 'clover', 'manual', 'other');
exception when duplicate_object then null; end $$;

-- 3. CORE TENANCY TABLES
create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  restaurant_type text not null default 'other',
  city text,
  state text,
  timezone text default 'America/New_York',
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  plan subscription_plan not null default 'trial',
  subscription_status subscription_status not null default 'trialing',
  trial_ends_at timestamptz default (now() + interval '14 days'),
  current_period_end timestamptz,
  settings jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  avatar_url text,
  default_tenant_id uuid references tenants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, tenant_id)
);

create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  role app_role not null check (role in ('manager', 'staff')),
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 4. HELPER FUNCTIONS
create or replace function is_tenant_member(_tenant_id uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (select 1 from memberships where user_id = auth.uid() and tenant_id = _tenant_id);
$$;

create or replace function tenant_role(_tenant_id uuid)
returns app_role language sql security definer stable
set search_path = public as $$
  select role from memberships where user_id = auth.uid() and tenant_id = _tenant_id limit 1;
$$;

create or replace function is_tenant_manager_or_owner(_tenant_id uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (select 1 from memberships where user_id = auth.uid() and tenant_id = _tenant_id and role in ('owner', 'manager'));
$$;

create or replace function is_tenant_owner(_tenant_id uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (select 1 from memberships where user_id = auth.uid() and tenant_id = _tenant_id and role = 'owner');
$$;

create or replace function tenant_has_plan(_tenant_id uuid, _plans subscription_plan[])
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (select 1 from tenants where id = _tenant_id and plan = any(_plans) and subscription_status in ('trialing', 'active'));
$$;
;
