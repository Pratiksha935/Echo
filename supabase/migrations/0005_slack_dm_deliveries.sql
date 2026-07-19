create type public.slack_dm_delivery_status as enum ('claimed', 'delivered', 'suppressed', 'failed');

create table public.slack_dm_deliveries (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  external_event_id text not null,
  slack_user_id text not null,
  slack_channel_id text,
  status public.slack_dm_delivery_status not null default 'claimed',
  slack_message_ts text,
  attempts integer not null default 1 check (attempts > 0),
  available_at timestamptz not null default now(),
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (organisation_id, external_event_id)
);

create index slack_dm_deliveries_status_idx on public.slack_dm_deliveries (status, available_at, claimed_at);
alter table public.slack_dm_deliveries enable row level security;
-- Service-role only. Browser clients and Slack payloads can never read delivery state.

create or replace function public.claim_slack_dm_delivery(
  p_organisation_id uuid,
  p_external_event_id text,
  p_slack_user_id text,
  p_slack_channel_id text default null
)
returns table (id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_id uuid;
  existing_status public.slack_dm_delivery_status;
  existing_available_at timestamptz;
  existing_claimed_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text || ':' || p_external_event_id, 0));
  select d.id, d.status, d.available_at, d.claimed_at
    into existing_id, existing_status, existing_available_at, existing_claimed_at
    from public.slack_dm_deliveries d
    where d.organisation_id = p_organisation_id and d.external_event_id = p_external_event_id
    for update;

  if existing_id is null then
    return query
      insert into public.slack_dm_deliveries (organisation_id, external_event_id, slack_user_id, slack_channel_id)
      values (p_organisation_id, p_external_event_id, p_slack_user_id, p_slack_channel_id)
      returning slack_dm_deliveries.id;
    return;
  end if;

  if existing_status in ('delivered', 'suppressed')
     or (existing_status = 'claimed' and existing_claimed_at > now() - interval '5 minutes')
     or (existing_status = 'failed' and existing_available_at > now()) then
    return;
  end if;

  return query
    update public.slack_dm_deliveries d
      set status = 'claimed', attempts = d.attempts + 1, claimed_at = now(), completed_at = null,
          slack_user_id = p_slack_user_id, slack_channel_id = p_slack_channel_id
      where d.id = existing_id
      returning d.id;
end;
$$;

revoke all on function public.claim_slack_dm_delivery(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_slack_dm_delivery(uuid, text, text, text) to service_role;

create or replace function public.claim_slack_ingestion_event(p_external_event_id text)
returns table (id uuid, attempts integer, external_event_id text, external_workspace_id text, payload jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_id uuid;
  existing_status public.ingestion_event_status;
  existing_available_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('slack:' || p_external_event_id, 0));
  select e.id, e.status, e.available_at
    into existing_id, existing_status, existing_available_at
    from public.ingestion_events e
    where e.provider = 'slack' and e.external_event_id = p_external_event_id
    for update;

  if existing_id is null
     or existing_status in ('succeeded', 'ignored')
     or (existing_status = 'processing' and existing_available_at > now())
     or (existing_status = 'failed' and existing_available_at > now()) then
    return;
  end if;

  return query
    update public.ingestion_events e
      set status = 'processing', attempts = e.attempts + 1,
          available_at = now() + interval '5 minutes', error_code = null
      where e.id = existing_id
      returning e.id, e.attempts, e.external_event_id, e.external_workspace_id, e.payload;
end;
$$;

revoke all on function public.claim_slack_ingestion_event(text) from public, anon, authenticated;
grant execute on function public.claim_slack_ingestion_event(text) to service_role;

create or replace function public.enforce_single_slack_workspace_binding()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.provider = 'slack' and new.external_workspace_id is not null and new.status <> 'disconnected' then
    perform pg_advisory_xact_lock(hashtextextended('slack-workspace:' || new.external_workspace_id, 0));
    if exists (
      select 1 from public.integration_connections c
      where c.provider = 'slack'
        and c.external_workspace_id = new.external_workspace_id
        and c.status <> 'disconnected'
        and c.id <> new.id
    ) then
      raise exception 'Slack workspace is already connected to another Found organisation' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_single_slack_workspace_binding on public.integration_connections;
create trigger enforce_single_slack_workspace_binding
before insert or update of external_workspace_id, provider, status on public.integration_connections
for each row execute function public.enforce_single_slack_workspace_binding();
