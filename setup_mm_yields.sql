-- One-time setup for the Money Market yields reference (Cash tab → MM funds).
-- Paste this whole block into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once.

create table if not exists public.mm_yields (
  id              bigint generated always as identity primary key,
  manco           text not null,
  fund_class      text not null unique,
  monthly_nominal numeric,          -- % p.a., monthly nominal (NACM)
  eff_7day        numeric,          -- % p.a., 7-day effective (NACA)
  rate_date       date,
  rank            int,
  updated_at      timestamptz not null default now()
);

alter table public.mm_yields add column if not exists eff_7day numeric; -- for existing tables
alter table public.mm_yields enable row level security;
drop policy if exists "mm_yields read"  on public.mm_yields;
drop policy if exists "mm_yields write" on public.mm_yields;
create policy "mm_yields read"  on public.mm_yields for select using (true);
create policy "mm_yields write" on public.mm_yields for all    using (true) with check (true);

-- Seed today's values so the reference works immediately (the PC task overwrites these).
insert into public.mm_yields (manco, fund_class, monthly_nominal, rate_date, rank) values
  ('Nedgroup',   'Nedgroup MMF C',   7.46, '2026-10-15', 1),
  ('Prescient',  'Prescient MMF B1', 7.45, '2026-10-18', 2),
  ('Ninety One', 'Ninety One MMF A', 7.28, '2026-10-15', 3),
  ('Coronation', 'Coronation MMF P', 7.07, '2026-10-18', 4)
on conflict (fund_class) do update
  set manco = excluded.manco, monthly_nominal = excluded.monthly_nominal,
      rate_date = excluded.rate_date, rank = excluded.rank, updated_at = now();
