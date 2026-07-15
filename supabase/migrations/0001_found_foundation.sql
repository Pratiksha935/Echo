create extension if not exists pgcrypto;

create type public.found_role as enum ('owner', 'admin', 'member');
create type public.integration_provider as enum ('slack', 'notion', 'jira', 'google', 'github', 'read_ai');
create type public.connection_status as enum ('pending', 'connected', 'attention', 'disconnected');

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role public.found_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (organisation_id, user_id)
);

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  provider public.integration_provider not null,
  external_workspace_id text,
  external_workspace_name text,
  granted_scopes text[] not null default '{}',
  status public.connection_status not null default 'pending',
  cursor text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organisation_id, provider, external_workspace_id)
);

-- No browser-facing RLS policy is created for this table. Only the service role
-- may read encrypted provider credentials.
create table public.integration_secrets (
  connection_id uuid primary key references public.integration_connections(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  key_version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table public.knowledge_records (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  connection_id uuid references public.integration_connections(id) on delete set null,
  source text not null,
  external_id text not null,
  title text not null,
  body text not null,
  author_name text,
  department text,
  source_url text not null,
  visibility text not null check (visibility in ('workspace', 'restricted', 'private')) default 'restricted',
  allowed_principal_ids text[] not null default '{}',
  metadata jsonb not null default '{}',
  source_updated_at timestamptz not null,
  indexed_at timestamptz not null default now(),
  unique (organisation_id, source, external_id)
);

alter table public.organisations enable row level security;
alter table public.memberships enable row level security;
alter table public.integration_connections enable row level security;
alter table public.integration_secrets enable row level security;
alter table public.knowledge_records enable row level security;

create policy "members can view their memberships" on public.memberships
for select using (user_id = auth.uid());

create policy "members can view their organisations" on public.organisations
for select using (exists (
  select 1 from public.memberships m
  where m.organisation_id = organisations.id and m.user_id = auth.uid()
));

create policy "members can view connections" on public.integration_connections
for select using (exists (
  select 1 from public.memberships m
  where m.organisation_id = integration_connections.organisation_id and m.user_id = auth.uid()
));

create policy "admins can manage connections" on public.integration_connections
for all using (exists (
  select 1 from public.memberships m
  where m.organisation_id = integration_connections.organisation_id
    and m.user_id = auth.uid() and m.role in ('owner', 'admin')
)) with check (exists (
  select 1 from public.memberships m
  where m.organisation_id = integration_connections.organisation_id
    and m.user_id = auth.uid() and m.role in ('owner', 'admin')
));

create policy "members can view permitted knowledge" on public.knowledge_records
for select using (
  exists (select 1 from public.memberships m where m.organisation_id = knowledge_records.organisation_id and m.user_id = auth.uid())
  and (visibility = 'workspace' or auth.uid()::text = any(allowed_principal_ids))
);

create or replace function public.create_found_workspace_for_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  new_org_id uuid;
  company_name text;
  base_slug text;
begin
  company_name := coalesce(new.raw_user_meta_data ->> 'company_name', split_part(new.email, '@', 2), 'My company');
  base_slug := regexp_replace(lower(company_name), '[^a-z0-9]+', '-', 'g');
  insert into public.organisations (name, slug, created_by)
  values (company_name, trim(both '-' from base_slug) || '-' || left(new.id::text, 8), new.id)
  returning id into new_org_id;
  insert into public.memberships (organisation_id, user_id, email, role)
  values (new_org_id, new.id, new.email, 'owner');
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.create_found_workspace_for_user();

