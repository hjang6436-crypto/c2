create table if not exists public.meeting_messages (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  member_id uuid references public.team_members(id) on delete set null,
  sender_name text not null,
  message text not null,
  created_at timestamp with time zone default now() not null
);

create index if not exists meeting_messages_meeting_created_idx
on public.meeting_messages(meeting_id, created_at);
