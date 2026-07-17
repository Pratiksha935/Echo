import { NextRequest, NextResponse } from "next/server";
import { verifyBrowserToken } from "../../../../lib/auth/browser-token";
import { serviceRest } from "../../../../lib/integrations/service-rest";

const STOP_WORDS = new Set(["about", "after", "again", "already", "could", "from", "have", "into", "should", "that", "their", "there", "these", "this", "what", "when", "where", "which", "with", "would"]);
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
  if (!pageTitle && !pageText) return NextResponse.json({ match: null }, { headers });

  const rows = await serviceRest<BrowserKnowledgeRow[]>(`/knowledge_records?select=source,external_id,title,body,author_name,department,source_url,metadata&organisation_id=eq.${encodeURIComponent(token.organisationId)}&order=source_updated_at.desc&limit=200`);
  const records = rows.map(row => ({ authorName: row.author_name, body: row.body, department: row.department, externalId: row.external_id, source: row.source, sourceUrl: row.source_url, status: row.metadata?.status ?? "Indexed", title: row.title }));
  const pageResourceId = googleResourceId(pageUrl);
  const sourceRecord = pageResourceId
    ? records.find(record => record.externalId === pageResourceId || googleResourceId(record.sourceUrl) === pageResourceId)
    : records.find(record => canonicalUrl(record.sourceUrl) === canonicalUrl(pageUrl));
  const query = `${sourceRecord?.title ?? ""} ${sourceRecord?.body ?? ""} ${pageTitle} ${pageText}`.toLowerCase();
  const terms = [...new Set(query.split(/\W+/).filter(term => term.length > 3 && !STOP_WORDS.has(term)))].slice(0, 80);
  const ranked = records.map(record => {
    const title = record.title.toLowerCase();
    const evidence = `${record.title} ${record.body} ${record.department ?? ""}`.toLowerCase();
    const matchedTerms = terms.filter(term => evidence.includes(term));
    const score = matchedTerms.reduce((total, term) => total + (title.includes(term) ? 4 : 1), 0);
    return { record, terms: matchedTerms, matchedTerms: matchedTerms.length, score };
  }).filter(candidate => candidate.record.externalId !== sourceRecord?.externalId)
    .filter(candidate => candidate.score >= 5 && candidate.matchedTerms >= 2)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0] ?? (sourceRecord ? { record: sourceRecord, terms: [], matchedTerms: terms.length, score: 12 } : null);
  if (!best) return NextResponse.json({ match: null }, { headers });
  const related = uniqueRecords([
    ...(sourceRecord ? [sourceRecord] : []),
    ...ranked.slice(0, 3).map(candidate => candidate.record),
    ...records.filter(record => normaliseTitle(record.title) === normaliseTitle(best.record.title)),
  ]);
  const sources = [...new Set(related.map(record => record.source))];
  const crossSource = Boolean(sourceRecord && best.record.externalId !== sourceRecord.externalId);
  const overlap = best.terms.slice(0, 4).join(", ");
  const insight = sourceRecord && crossSource
    ? `${best.record.source} evidence connected to this ${sourceRecord.source} document: ${best.record.body.slice(0, 320)}`
    : best.record.body.slice(0, 380);
  const whyMatches = crossSource && overlap
    ? `The open document and this ${best.record.source} record overlap on ${overlap}.`
    : "This page is an exact indexed company source.";
  return NextResponse.json({ match: {
    account: { email: token.email, organisationName: token.organisationName },
    id: best.record.externalId,
    links: related.slice(0, 4).map(record => ({ label: `${record.source} evidence`, url: record.sourceUrl })),
    live: true,
    owner: best.record.authorName ?? "Company knowledge",
    recommendation: crossSource
      ? `Review the ${best.record.source} evidence and current status before creating another proposal or ticket.`
      : "Open the indexed source receipts to review the latest company context.",
    score: Math.min(5, Math.max(2, Math.ceil(best.score / 6))),
    source: sources.join(" + "),
    status: best.record.status,
    summary: `${insight} ${whyMatches}`.slice(0, 520),
    title: best.record.title,
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

function normaliseTitle(value: string): string {
  return value.toLowerCase().replace(/^\[[^\]]+\]\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function googleResourceId(value: string): string | null {
  try {
    const url = new URL(value);
    if (!/(^|\.)google\.com$/.test(url.hostname)) return null;
    return url.pathname.match(/\/(?:document|spreadsheets|presentation|file)\/d\/([^/]+)/)?.[1] ?? url.searchParams.get("id");
  } catch {
    return null;
  }
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return value;
  }
}

function uniqueRecords<T extends { externalId: string; source: string }>(records: T[]): T[] {
  const seen = new Set<string>();
  return records.filter(record => {
    const key = `${record.source}:${record.externalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
