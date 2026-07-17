create type public.ingestion_event_status as enum ('queued', 'processing', 'succeeded', 'ignored', 'failed');

create table public.ingestion_events (
  id uuid primary key default gen_random_uuid(),
  provider public.integration_provider not null,
  external_event_id text not null,
  external_workspace_id text not null,
  event_type text not null,
  payload jsonb not null,
  status public.ingestion_event_status not null default 'queued',
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  unique (provider, external_event_id)
);

create index ingestion_events_queue_idx on public.ingestion_events (status, available_at, created_at);
alter table public.ingestion_events enable row level security;
-- Deliberately no browser-facing policies. Only the service role processes the queue.
