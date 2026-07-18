import { NextRequest, NextResponse } from "next/server";
import { verifyBrowserToken } from "../../../../lib/auth/browser-token";
import { listSlackBrowserShareTargets } from "../../../../lib/integrations/slack-events";
import { serviceRest } from "../../../../lib/integrations/service-rest";

const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

export async function OPTIONS(request: NextRequest) {
  const origin = allowedOrigin(request);
  return new NextResponse(null, { status: origin ? 204 : 403, headers: origin ? corsHeaders(origin) : undefined });
}

export async function GET(request: NextRequest) {
  const origin = allowedOrigin(request);
  if (!origin) return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  const headers = corsHeaders(origin);
  const token = verifiedToken(request);
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  const allowed = await hasWorkspaceMembership(token.organisationId, token.userId);
  if (!allowed) return NextResponse.json({ error: "workspace_access_revoked" }, { status: 403, headers });
  const targets = await listSlackBrowserShareTargets(token.organisationId).catch(error => ({ error: error instanceof Error ? error.message : "slack_targets_unavailable" }));
  if ("error" in targets) {
    return NextResponse.json({ error: targets.error }, { status: targets.error === "slack_not_connected" ? 409 : 503, headers });
  }
  return NextResponse.json(targets, { headers });
}

function verifiedToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? verifyBrowserToken(authorization.slice(7)) : null;
}

async function hasWorkspaceMembership(organisationId: string, userId: string): Promise<boolean> {
  const memberships = await serviceRest<Array<{ id: string }>>(`/memberships?select=id&organisation_id=eq.${encodeURIComponent(organisationId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return Boolean(memberships[0]);
}

function allowedOrigin(request: NextRequest): string | null {
  const origin = request.headers.get("origin");
  return origin && EXTENSION_ORIGIN.test(origin) ? origin : null;
}

function corsHeaders(origin: string): HeadersInit {
  return {
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-origin": origin,
    "cache-control": "no-store",
    vary: "origin",
  };
}
