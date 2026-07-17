import { requireSupabaseServiceConfig } from "../auth/config";
import type { IntegrationProvider } from "./catalog";

type ConnectionWrite = {
  externalWorkspaceId: string;
  externalWorkspaceName: string;
  grantedScopes: string[];
  organisationId: string;
  provider: Exclude<IntegrationProvider, "read_ai">;
  status?: "pending" | "connected";
};

export async function saveIntegrationConnection(
  input: ConnectionWrite,
  secret: { ciphertext: string; iv: string },
): Promise<string> {
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

async function serviceRest<T = unknown>(path: string, init: RequestInit): Promise<T> {
  const config = requireSupabaseServiceConfig();
  const response = await fetch(`${config.url}/rest/v1${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: config.serviceRoleKey,
      authorization: `Bearer ${config.serviceRoleKey}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error("Integration persistence failed.");
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
