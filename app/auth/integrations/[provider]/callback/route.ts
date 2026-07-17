import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getFoundUser } from "../../../../auth";
import { getFoundWorkspace } from "../../../../../lib/auth/workspace";
import { encryptIntegrationSecret } from "../../../../../lib/integrations/secrets";
import { exchangeGitHubInstallation, exchangeIntegrationCode, isConnectableProvider, type OAuthProvider } from "../../../../../lib/integrations/oauth";
import { saveIntegrationConnection } from "../../../../../lib/integrations/store";
import { INTEGRATION_ORG_COOKIE, INTEGRATION_PROVIDER_COOKIE, INTEGRATION_STATE_COOKIE } from "../route";
import { publicRequestOrigin } from "../../../../../lib/auth/origin";

type RouteContext = { params: Promise<{ provider: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { provider } = await context.params;
  const appUrl = publicRequestOrigin(request);
  const destination = new URL("/integrations", appUrl);
  if (!isConnectableProvider(provider)) return fail(destination, "unsupported_provider");
  const user = await getFoundUser();
  if (!user) return NextResponse.redirect(new URL("/login?return_to=%2Fintegrations", appUrl));

  const store = await cookies();
  const expectedState = store.get(INTEGRATION_STATE_COOKIE)?.value;
  const organisationId = store.get(INTEGRATION_ORG_COOKIE)?.value;
  const expectedProvider = store.get(INTEGRATION_PROVIDER_COOKIE)?.value;
  const state = request.nextUrl.searchParams.get("state");
  clearIntegrationCookies(store);
  if (!expectedState || !organisationId || state !== expectedState || expectedProvider !== provider) {
    return fail(destination, "invalid_integration_callback");
  }

  const workspace = await getFoundWorkspace(organisationId);
  if (!workspace || !["owner", "admin"].includes(workspace.role)) return fail(destination, "workspace_forbidden");

  try {
    if (provider === "github") {
      const installationId = request.nextUrl.searchParams.get("installation_id");
      const code = request.nextUrl.searchParams.get("code");
      if (!installationId || !/^\d+$/.test(installationId) || !code) return fail(destination, "github_authorization_failed");
      const installation = await exchangeGitHubInstallation(code, installationId);
      await saveIntegrationConnection({
        organisationId,
        provider,
        externalWorkspaceId: installation.externalWorkspaceId,
        externalWorkspaceName: installation.externalWorkspaceName,
        grantedScopes: installation.grantedScopes,
      }, await encryptIntegrationSecret(JSON.stringify(installation.credential)));
    } else {
      const code = request.nextUrl.searchParams.get("code");
      if (!code) return fail(destination, `${provider}_authorization_failed`);
      const installation = await exchangeIntegrationCode(provider as OAuthProvider, code);
      await saveIntegrationConnection({
        organisationId,
        provider,
        externalWorkspaceId: installation.externalWorkspaceId,
        externalWorkspaceName: installation.externalWorkspaceName,
        grantedScopes: installation.grantedScopes,
      }, await encryptIntegrationSecret(JSON.stringify(installation.credential)));
      // The durable worker performs the first import and every incremental sync.
      // Keeping ingestion outside OAuth prevents provider callbacks from timing out.
    }
  } catch {
    return fail(destination, "connection_storage_failed");
  }

  destination.searchParams.set("connected", provider);
  return NextResponse.redirect(destination);
}

function fail(destination: URL, code: string) {
  destination.searchParams.set("error", code);
  return NextResponse.redirect(destination);
}

function clearIntegrationCookies(store: Awaited<ReturnType<typeof cookies>>) {
  for (const name of [INTEGRATION_STATE_COOKIE, INTEGRATION_ORG_COOKIE, INTEGRATION_PROVIDER_COOKIE]) {
    store.set(name, "", { httpOnly: true, maxAge: 0, path: "/", sameSite: "lax" });
  }
}
