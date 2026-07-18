import { NextRequest, NextResponse } from "next/server";
import { verifyBrowserToken } from "../../../../lib/auth/browser-token";
import { shareBrowserPageToSlack, type SlackShareRecipient } from "../../../../lib/integrations/slack-events";
import { serviceRest } from "../../../../lib/integrations/service-rest";

const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const DEPARTMENTS = new Set(["Product", "GTM", "Sales", "Engineering", "Research", "Browser"]);

export async function OPTIONS(request: NextRequest) {
  const origin = allowedOrigin(request);
  return new NextResponse(null, { status: origin ? 204 : 403, headers: origin ? corsHeaders(origin) : undefined });
}

export async function POST(request: NextRequest) {
  const origin = allowedOrigin(request);
  if (!origin) return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  const headers = corsHeaders(origin);
  const token = verifiedToken(request);
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  const allowed = await hasWorkspaceMembership(token.organisationId, token.userId);
  if (!allowed) return NextResponse.json({ error: "workspace_access_revoked" }, { status: 403, headers });

  const body = await request.json().catch(() => null) as { department?: unknown; note?: unknown; pageTitle?: unknown; pageUrl?: unknown; recipients?: unknown } | null;
  const recipients = normaliseRecipients(body?.recipients);
  const department = text(body?.department, 40);
  const note = text(body?.note, 1200);
  const pageTitle = text(body?.pageTitle, 220);
  const pageUrl = safeUrl(text(body?.pageUrl, 2000));
  if (!recipients.length || !DEPARTMENTS.has(department) || !pageTitle || !pageUrl) {
    return NextResponse.json({ error: "invalid_share" }, { status: 400, headers });
  }

  const result = await shareBrowserPageToSlack({
    department,
    note,
    organisationId: token.organisationId,
    pageTitle,
    pageUrl,
    recipients,
    senderEmail: token.email,
  }).catch(() => null);
  if (!result) return NextResponse.json({ error: "slack_unavailable" }, { status: 409, headers });
  if (!result.sent) return NextResponse.json({ error: "no_reachable_recipients" }, { status: 422, headers });
  return NextResponse.json({ ok: true, sent: result.sent }, { headers });
}

function verifiedToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? verifyBrowserToken(authorization.slice(7)) : null;
}

async function hasWorkspaceMembership(organisationId: string, userId: string): Promise<boolean> {
  const memberships = await serviceRest<Array<{ id: string }>>(`/memberships?select=id&organisation_id=eq.${encodeURIComponent(organisationId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return Boolean(memberships[0]);
}

function normaliseRecipients(value: unknown): SlackShareRecipient[] {
  if (!Array.isArray(value)) return [];
  const recipients: SlackShareRecipient[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, 20)) {
    const record = item && typeof item === "object" ? item as { id?: unknown; type?: unknown } : {};
    const id = typeof record.id === "string" && /^[A-Z0-9]{3,32}$/.test(record.id.trim()) ? record.id.trim() : "";
    const type = record.type === "channel" ? "channel" : record.type === "user" ? "user" : null;
    if (!id || !type) continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({ id, type });
  }
  return recipients;
}

function allowedOrigin(request: NextRequest): string | null {
  const origin = request.headers.get("origin");
  return origin && EXTENSION_ORIGIN.test(origin) ? origin : null;
}

function corsHeaders(origin: string): HeadersInit {
  return {
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-origin": origin,
    "cache-control": "no-store",
    vary: "origin",
  };
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
