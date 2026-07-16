import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getFoundUser } from "../../auth";
import { getFoundWorkspace, listIntegrationConnections } from "../../../lib/auth/workspace";
import { randomBase64Url } from "../../../lib/auth/session";

const SLACK_STATE_COOKIE = "found_slack_oauth_state";
const SLACK_ORG_COOKIE = "found_slack_oauth_org";
const SLACK_SCOPES = [
  "channels:history",
  "channels:read",
  "chat:write",
  "groups:history",
  "groups:read",
  "users:read",
];

export async function GET(request: NextRequest) {
  const user = await getFoundUser();
  if (!user) return NextResponse.redirect(new URL("/login?return_to=%2Fauth%2Fslack", request.url));

  const workspace = await getFoundWorkspace();
  if (!workspace || !["owner", "admin"].includes(workspace.role)) {
    return NextResponse.redirect(new URL("/integrations?error=admin_required", request.url));
  }
  const connections = await listIntegrationConnections(workspace.organisationId);
  if (!connections.some(connection => connection.provider === "google")) {
    return NextResponse.redirect(new URL("/integrations?error=google_required", request.url));
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!clientId || !appUrl) return NextResponse.redirect(new URL("/integrations?error=slack_not_configured", request.url));

  const state = randomBase64Url(32);
  const secure = process.env.NODE_ENV === "production";
  const store = await cookies();
  store.set(SLACK_STATE_COOKIE, state, { httpOnly: true, maxAge: 600, path: "/", sameSite: "lax", secure });
  store.set(SLACK_ORG_COOKIE, workspace.organisationId, { httpOnly: true, maxAge: 600, path: "/", sameSite: "lax", secure });

  const redirectUri = `${appUrl}/auth/slack/callback`;
  const authorize = new URL("https://slack.com/oauth/v2/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("scope", SLACK_SCOPES.join(","));
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);
  return NextResponse.redirect(authorize);
}
