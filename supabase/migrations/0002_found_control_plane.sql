-- Production control-plane additions. Apply after 0001_found_foundation.sql.

create type public.sync_run_status as enum ('queued', 'running', 'succeeded', 'partial', 'failed');

create table public.external_identities (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider public.integration_provider not null,
  external_principal_id text not null,
  external_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, provider, external_principal_id),
  unique (organisation_id, user_id, provider)
);

create table public.integration_resource_scopes (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  external_resource_id text not null,
  resource_name text not null,
  resource_type text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_resource_id)
);

create table public.integration_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  status public.sync_run_status not null default 'queued',
  records_seen integer not null default 0 check (records_seen >= 0),
  records_written integer not null default 0 check (records_written >= 0),
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index knowledge_records_org_department_idx on public.knowledge_records (organisation_id, department);
create index knowledge_records_org_source_updated_idx on public.knowledge_records (organisation_id, source_updated_at desc);
create index integration_sync_runs_connection_created_idx on public.integration_sync_runs (connection_id, created_at desc);
create index audit_events_org_created_idx on public.audit_events (organisation_id, created_at desc);

alter table public.external_identities enable row level security;
alter table public.integration_resource_scopes enable row level security;
alter table public.integration_sync_runs enable row level security;
alter table public.audit_events enable row level security;

create policy "members can view their external identities" on public.external_identities
for select using (user_id = auth.uid());

create policy "admins can manage external identities" on public.external_identities
for all using (exists (
  select 1 from public.memberships m
  where m.organisation_id = external_identities.organisation_id
    and m.user_id = auth.uid() and m.role in ('owner', 'admin')
)) with check (exists (
  select 1 from public.memberships m
  where m.organisation_id = external_identities.organisation_id
    and m.user_id = auth.uid() and m.role in ('owner', 'admin')
));

create policy "members can view selected resources" on public.integration_resource_scopes
for select using (exists (
  select 1 from public.integration_connections c
  join public.memberships m on m.organisation_id = c.organisation_id
  where c.id = integration_resource_scopes.connection_id and m.user_id = auth.uid()
));

create policy "admins can manage selected resources" on public.integration_resource_scopes
for all using (exists (
  select 1 from public.integration_connections c
  join public.memberships m on m.organisation_id = c.organisation_id
  where c.id = integration_resource_scopes.connection_id
    and m.user_id = auth.uid() and m.role in ('owner', 'admin')
)) with check (exists (
  select 1 from public.integration_connections c
  join public.memberships m on m.organisation_id = c.organisation_id
  where c.id = integration_resource_scopes.connection_id
    and m.user_id = auth.uid() and m.role in ('owner', 'admin')
));

create policy "members can view sync runs" on public.integration_sync_runs
for select using (exists (
  select 1 from public.memberships m
  where m.organisation_id = integration_sync_runs.organisation_id and m.user_id = auth.uid()
));

create policy "members can view audit events" on public.audit_events
for select using (exists (
  select 1 from public.memberships m
  where m.organisation_id = audit_events.organisation_id and m.user_id = auth.uid()
));

drop policy if exists "members can view permitted knowledge" on public.knowledge_records;
create policy "members can view permitted knowledge" on public.knowledge_records
for select using (
  exists (
    select 1 from public.memberships m
    where m.organisation_id = knowledge_records.organisation_id and m.user_id = auth.uid()
  )
  and (
    visibility = 'workspace'
    or exists (
      select 1 from public.external_identities i
      where i.organisation_id = knowledge_records.organisation_id
        and i.user_id = auth.uid()
        and i.external_principal_id = any(knowledge_records.allowed_principal_ids)
    )
  )
);
