import type { IntegrationProvider } from "./catalog";
import { publicAppOriginFromEnvironment } from "../auth/origin";

export type OAuthProvider = "notion" | "jira" | "google";
export type ConnectableProvider = OAuthProvider | "github";

export type IntegrationCredential = {
  accessToken: string;
  expiresAt?: string;
  refreshToken?: string;
  tokenType?: string;
};

export type OAuthInstallation = {
  credential: IntegrationCredential;
  externalWorkspaceId: string;
  externalWorkspaceName: string;
  grantedScopes: string[];
};

type ProviderConfig = {
  authorizeUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  tokenUrl: string;
};

const PROVIDERS = new Set<IntegrationProvider>(["notion", "jira", "google", "github"]);

export function isConnectableProvider(value: string): value is ConnectableProvider {
  return PROVIDERS.has(value as IntegrationProvider);
}

export function integrationCallbackUrl(provider: ConnectableProvider): string {
  const appUrl = publicAppOriginFromEnvironment();
  if (!appUrl) throw new Error("Public application URL is missing.");
  return `${appUrl}/auth/integrations/${provider}/callback`;
}

export function buildAuthorizationUrl(provider: ConnectableProvider, state: string): URL {
  if (provider === "github") {
    const installUrl = process.env.GITHUB_APP_INSTALL_URL;
    if (!installUrl) throw new Error("GitHub App installation URL is missing.");
    const url = new URL(installUrl);
    url.searchParams.set("state", state);
    return url;
  }

  const config = requireProviderConfig(provider);
  const redirectUri = integrationCallbackUrl(provider);
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("scope", config.scopes.join(" "));

  if (provider === "notion") url.searchParams.set("owner", "user");
  if (provider === "jira") {
    url.searchParams.set("audience", "api.atlassian.com");
    url.searchParams.set("prompt", "consent");
  }
  if (provider === "google") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent");
  }
  return url;
}

export async function exchangeIntegrationCode(provider: OAuthProvider, code: string): Promise<OAuthInstallation> {
  const config = requireProviderConfig(provider);
  const redirectUri = integrationCallbackUrl(provider);
  if (provider === "notion") return exchangeNotion(config, code, redirectUri);
  if (provider === "jira") return exchangeJira(config, code, redirectUri);
  return exchangeGoogle(config, code, redirectUri);
}

export async function exchangeGitHubInstallation(code: string, installationId: string): Promise<OAuthInstallation> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GitHub App OAuth configuration is missing.");
  const token = await fetchJson<{
    access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; token_type?: string;
  }>("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  if (!token.access_token) throw new Error("GitHub did not return a user access token.");
  const installation = await fetchJson<{
    account?: { login?: string }; id?: number; permissions?: Record<string, string>; repository_selection?: string;
  }>(`https://api.github.com/user/installations/${encodeURIComponent(installationId)}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token.access_token}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (String(installation.id) !== installationId) throw new Error("GitHub installation ownership could not be verified.");
  const permissions = Object.entries(installation.permissions ?? {}).map(([name, level]) => `${name}:${level}`);
  return {
    credential: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenType: token.token_type,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : undefined,
    },
    externalWorkspaceId: installationId,
    externalWorkspaceName: installation.account?.login ?? `GitHub installation #${installationId}`,
    grantedScopes: [...permissions, `repositories:${installation.repository_selection ?? "selected"}`],
  };
}

function requireProviderConfig(provider: OAuthProvider): ProviderConfig {
  const definitions: Record<OAuthProvider, Omit<ProviderConfig, "clientId" | "clientSecret"> & { clientIdEnv: string; clientSecretEnv: string }> = {
    notion: {
      authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
      tokenUrl: "https://api.notion.com/v1/oauth/token",
      clientIdEnv: "NOTION_CLIENT_ID",
      clientSecretEnv: "NOTION_CLIENT_SECRET",
      scopes: [],
    },
    jira: {
      authorizeUrl: "https://auth.atlassian.com/authorize",
      tokenUrl: "https://auth.atlassian.com/oauth/token",
      clientIdEnv: "ATLASSIAN_CLIENT_ID",
      clientSecretEnv: "ATLASSIAN_CLIENT_SECRET",
      scopes: ["read:jira-work", "read:jira-user", "offline_access"],
    },
    google: {
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      clientIdEnv: "GOOGLE_WORKSPACE_CLIENT_ID",
      clientSecretEnv: "GOOGLE_WORKSPACE_CLIENT_SECRET",
      scopes: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/documents.readonly",
        "https://www.googleapis.com/auth/spreadsheets.readonly",
      ],
    },
  };
  const definition = definitions[provider];
  const clientId = process.env[definition.clientIdEnv];
  const clientSecret = process.env[definition.clientSecretEnv];
  if (!clientId || !clientSecret) throw new Error(`${provider} OAuth configuration is missing.`);
  return { ...definition, clientId, clientSecret };
}

async function exchangeNotion(config: ProviderConfig, code: string, redirectUri: string): Promise<OAuthInstallation> {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const payload = await fetchJson<{
    access_token?: string; bot_id?: string; refresh_token?: string; workspace_id?: string; workspace_name?: string;
  }>(config.tokenUrl, {
    method: "POST",
    headers: { authorization: `Basic ${credentials}`, "content-type": "application/json" },
    body: JSON.stringify({ code, grant_type: "authorization_code", redirect_uri: redirectUri }),
  });
  if (!payload.access_token || !payload.workspace_id) throw new Error("Notion did not return a workspace token.");
  return {
    credential: { accessToken: payload.access_token, refreshToken: payload.refresh_token, tokenType: "bearer" },
    externalWorkspaceId: payload.workspace_id,
    externalWorkspaceName: payload.workspace_name ?? `Notion workspace ${payload.workspace_id.slice(0, 8)}`,
    grantedScopes: ["selected_pages", "read_content", "read_comments", "read_users"],
  };
}

async function exchangeJira(config: ProviderConfig, code: string, redirectUri: string): Promise<OAuthInstallation> {
  const payload = await fetchJson<{ access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; token_type?: string }>(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri }),
  });
  if (!payload.access_token) throw new Error("Jira did not return an access token.");
  const resources = await fetchJson<Array<{ id: string; name: string; scopes?: string[]; url?: string }>>(
    "https://api.atlassian.com/oauth/token/accessible-resources",
    { headers: { authorization: `Bearer ${payload.access_token}`, accept: "application/json" } },
  );
  const resource = resources[0];
  if (!resource) throw new Error("No Jira Cloud site was granted.");
  return {
    credential: {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      tokenType: payload.token_type,
      expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : undefined,
    },
    externalWorkspaceId: resource.id,
    externalWorkspaceName: resource.name || resource.url || resource.id,
    grantedScopes: resource.scopes ?? payload.scope?.split(" ").filter(Boolean) ?? config.scopes,
  };
}

async function exchangeGoogle(config: ProviderConfig, code: string, redirectUri: string): Promise<OAuthInstallation> {
  const payload = await fetchJson<{ access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; token_type?: string }>(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri }),
  });
  if (!payload.access_token) throw new Error("Google did not return an access token.");
  const profile = await fetchJson<{ email?: string; hd?: string; name?: string; sub?: string }>("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${payload.access_token}` },
  });
  if (!profile.sub) throw new Error("Google Workspace identity could not be resolved.");
  return {
    credential: {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      tokenType: payload.token_type,
      expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : undefined,
    },
    externalWorkspaceId: profile.hd ?? profile.sub,
    externalWorkspaceName: profile.hd ?? profile.email ?? profile.name ?? "Google Workspace",
    grantedScopes: payload.scope?.split(" ").filter(Boolean) ?? config.scopes,
  };
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => null) as T | { error?: string; error_description?: string } | null;
  if (!response.ok || !body) {
    const error = body as { error?: string; error_description?: string } | null;
    throw new Error(error?.error_description ?? error?.error ?? "Integration authorization failed.");
  }
  return body as T;
}
