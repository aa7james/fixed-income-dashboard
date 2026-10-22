-- One-time setup so uploaded ALBI constituent CSVs are PERMANENT and shared
-- (Model Portfolio tab -> "ALBI index" -> Update from CSV).
-- Paste this whole block into Supabase -> SQL Editor -> New query -> Run.
-- Safe to run more than once.

create table if not exists public.albi_snapshots (
  as_at      date primary key,          -- the CSV's EffectiveDate
  rows       jsonb not null,            -- [[code, issuer, coupon, maturity, weight], ...]
  updated_at timestamptz not null default now()
);

alter table public.albi_snapshots enable row level security;
drop policy if exists "albi_snapshots read"  on public.albi_snapshots;
drop policy if exists "albi_snapshots write" on public.albi_snapshots;
create policy "albi_snapshots read"  on public.albi_snapshots for select using (true);
create policy "albi_snapshots write" on public.albi_snapshots for all    using (true) with check (true);
