create type public.memory_update_origin as enum ('user', 'slack', 'system');

-- Append-only overlays. Original Slack, Google, Jira and code records are never mutated.
create table public.memory_updates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  external_event_id text,
  source_record_id text not null,
  original_source_url text not null,
  update_source_url text,
  current_title text not null,
  update_text text not null,
  origin public.memory_update_origin not null,
  hermes_review text,
  created_at timestamptz not null default now()
);

create index memory_updates_record_created_idx on public.memory_updates (organisation_id, source_record_id, created_at desc);
create index memory_updates_org_created_idx on public.memory_updates (organisation_id, created_at desc);
create unique index memory_updates_external_event_idx on public.memory_updates (organisation_id, origin, external_event_id) where external_event_id is not null;

alter table public.memory_updates enable row level security;

create policy "members can view memory updates" on public.memory_updates
for select using (exists (
  select 1 from public.memberships m
  where m.organisation_id = memory_updates.organisation_id and m.user_id = auth.uid()
));

create policy "members can append memory updates" on public.memory_updates
for insert with check (
  actor_user_id = auth.uid()
  and origin = 'user'
  and exists (
    select 1 from public.memberships m
    where m.organisation_id = memory_updates.organisation_id and m.user_id = auth.uid()
  )
);

-- Slack/system writes use the server-side service role after relevance and ACL checks.
