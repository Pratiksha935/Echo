import { NextRequest, NextResponse } from "next/server";
import { verifyBrowserToken } from "../../../../lib/auth/browser-token";
import { matchBrowserKnowledge } from "../../../../lib/browser/matcher";
import { serviceRest } from "../../../../lib/integrations/service-rest";

const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

export async function OPTIONS(request: NextRequest) {
  const origin = allowedOrigin(request);
  return new NextResponse(null, { status: origin ? 204 : 403, headers: origin ? corsHeaders(origin) : undefined });
}

export async function POST(request: NextRequest) {
  const origin = allowedOrigin(request);
  if (!origin) return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  const headers = corsHeaders(origin);
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? verifyBrowserToken(authorization.slice(7)) : null;
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });

  const memberships = await serviceRest<Array<{ id: string }>>(`/memberships?select=id&organisation_id=eq.${encodeURIComponent(token.organisationId)}&user_id=eq.${encodeURIComponent(token.userId)}&limit=1`);
  if (!memberships[0]) return NextResponse.json({ error: "workspace_access_revoked" }, { status: 403, headers });

  const body = await request.json().catch(() => null) as { pageText?: unknown; pageTitle?: unknown; pageUrl?: unknown } | null;
  const pageTitle = typeof body?.pageTitle === "string" ? body.pageTitle.slice(0, 500) : "";
  const pageText = typeof body?.pageText === "string" ? body.pageText.slice(0, 8_000) : "";
  const pageUrl = typeof body?.pageUrl === "string" ? body.pageUrl.slice(0, 2_000) : "";
  if (!pageTitle && !pageText && !pageUrl) return NextResponse.json({ match: null }, { headers });

  const rows = await serviceRest<BrowserKnowledgeRow[]>(`/knowledge_records?select=source,external_id,title,body,author_name,department,source_url,metadata&organisation_id=eq.${encodeURIComponent(token.organisationId)}&order=source_updated_at.desc&limit=200`);
  const records = rows.map(row => ({ authorName: row.author_name, body: row.body, department: row.department, externalId: row.external_id, source: row.source, sourceUrl: row.source_url, status: row.metadata?.status ?? "Indexed", title: row.title }));
  const match = matchBrowserKnowledge({ pageText, pageTitle, pageUrl, records });
  if (!match) return NextResponse.json({ match: null }, { headers });
  return NextResponse.json({ match: {
    account: { email: token.email, organisationName: token.organisationName },
    ...match,
    url: pageUrl,
  } }, { headers });
}

function allowedOrigin(request: NextRequest): string | null {
  const origin = request.headers.get("origin");
  return origin && EXTENSION_ORIGIN.test(origin) ? origin : null;
}

function corsHeaders(origin: string): HeadersInit {
  return {
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-origin": origin,
    "cache-control": "no-store",
    vary: "origin",
  };
}

type BrowserKnowledgeRow = { author_name: string | null; body: string; department: string | null; external_id: string; metadata: { status?: string } | null; source: string; source_url: string; title: string };
