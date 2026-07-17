import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getFoundUser } from "../../../auth";
import { getFoundWorkspace } from "../../../../lib/auth/workspace";
import { encryptIntegrationSecret } from "../../../../lib/integrations/secrets";
import { saveIntegrationConnection } from "../../../../lib/integrations/store";

const SLACK_STATE_COOKIE = "found_slack_oauth_state";
const SLACK_ORG_COOKIE = "found_slack_oauth_org";

type SlackOAuthResponse = {
  access_token?: string;
  error?: string;
  ok: boolean;
  scope?: string;
  team?: { id?: string; name?: string };
};

export async function GET(request: NextRequest) {
  const destination = new URL("/integrations", request.url);
  const user = await getFoundUser();
  if (!user) return NextResponse.redirect(new URL("/login?return_to=%2Fintegrations", request.url));

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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!clientId || !clientSecret || !appUrl) {
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
  if (!response.ok || !installation?.ok || !installation.access_token || !installation.team?.id) {
    destination.searchParams.set("error", "slack_authorization_failed");
    return NextResponse.redirect(destination);
  }

  try {
    const encrypted = await encryptIntegrationSecret(installation.access_token);
    await saveIntegrationConnection({
      organisationId,
      provider: "slack",
      externalWorkspaceId: installation.team.id,
      externalWorkspaceName: installation.team.name ?? installation.team.id,
      grantedScopes: installation.scope?.split(",").filter(Boolean) ?? [],
      status: "connected",
    }, encrypted);
  } catch {
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
