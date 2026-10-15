-- One-time setup for the "Why are yields here?" panel on the Yield Curve tab.
-- Paste this whole block into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once (it won't duplicate rows).

create table if not exists public.yield_drivers (
  id         bigint generated always as identity primary key,
  region     text not null check (region in ('US','SA')),
  sort       int  not null default 0,
  label      text not null,
  weight     numeric not null default 0,
  note       text default '',
  color      text default '#2a78d6',
  updated_at timestamptz not null default now()
);

alter table public.yield_drivers enable row level security;

drop policy if exists "yield_drivers read"  on public.yield_drivers;
drop policy if exists "yield_drivers write" on public.yield_drivers;
create policy "yield_drivers read"  on public.yield_drivers for select using (true);
create policy "yield_drivers write" on public.yield_drivers for all    using (true) with check (true);

-- Seed the default drivers (only if the table is empty).
insert into public.yield_drivers (region, sort, label, weight, color)
select * from (values
  ('SA', 1, 'Fiscal sustainability',            35, '#e34948'),
  ('SA', 2, 'Currency (ZAR) risk',              15, '#eda100'),
  ('SA', 3, 'Global anchor (US/DM yields)',     15, '#2a78d6'),
  ('SA', 4, 'Sovereign credit (junk rating)',   10, '#e34948'),
  ('SA', 5, 'Political / policy uncertainty',   10, '#008300'),
  ('SA', 6, 'Weak / withdrawn demand',          10, '#6250d6'),
  ('SA', 7, 'Inflation risk premium',            5, '#eb6834'),
  ('US', 1, 'Fiscal — deficit spending',        35, '#e34948'),
  ('US', 2, 'Private / AI capital demand',      25, '#6250d6'),
  ('US', 3, 'Strong equities competing',        15, '#6250d6'),
  ('US', 4, 'Fed communication (Walsh)',        10, '#008300'),
  ('US', 5, 'Tariffs / onshoring friction',     10, '#008300'),
  ('US', 6, 'Inflation fears',                   5, '#eb6834')
) as v(region, sort, label, weight, color)
where not exists (select 1 from public.yield_drivers);
