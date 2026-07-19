import { getSupabasePublicConfig, requireSupabasePublicConfig } from "./config";
import { getSupabaseAuthContext } from "./session";

export type FoundRole = "owner" | "admin" | "member";

export type WorkspaceMembership = {
  organisationId: string;
  organisationName: string;
  organisationSlug: string;
  role: FoundRole;
};

export type IntegrationConnection = {
  externalWorkspaceName: string | null;
  grantedScopes: string[];
  lastSyncedAt: string | null;
  provider: string;
  status: "pending" | "connected" | "attention" | "disconnected";
};

export type WorkspaceKnowledgeRecord = {
  authorName: string | null;
  body: string;
  department: string | null;
  externalId: string;
  source: string;
  sourceUrl: string;
  sourceUpdatedAt: string;
  status: string;
  title: string;
};

export type MemoryUpdate = {
  actorUserId: string | null;
  createdAt: string;
  currentTitle: string;
  hermesReview: string | null;
  origin: "user" | "slack" | "system";
  sourceRecordId: string;
  sourceUrl: string;
  updateText: string;
};

type MembershipRow = { organisation_id: string; role: FoundRole };
type OrganisationRow = { id: string; name: string; slug: string };
type ConnectionRow = {
  external_workspace_name: string | null;
  granted_scopes: string[] | null;
  last_synced_at: string | null;
  provider: string;
  status: IntegrationConnection["status"];
};
type KnowledgeRow = {
  author_name: string | null;
  body: string;
  department: string | null;
  external_id: string;
  source: string;
  source_url: string;
  source_updated_at: string;
  title: string;
  metadata: { status?: string } | null;
};
type MemoryUpdateRow = {
  actor_user_id: string | null;
  created_at: string;
  current_title: string;
  hermes_review: string | null;
  origin: MemoryUpdate["origin"];
  original_source_url: string;
  source_record_id: string;
  update_text: string;
};

export async function getFoundWorkspace(requestedOrganisationId?: string): Promise<WorkspaceMembership | null> {
  if (!getSupabasePublicConfig()) return null;
  const context = await getSupabaseAuthContext();
  if (!context) return null;

  const membershipQuery = new URLSearchParams({
    select: "organisation_id,role",
    user_id: `eq.${context.user.id}`,
    order: "created_at.asc",
    limit: "1",
  });
  if (requestedOrganisationId) membershipQuery.set("organisation_id", `eq.${requestedOrganisationId}`);

  const memberships = await userRest<MembershipRow[]>(`/memberships?${membershipQuery}`, context.accessToken);
  const membership = memberships[0];
  if (!membership) return null;

  const organisations = await userRest<OrganisationRow[]>(
    `/organisations?select=id,name,slug&id=eq.${encodeURIComponent(membership.organisation_id)}&limit=1`,
    context.accessToken,
  );
  const organisation = organisations[0];
  if (!organisation) return null;

  return {
    organisationId: organisation.id,
    organisationName: organisation.name,
    organisationSlug: organisation.slug,
    role: membership.role,
  };
}

export async function listIntegrationConnections(organisationId: string): Promise<IntegrationConnection[]> {
  const context = await getSupabaseAuthContext();
  if (!context) return [];
  const rows = await userRest<ConnectionRow[]>(
    `/integration_connections?select=provider,status,external_workspace_name,granted_scopes,last_synced_at&organisation_id=eq.${encodeURIComponent(organisationId)}`,
    context.accessToken,
  );
  return rows.map(row => ({
    externalWorkspaceName: row.external_workspace_name,
    grantedScopes: row.granted_scopes ?? [],
    lastSyncedAt: row.last_synced_at,
    provider: row.provider,
    status: row.status,
  }));
}

export async function listWorkspaceKnowledgeRecords(organisationId: string, limit = 100): Promise<WorkspaceKnowledgeRecord[]> {
  const context = await getSupabaseAuthContext();
  if (!context) return [];
  const query = new URLSearchParams({
    select: "source,external_id,title,body,author_name,department,source_url,source_updated_at,metadata",
    organisation_id: `eq.${organisationId}`,
    order: "source_updated_at.desc",
    limit: String(Math.min(Math.max(limit, 1), 200)),
  });
  const rows = await userRest<KnowledgeRow[]>(`/knowledge_records?${query}`, context.accessToken);
  return rows.map(row => ({
    authorName: row.author_name,
    body: row.body,
    department: row.department,
    externalId: row.external_id,
    source: row.source,
    sourceUrl: row.source_url,
    sourceUpdatedAt: row.source_updated_at,
    status: row.metadata?.status ?? "Indexed",
    title: row.title,
  }));
}

export async function getWorkspaceKnowledgeRecord(organisationId: string, externalId: string): Promise<WorkspaceKnowledgeRecord | null> {
  const context = await getSupabaseAuthContext();
  if (!context) return null;
  const rows = await userRest<KnowledgeRow[]>(
    `/knowledge_records?select=source,external_id,title,body,author_name,department,source_url,source_updated_at,metadata&organisation_id=eq.${encodeURIComponent(organisationId)}&external_id=eq.${encodeURIComponent(externalId)}&limit=1`,
    context.accessToken,
  );
  const row = rows[0];
  return row ? {
    authorName: row.author_name,
    body: row.body,
    department: row.department,
    externalId: row.external_id,
    source: row.source,
    sourceUrl: row.source_url,
    sourceUpdatedAt: row.source_updated_at,
    status: row.metadata?.status ?? "Indexed",
    title: row.title,
  } : null;
}

export async function listMemoryUpdates(organisationId: string): Promise<MemoryUpdate[]> {
  const context = await getSupabaseAuthContext();
  if (!context) return [];
  const query = new URLSearchParams({
    select: "actor_user_id,source_record_id,original_source_url,current_title,update_text,origin,hermes_review,created_at",
    organisation_id: `eq.${organisationId}`,
    order: "created_at.desc",
    limit: "100",
  });
  const rows = await userRest<MemoryUpdateRow[]>(`/memory_updates?${query}`, context.accessToken);
  return rows.map(row => ({
    actorUserId: row.actor_user_id,
    createdAt: row.created_at,
    currentTitle: row.current_title,
    hermesReview: row.hermes_review,
    origin: row.origin,
    sourceRecordId: row.source_record_id,
    sourceUrl: row.original_source_url,
    updateText: row.update_text,
  }));
}

export async function createMemoryUpdate(input: {
  currentTitle: string;
  hermesReview: string | null;
  organisationId: string;
  sourceRecordId: string;
  sourceUrl: string;
  updateText: string;
}): Promise<void> {
  const context = await getSupabaseAuthContext();
  if (!context) throw new Error("Workspace authorization failed.");
  await userRest("/memory_updates", context.accessToken, {
    body: JSON.stringify({
      actor_user_id: context.user.id,
      current_title: input.currentTitle,
      hermes_review: input.hermesReview,
      organisation_id: input.organisationId,
      origin: "user",
      original_source_url: input.sourceUrl,
      source_record_id: input.sourceRecordId,
      update_text: input.updateText,
    }),
    headers: { Prefer: "return=minimal" },
    method: "POST",
  });
}

async function userRest<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const config = requireSupabasePublicConfig();
  const response = await fetch(`${config.url}/rest/v1${path}`, {
    ...init,
    cache: "no-store",
    headers: { apikey: config.anonKey, authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...init.headers },
  });
  if (!response.ok) throw new Error("Workspace authorization failed.");
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
