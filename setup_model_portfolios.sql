-- One-time setup for the Model Portfolio tab (save/load portfolios).
-- Paste this whole block into Supabase -> SQL Editor -> New query -> Run.
-- Safe to run more than once.

create table if not exists public.model_portfolios (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  benchmark  text,
  start_date date,
  holdings   jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.model_portfolios enable row level security;
drop policy if exists "model_portfolios read"  on public.model_portfolios;
drop policy if exists "model_portfolios write" on public.model_portfolios;
create policy "model_portfolios read"  on public.model_portfolios for select using (true);
create policy "model_portfolios write" on public.model_portfolios for all    using (true) with check (true);
