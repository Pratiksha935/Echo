import type { IntegrationCredential } from "./oauth";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "./secrets";
import { serviceRest } from "./service-rest";

export type StoredConnection = {
  cursor: string | null;
  id: string;
  organisation_id: string;
  provider: "google" | "slack";
};

type SecretRow = { ciphertext: string; iv: string };

export async function loadConnectionCredential(connectionId: string): Promise<IntegrationCredential> {
  const rows = await serviceRest<SecretRow[]>(`/integration_secrets?select=ciphertext,iv&connection_id=eq.${encodeURIComponent(connectionId)}&limit=1`);
  const row = rows[0];
  if (!row) throw new Error("Integration credential was not found.");
  const raw = await decryptIntegrationSecret(row.ciphertext, row.iv);
  try {
    const parsed = JSON.parse(raw) as IntegrationCredential;
    if (parsed.accessToken) return parsed;
  } catch {
    // Slack stores a plain bot token for backwards compatibility.
  }
  return { accessToken: raw };
}

export async function refreshGoogleCredentialIfNeeded(connectionId: string, credential: IntegrationCredential): Promise<IntegrationCredential> {
  const expiresSoon = !credential.expiresAt || Date.parse(credential.expiresAt) < Date.now() + 5 * 60_000;
  if (!expiresSoon) return credential;
  if (!credential.refreshToken) throw new Error("Google refresh permission is unavailable.");
  const clientId = process.env.GOOGLE_WORKSPACE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_WORKSPACE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth configuration is missing.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: credential.refreshToken }),
  });
  const payload = await response.json().catch(() => null) as { access_token?: string; expires_in?: number; token_type?: string } | null;
  if (!response.ok || !payload?.access_token) throw new Error("Google access could not be refreshed.");
  const updated: IntegrationCredential = {
    ...credential,
    accessToken: payload.access_token,
    tokenType: payload.token_type ?? credential.tokenType,
    expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString(),
  };
  const encrypted = await encryptIntegrationSecret(JSON.stringify(updated));
  await serviceRest(`/integration_secrets?connection_id=eq.${encodeURIComponent(connectionId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...encrypted, updated_at: new Date().toISOString() }),
  });
  return updated;
}
