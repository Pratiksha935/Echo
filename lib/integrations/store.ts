import type { IntegrationProvider } from "./catalog";
import { serviceRest } from "./service-rest";

type ConnectionWrite = {
  externalWorkspaceId: string;
  externalWorkspaceName: string;
  grantedScopes: string[];
  organisationId: string;
  provider: Exclude<IntegrationProvider, "read_ai">;
  status?: "pending" | "connected";
};

export class IntegrationWorkspaceConflictError extends Error {
  constructor(provider: string) {
    super(`${provider} workspace is already connected to another Found organisation.`);
    this.name = "IntegrationWorkspaceConflictError";
  }
}

export async function saveIntegrationConnection(
  input: ConnectionWrite,
  secret: { ciphertext: string; iv: string },
): Promise<string> {
  if (input.provider === "slack") {
    const conflicts = await serviceRest<Array<{ id: string }>>(
      `/integration_connections?select=id&provider=eq.slack&external_workspace_id=eq.${encodeURIComponent(input.externalWorkspaceId)}&status=neq.disconnected&organisation_id=neq.${encodeURIComponent(input.organisationId)}&limit=1`,
      { method: "GET" },
    );
    if (conflicts.length) throw new IntegrationWorkspaceConflictError("Slack");
  }
  const rows = await serviceRest<{ id: string }[]>(
    "/integration_connections?on_conflict=organisation_id,provider,external_workspace_id",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        organisation_id: input.organisationId,
        provider: input.provider,
        external_workspace_id: input.externalWorkspaceId,
        external_workspace_name: input.externalWorkspaceName,
        granted_scopes: input.grantedScopes,
        status: input.status ?? "pending",
        updated_at: new Date().toISOString(),
      }),
    },
  );
  const connectionId = rows[0]?.id;
  if (!connectionId) throw new Error("Integration connection was not persisted.");

  await serviceRest(
    "/integration_secrets?on_conflict=connection_id",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ connection_id: connectionId, ...secret, key_version: 1 }),
    },
  );
  return connectionId;
}
