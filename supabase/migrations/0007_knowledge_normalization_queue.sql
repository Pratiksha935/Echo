-- Hermes normalization remains asynchronous so source ingestion never waits on the model.
-- Keep this migration rerunnable because the SQL editor may preserve statements
-- that completed before a later statement failed.

do $$
begin
  create type public.knowledge_normalization_job_status as enum ('queued', 'processing', 'succeeded', 'failed');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.knowledge_normalization_jobs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  knowledge_record_id uuid not null references public.knowledge_records(id) on delete cascade,
  status public.knowledge_normalization_job_status not null default 'queued',
  version bigint not null default 1 check (version > 0),
  content_hash text not null,
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (knowledge_record_id)
);

create index if not exists knowledge_normalization_jobs_queue_idx
  on public.knowledge_normalization_jobs (status, available_at, created_at)
  where attempts < 8;

alter table public.knowledge_normalization_jobs enable row level security;
-- Deliberately no browser-facing policy. Only the service role and the worker
-- RPCs can see normalization job state.

create or replace function public.knowledge_record_content_hash(
  p_source text,
  p_title text,
  p_body text,
  p_source_updated_at timestamptz
)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        p_source || chr(31) || p_title || chr(31) || p_body || chr(31) || extract(epoch from p_source_updated_at)::text,
        'UTF8'
      )
    ),
    'hex'
  );
$$;

create or replace function public.enqueue_knowledge_normalization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.knowledge_normalization_jobs (
    organisation_id,
    knowledge_record_id,
    content_hash
  ) values (
    new.organisation_id,
    new.id,
    public.knowledge_record_content_hash(new.source, new.title, new.body, new.source_updated_at)
  )
  on conflict (knowledge_record_id) do update
    set organisation_id = excluded.organisation_id,
        content_hash = excluded.content_hash,
        status = 'queued',
        version = knowledge_normalization_jobs.version + 1,
        attempts = 0,
        available_at = now(),
        locked_at = null,
        completed_at = null,
        error_code = null,
        updated_at = now();
  return new;
end;
$$;

create or replace function public.clear_stale_knowledge_normalization()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.metadata := coalesce(new.metadata, '{}'::jsonb) - 'normalized';
  return new;
end;
$$;

drop trigger if exists clear_stale_knowledge_normalization_on_source_change on public.knowledge_records;
create trigger clear_stale_knowledge_normalization_on_source_change
before update of source, title, body, source_updated_at, metadata on public.knowledge_records
for each row
when (
  old.source is distinct from new.source
  or old.title is distinct from new.title
  or old.body is distinct from new.body
  or old.source_updated_at is distinct from new.source_updated_at
  or (old.metadata - 'normalized') is distinct from (new.metadata - 'normalized')
)
execute function public.clear_stale_knowledge_normalization();

drop trigger if exists enqueue_knowledge_normalization_on_insert on public.knowledge_records;
create trigger enqueue_knowledge_normalization_on_insert
after insert on public.knowledge_records
for each row execute function public.enqueue_knowledge_normalization();

drop trigger if exists enqueue_knowledge_normalization_on_source_change on public.knowledge_records;
create trigger enqueue_knowledge_normalization_on_source_change
after update of source, title, body, source_updated_at, metadata on public.knowledge_records
for each row
when (
  old.source is distinct from new.source
  or old.title is distinct from new.title
  or old.body is distinct from new.body
  or old.source_updated_at is distinct from new.source_updated_at
  or (old.metadata - 'normalized') is distinct from (new.metadata - 'normalized')
)
execute function public.enqueue_knowledge_normalization();

create or replace function public.claim_knowledge_normalization_jobs(p_limit integer default 3)
returns table (
  job_id uuid,
  organisation_id uuid,
  knowledge_record_id uuid,
  version bigint,
  attempts integer
)
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select j.id
    from public.knowledge_normalization_jobs j
    where j.attempts < 8
      and j.available_at <= now()
      and j.status in ('queued', 'failed', 'processing')
    order by j.available_at asc, j.created_at asc
    for update skip locked
    limit least(greatest(p_limit, 1), 10)
  )
  update public.knowledge_normalization_jobs j
    set status = 'processing',
        attempts = j.attempts + 1,
        locked_at = now(),
        available_at = now() + interval '5 minutes',
        error_code = null,
        updated_at = now()
    from candidates
    where j.id = candidates.id
    returning j.id, j.organisation_id, j.knowledge_record_id, j.version, j.attempts;
$$;

create or replace function public.complete_knowledge_normalization_job(
  p_job_id uuid,
  p_version bigint,
  p_normalized jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.knowledge_normalization_jobs%rowtype;
  knowledge public.knowledge_records%rowtype;
begin
  if jsonb_typeof(p_normalized) is distinct from 'object'
     or (p_normalized ->> 'version') is distinct from 'hermes-knowledge-v1'
     or jsonb_typeof(p_normalized -> 'type') is distinct from 'string'
     or jsonb_typeof(p_normalized -> 'title') is distinct from 'string'
     or jsonb_typeof(p_normalized -> 'summary') is distinct from 'string'
     or jsonb_typeof(p_normalized -> 'facts') is distinct from 'array'
     or jsonb_typeof(p_normalized -> 'entities') is distinct from 'array'
     or (p_normalized ? 'owner' and jsonb_typeof(p_normalized -> 'owner') not in ('string', 'null'))
     or (p_normalized ? 'status' and jsonb_typeof(p_normalized -> 'status') not in ('string', 'null'))
     or (p_normalized ? 'nextAction' and jsonb_typeof(p_normalized -> 'nextAction') not in ('string', 'null'))
     or (p_normalized - array['version', 'type', 'title', 'summary', 'facts', 'entities', 'owner', 'status', 'nextAction']) <> '{}'::jsonb then
    raise exception 'Invalid knowledge normalization contract' using errcode = '22023';
  end if;

  if (p_normalized ->> 'type') not in ('decision', 'document', 'article', 'conversation', 'sheet_row', 'spreadsheet', 'order_record', 'source_record')
     or nullif(btrim(p_normalized ->> 'title'), '') is null
     or nullif(btrim(p_normalized ->> 'summary'), '') is null
     or length(p_normalized ->> 'type') > 80
     or length(p_normalized ->> 'title') > 160
     or length(p_normalized ->> 'summary') > 320
     or jsonb_array_length(p_normalized -> 'facts') > 12
     or jsonb_array_length(p_normalized -> 'entities') > 12 then
    raise exception 'Invalid knowledge normalization bounds' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_normalized -> 'facts') fact
    where jsonb_typeof(fact) <> 'object'
      or jsonb_typeof(fact -> 'label') is distinct from 'string'
      or jsonb_typeof(fact -> 'value') is distinct from 'string'
      or (fact - array['label', 'value']) <> '{}'::jsonb
      or nullif(btrim(fact ->> 'label'), '') is null
      or nullif(btrim(fact ->> 'value'), '') is null
      or length(fact ->> 'label') > 160
      or length(fact ->> 'value') > 160
  ) or exists (
    select 1
    from jsonb_array_elements(p_normalized -> 'entities') entity
    where jsonb_typeof(entity) <> 'string'
      or nullif(btrim(entity #>> '{}'), '') is null
      or length(entity #>> '{}') > 160
  ) then
    raise exception 'Invalid knowledge normalization values' using errcode = '22023';
  end if;

  select j.* into claimed
  from public.knowledge_normalization_jobs j
  where j.id = p_job_id
  for update;

  if claimed.id is null or claimed.status <> 'processing' or claimed.version <> p_version then
    return false;
  end if;

  select r.* into knowledge
  from public.knowledge_records r
  where r.id = claimed.knowledge_record_id
    and r.organisation_id = claimed.organisation_id
  for update;

  if knowledge.id is null then
    return false;
  end if;

  if public.knowledge_record_content_hash(knowledge.source, knowledge.title, knowledge.body, knowledge.source_updated_at) <> claimed.content_hash then
    update public.knowledge_normalization_jobs j
      set status = 'queued', available_at = now(), locked_at = null, error_code = null, updated_at = now()
      where j.id = claimed.id;
    return false;
  end if;

  update public.knowledge_records r
    set metadata = jsonb_set(coalesce(r.metadata, '{}'::jsonb), '{normalized}', p_normalized, true)
    where r.id = knowledge.id;

  update public.knowledge_normalization_jobs j
    set status = 'succeeded', completed_at = now(), locked_at = null, error_code = null, updated_at = now()
    where j.id = claimed.id;
  return true;
end;
$$;

create or replace function public.fail_knowledge_normalization_job(
  p_job_id uuid,
  p_version bigint,
  p_error_code text,
  p_retry_after_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.knowledge_normalization_jobs j
    set status = 'failed',
        available_at = now() + make_interval(secs => least(greatest(p_retry_after_seconds, 30), 3600)),
        locked_at = null,
        completed_at = null,
        error_code = left(regexp_replace(coalesce(p_error_code, 'normalization_failed'), '[^a-z0-9_]+', '_', 'g'), 80),
        updated_at = now()
    where j.id = p_job_id
      and j.version = p_version
      and j.status = 'processing';
  return found;
end;
$$;

revoke all on function public.claim_knowledge_normalization_jobs(integer) from public, anon, authenticated;
revoke all on function public.complete_knowledge_normalization_job(uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.fail_knowledge_normalization_job(uuid, bigint, text, integer) from public, anon, authenticated;
grant execute on function public.claim_knowledge_normalization_jobs(integer) to service_role;
grant execute on function public.complete_knowledge_normalization_job(uuid, bigint, jsonb) to service_role;
grant execute on function public.fail_knowledge_normalization_job(uuid, bigint, text, integer) to service_role;

insert into public.knowledge_normalization_jobs (organisation_id, knowledge_record_id, content_hash)
select r.organisation_id, r.id, public.knowledge_record_content_hash(r.source, r.title, r.body, r.source_updated_at)
from public.knowledge_records r
where not (r.metadata ? 'normalized')
on conflict (knowledge_record_id) do nothing;
