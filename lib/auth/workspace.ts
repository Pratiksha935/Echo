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
  lastSyncedAt: string | null;
  provider: string;
  status: "pending" | "connected" | "attention" | "disconnected";
};

type MembershipRow = { organisation_id: string; role: FoundRole };
type OrganisationRow = { id: string; name: string; slug: string };
type ConnectionRow = {
  external_workspace_name: string | null;
  last_synced_at: string | null;
  provider: string;
  status: IntegrationConnection["status"];
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
    `/integration_connections?select=provider,status,external_workspace_name,last_synced_at&organisation_id=eq.${encodeURIComponent(organisationId)}`,
    context.accessToken,
  );
  return rows.map(row => ({
    externalWorkspaceName: row.external_workspace_name,
    lastSyncedAt: row.last_synced_at,
    provider: row.provider,
    status: row.status,
  }));
}

async function userRest<T>(path: string, accessToken: string): Promise<T> {
  const config = requireSupabasePublicConfig();
  const response = await fetch(`${config.url}/rest/v1${path}`, {
    cache: "no-store",
    headers: { apikey: config.anonKey, authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("Workspace authorization failed.");
  return response.json() as Promise<T>;
}
