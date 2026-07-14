create extension if not exists pgcrypto;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  team_name text not null check (char_length(trim(team_name)) between 1 and 80),
  course_name text not null check (char_length(trim(course_name)) between 1 and 80),
  deadline_label text not null check (char_length(trim(deadline_label)) between 1 and 80),
  member_names text[] not null default '{}'::text[],
  invite_code text not null default 'CARRY2026',
  created_at timestamptz not null default now()
);

alter table public.teams
add column if not exists description text;

alter table public.teams
add column if not exists start_date date default current_date;

alter table public.teams
add column if not exists end_date date;

create index if not exists teams_created_at_idx on public.teams (created_at desc);

alter table public.teams enable row level security;

drop policy if exists "teams_public_select" on public.teams;
create policy "teams_public_select"
on public.teams
for select
to anon, authenticated
using (true);

drop policy if exists "teams_public_insert" on public.teams;
create policy "teams_public_insert"
on public.teams
for insert
to anon, authenticated
with check (
  char_length(trim(team_name)) between 1 and 80
  and char_length(trim(course_name)) between 1 and 80
  and char_length(trim(deadline_label)) between 1 and 80
);
