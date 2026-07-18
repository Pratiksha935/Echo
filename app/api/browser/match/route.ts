import { NextRequest, NextResponse } from "next/server";
import { verifyBrowserToken } from "../../../../lib/auth/browser-token";
import { matchBrowserKnowledge } from "../../../../lib/browser/matcher";
import { HermesUnavailableError, queryHermes } from "../../../../lib/hermes/client";
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
  const exactRows = await loadExactSourceRows(token.organisationId, pageUrl);
  const records = uniqueRows([...exactRows, ...rows]).map(row => ({ authorName: row.author_name, body: row.body, department: row.department, externalId: row.external_id, source: row.source, sourceUrl: row.source_url, status: row.metadata?.status ?? "Indexed", title: row.title }));
  const match = matchBrowserKnowledge({ pageText, pageTitle, pageUrl, records });
  if (!match) return NextResponse.json({ match: null }, { headers });
  const hermesVerdict = await reviewBrowserMatchWithHermes({
    match,
    organisationId: token.organisationId,
    pageText,
    pageTitle,
    pageUrl,
    records,
  });
  if (!hermesVerdict.show) return NextResponse.json({ match: null, reason: hermesVerdict.reason }, { headers });
  const updates = await serviceRest<MemoryUpdateRow[]>(`/memory_updates?select=update_text,created_at&organisation_id=eq.${encodeURIComponent(token.organisationId)}&source_record_id=eq.${encodeURIComponent(match.id)}&order=created_at.desc&limit=1`);
  const latestUpdate = updates[0];
  return NextResponse.json({ match: {
    account: { email: token.email, organisationName: token.organisationName },
    ...match,
    score: hermesVerdict.score ?? match.score,
    summary: hermesVerdict.summary ?? match.summary,
    recommendation: hermesVerdict.recommendation ?? match.recommendation,
    ...(latestUpdate ? {
      latestUpdate: { createdAt: latestUpdate.created_at, text: latestUpdate.update_text },
      status: "Memory updated",
      summary: `Latest team update: ${latestUpdate.update_text} ${hermesVerdict.summary ?? match.summary}`.slice(0, 700),
    } : {}),
    dashboardUrl: new URL(`/workspace/decision/${encodeURIComponent(match.id)}`, request.url).toString(),
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
type MemoryUpdateRow = { created_at: string; update_text: string };
type BrowserRecord = { authorName: string | null; body: string; department: string | null; externalId: string; source: string; sourceUrl: string; status: string; title: string };
type BrowserMatch = {
  id: string;
  links: Array<{ label: string; url: string }>;
  live: boolean;
  owner: string;
  recommendation: string;
  score: number;
  source: string;
  status: string;
  summary: string;
  title: string;
};
type HermesMatchVerdict = { show: boolean; reason: string; score?: number; summary?: string; recommendation?: string };

async function reviewBrowserMatchWithHermes(input: {
  match: BrowserMatch;
  organisationId: string;
  pageText: string;
  pageTitle: string;
  pageUrl: string;
  records: BrowserRecord[];
}): Promise<HermesMatchVerdict> {
  const candidate = input.records.find(record => record.externalId === input.match.id);
  if (!candidate) return { show: false, reason: "candidate_record_missing" };
  const candidateGoogleId = googleResourceId(candidate.sourceUrl);
  const pageGoogleId = googleResourceId(input.pageUrl);
  const exactCompanySource = canonicalUrl(candidate.sourceUrl) === canonicalUrl(input.pageUrl) || Boolean(candidateGoogleId && pageGoogleId && candidateGoogleId === pageGoogleId);
  const exactOpenCompanySource = input.records.find(record => !/^browser$/i.test(record.source) && (
    canonicalUrl(record.sourceUrl) === canonicalUrl(input.pageUrl)
    || Boolean(googleResourceId(record.sourceUrl) && pageGoogleId && googleResourceId(record.sourceUrl) === pageGoogleId)
  ));
  if ((exactCompanySource && !/^browser$/i.test(candidate.source)) || exactOpenCompanySource) {
    return {
      show: true,
      reason: "exact_company_source",
      score: Math.max(input.match.score, 4),
      summary: input.match.summary,
      recommendation: input.match.recommendation,
    };
  }
  const prompt = buildHermesMatchPrompt(input, candidate);
  try {
    const response = await queryHermes(prompt, input.organisationId);
    const parsed = parseHermesMatchVerdict(response);
    if (!parsed.show || (parsed.confidence ?? 0) < 85) return { show: false, reason: parsed.reason || "hermes_rejected_match" };
    return {
      show: true,
      reason: "hermes_confirmed",
      score: Math.max(2, Math.min(5, Math.ceil((parsed.confidence ?? 85) / 20))),
      summary: text(parsed.summary, 520) || input.match.summary,
      recommendation: text(parsed.recommendation, 220) || input.match.recommendation,
    };
  } catch (error) {
    if (error instanceof HermesUnavailableError) return { show: false, reason: "hermes_unavailable" };
    throw error;
  }
}

function buildHermesMatchPrompt(input: { match: BrowserMatch; pageText: string; pageTitle: string; pageUrl: string; records: BrowserRecord[] }, candidate: BrowserRecord): string {
  const linkedSources = (input.match.links || [])
    .map(link => input.records.find(record => record.sourceUrl === link.url))
    .filter((record): record is BrowserRecord => Boolean(record))
    .slice(0, 5);
  const evidence = uniqueBrowserRecords([candidate, ...linkedSources]);
  return `You are Hermes, Found's decision and memory layer.
Decide whether Found should show a browser battlecard for the open page.
Return only compact JSON with this schema:
{"show":true|false,"confidence":0-100,"reason":"...","summary":"...","recommendation":"..."}

Rules:
- show=true only when the open page is the same concrete work, duplicate intent, or conflicting internal decision as the indexed company evidence.
- show=false for merely same industry, same vendor, broad AI/research overlap, casual Slack text, generic article similarity, or Browser-only saved research without verified Slack/Google/Jira/Notion/GitHub evidence.
- Use only the supplied source receipts. Do not use outside knowledge.
- If unsure, show=false.
- summary must explain the internal source-backed insight in 1-2 sentences.

Open page:
Title: ${input.pageTitle}
URL: ${input.pageUrl}
Text excerpt: ${compact(input.pageText, 2200)}

Candidate battlecard:
Title: ${candidate.title}
Source: ${candidate.source}
Department: ${candidate.department ?? "Unknown"}
Owner: ${candidate.authorName ?? "Unknown"}
Status: ${candidate.status}
URL: ${candidate.sourceUrl}
Evidence: ${compact(candidate.body, 1800)}

Additional source receipts:
${evidence.filter(record => record.externalId !== candidate.externalId).map((record, index) => `${index + 1}. ${record.source} · ${record.title}
Status: ${record.status}
URL: ${record.sourceUrl}
Evidence: ${compact(record.body, 900)}`).join("\n\n") || "None."}`;
}

function parseHermesMatchVerdict(value: string): { show: boolean; confidence?: number; reason?: string; summary?: string; recommendation?: string } {
  const json = value.match(/\{[\s\S]*\}/)?.[0] ?? value;
  try {
    const parsed = JSON.parse(json) as { show?: unknown; confidence?: unknown; reason?: unknown; summary?: unknown; recommendation?: unknown };
    return {
      show: parsed.show === true,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined,
      reason: text(parsed.reason, 160),
      summary: text(parsed.summary, 520),
      recommendation: text(parsed.recommendation, 220),
    };
  } catch {
    return { show: false, reason: "hermes_returned_unparseable_verdict" };
  }
}

async function loadExactSourceRows(organisationId: string, pageUrl: string): Promise<BrowserKnowledgeRow[]> {
  const googleId = googleResourceId(pageUrl);
  if (googleId) {
    const [externalRows, urlRows] = await Promise.all([
      serviceRest<BrowserKnowledgeRow[]>(`/knowledge_records?select=source,external_id,title,body,author_name,department,source_url,metadata&organisation_id=eq.${encodeURIComponent(organisationId)}&external_id=eq.${encodeURIComponent(googleId)}&limit=5`).catch(() => []),
      serviceRest<BrowserKnowledgeRow[]>(`/knowledge_records?select=source,external_id,title,body,author_name,department,source_url,metadata&organisation_id=eq.${encodeURIComponent(organisationId)}&source_url=ilike.*${encodeURIComponent(googleId)}*&limit=5`).catch(() => []),
    ]);
    return uniqueRows([...externalRows, ...urlRows]);
  }
  const canonical = canonicalUrl(pageUrl);
  if (!canonical) return [];
  return serviceRest<BrowserKnowledgeRow[]>(`/knowledge_records?select=source,external_id,title,body,author_name,department,source_url,metadata&organisation_id=eq.${encodeURIComponent(organisationId)}&source_url=eq.${encodeURIComponent(canonical)}&limit=5`).catch(() => []);
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

function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function uniqueRows(rows: BrowserKnowledgeRow[]): BrowserKnowledgeRow[] {
  const seen = new Set<string>();
  return rows.filter(row => {
    const key = `${row.source}:${row.external_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueBrowserRecords(records: BrowserRecord[]): BrowserRecord[] {
  const seen = new Set<string>();
  return records.filter(record => {
    const key = `${record.source}:${record.externalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function compact(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}
