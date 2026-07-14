create extension if not exists pgcrypto;

create table if not exists public.carrymate_guestbook (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 30),
  message text not null check (char_length(trim(message)) between 1 and 300),
  created_at timestamptz not null default now()
);

create index if not exists carrymate_guestbook_created_at_idx
  on public.carrymate_guestbook (created_at desc);

alter table public.carrymate_guestbook enable row level security;

drop policy if exists "carrymate_guestbook_public_select" on public.carrymate_guestbook;
create policy "carrymate_guestbook_public_select"
on public.carrymate_guestbook
for select
to anon, authenticated
using (true);

drop policy if exists "carrymate_guestbook_public_insert" on public.carrymate_guestbook;
create policy "carrymate_guestbook_public_insert"
on public.carrymate_guestbook
for insert
to anon, authenticated
with check (
  char_length(trim(name)) between 1 and 30
  and char_length(trim(message)) between 1 and 300
);
