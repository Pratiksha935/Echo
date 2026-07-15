import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getFoundUser } from "../../../auth";
import { getFoundWorkspace } from "../../../../lib/auth/workspace";
import { randomBase64Url } from "../../../../lib/auth/session";
import { buildAuthorizationUrl, isConnectableProvider } from "../../../../lib/integrations/oauth";

export const INTEGRATION_STATE_COOKIE = "found_integration_oauth_state";
export const INTEGRATION_ORG_COOKIE = "found_integration_oauth_org";
export const INTEGRATION_PROVIDER_COOKIE = "found_integration_oauth_provider";

type RouteContext = { params: Promise<{ provider: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { provider } = await context.params;
  if (!isConnectableProvider(provider)) return NextResponse.redirect(new URL("/integrations?error=unsupported_provider", request.url));

  const user = await getFoundUser();
  if (!user) return NextResponse.redirect(new URL(`/login?return_to=${encodeURIComponent(`/auth/integrations/${provider}`)}`, request.url));
  const workspace = await getFoundWorkspace();
  if (!workspace || !["owner", "admin"].includes(workspace.role)) {
    return NextResponse.redirect(new URL("/integrations?error=admin_required", request.url));
  }

  try {
    const state = randomBase64Url(32);
    const secure = process.env.NODE_ENV === "production";
    const store = await cookies();
    const options = { httpOnly: true, maxAge: 600, path: "/", sameSite: "lax" as const, secure };
    store.set(INTEGRATION_STATE_COOKIE, state, options);
    store.set(INTEGRATION_ORG_COOKIE, workspace.organisationId, options);
    store.set(INTEGRATION_PROVIDER_COOKIE, provider, options);
    return NextResponse.redirect(buildAuthorizationUrl(provider, state));
  } catch {
    return NextResponse.redirect(new URL(`/integrations?error=${provider}_not_configured`, request.url));
  }
}
