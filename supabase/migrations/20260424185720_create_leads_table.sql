-- Migration: create_leads_table
-- Version: 20260424185720
-- Pulled from production DB schema_migrations table

-- Landing page email capture for stationly.ai
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text,
  user_agent text,
  referrer text,
  created_at timestamptz not null default now()
);

alter table public.leads enable row level security;

-- Allow anonymous inserts only (anon role can submit, nothing else)
drop policy if exists leads_anon_insert on public.leads;
create policy leads_anon_insert on public.leads
  for insert
  to anon
  with check (true);

-- Service role has full access by default (bypasses RLS) — no other policies needed
create index if not exists leads_created_idx on public.leads (created_at desc);;
