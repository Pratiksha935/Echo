import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getFoundUser } from "../../../auth";
import { getFoundWorkspace } from "../../../../lib/auth/workspace";
import { encryptIntegrationSecret } from "../../../../lib/integrations/secrets";
import { IntegrationWorkspaceConflictError, saveIntegrationConnection } from "../../../../lib/integrations/store";
import { publicRequestOrigin } from "../../../../lib/auth/origin";

const SLACK_STATE_COOKIE = "found_slack_oauth_state";
const SLACK_ORG_COOKIE = "found_slack_oauth_org";

type SlackOAuthResponse = {
  access_token?: string;
  error?: string;
  expires_in?: number;
  ok: boolean;
  refresh_token?: string;
  scope?: string;
  team?: { id?: string; name?: string };
  token_type?: string;
};

export async function GET(request: NextRequest) {
  const appUrl = publicRequestOrigin(request);
  const destination = new URL("/integrations", appUrl);
  const user = await getFoundUser();
  if (!user) return NextResponse.redirect(new URL("/login?return_to=%2Fintegrations", appUrl));

  const store = await cookies();
  const expectedState = store.get(SLACK_STATE_COOKIE)?.value;
  const organisationId = store.get(SLACK_ORG_COOKIE)?.value;
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  clearSlackCookies(store);

  if (!expectedState || !organisationId || !state || state !== expectedState || !code) {
    destination.searchParams.set("error", "invalid_slack_callback");
    return NextResponse.redirect(destination);
  }

  const workspace = await getFoundWorkspace(organisationId);
  if (!workspace || !["owner", "admin"].includes(workspace.role)) {
    destination.searchParams.set("error", "workspace_forbidden");
    return NextResponse.redirect(destination);
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    destination.searchParams.set("error", "slack_not_configured");
    return NextResponse.redirect(destination);
  }

  const redirectUri = `${appUrl}/auth/slack/callback`;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ code, redirect_uri: redirectUri }),
    cache: "no-store",
  });
  const installation = (await response.json().catch(() => null)) as SlackOAuthResponse | null;
  if (!response.ok || !installation?.ok || !installation.access_token || !installation.refresh_token || !installation.expires_in || !installation.team?.id) {
    destination.searchParams.set("error", "slack_authorization_failed");
    return NextResponse.redirect(destination);
  }

  try {
    const encrypted = await encryptIntegrationSecret(JSON.stringify({
      accessToken: installation.access_token,
      expiresAt: installation.expires_in
        ? new Date(Date.now() + installation.expires_in * 1000).toISOString()
        : undefined,
      refreshToken: installation.refresh_token,
      tokenType: installation.token_type,
    }));
    await saveIntegrationConnection({
      organisationId,
      provider: "slack",
      externalWorkspaceId: installation.team.id,
      externalWorkspaceName: installation.team.name ?? installation.team.id,
      grantedScopes: installation.scope?.split(",").filter(Boolean) ?? [],
      status: "connected",
    }, encrypted);
  } catch (error) {
    if (error instanceof IntegrationWorkspaceConflictError) {
      destination.searchParams.set("error", "slack_workspace_already_connected");
      return NextResponse.redirect(destination);
    }
    destination.searchParams.set("error", "connection_storage_failed");
    return NextResponse.redirect(destination);
  }

  destination.searchParams.set("connected", "slack");
  return NextResponse.redirect(destination);
}

function clearSlackCookies(store: Awaited<ReturnType<typeof cookies>>) {
  for (const name of [SLACK_STATE_COOKIE, SLACK_ORG_COOKIE]) {
    store.set(name, "", { httpOnly: true, maxAge: 0, path: "/", sameSite: "lax" });
  }
}
