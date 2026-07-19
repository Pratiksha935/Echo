import { NextRequest, NextResponse } from "next/server";
import { verifyBrowserToken } from "../../../../lib/auth/browser-token";
import { HermesUnavailableError, queryHermes } from "../../../../lib/hermes/client";
import { extractStructuredIdentifiers } from "../../../../lib/integrations/google-sheet-records";
import { serviceRest } from "../../../../lib/integrations/service-rest";

const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

type KnowledgeRow = {
  author_name: string | null;
  body: string;
  department: string | null;
  external_id: string;
  metadata: { status?: string } | null;
  source: string;
  source_url: string;
  title: string;
};
type MemoryUpdateRow = { created_at: string; current_title: string; origin: string; original_source_url: string; update_text: string };

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

  const body = await request.json().catch(() => null) as { pageText?: unknown; pageTitle?: unknown; pageUrl?: unknown; question?: unknown; recordId?: unknown } | null;
  const recordId = text(body?.recordId, 220);
  const question = text(body?.question, 700);
  const pageTitle = text(body?.pageTitle, 500);
  const pageText = text(body?.pageText, 3_000);
  const pageUrl = text(body?.pageUrl, 2_000);
  if (question.length < 4) return NextResponse.json({ error: "invalid_question" }, { status: 400, headers });

  const [structuredRows, recentRows] = await Promise.all([
    loadStructuredGoogleSheetRows(token.organisationId, question),
    serviceRest<KnowledgeRow[]>(
      `/knowledge_records?select=source,external_id,title,body,author_name,department,source_url,metadata&organisation_id=eq.${encodeURIComponent(token.organisationId)}&order=source_updated_at.desc&limit=100`,
    ),
  ]);
  const allRows = uniqueRows([...structuredRows, ...recentRows]);
  const primary = recordId ? allRows.find(row => row.external_id === recordId) : null;
  const titleKey = primary ? normaliseTitle(primary.title) : "";
  const related = uniqueRows(
    primary
      ? [...structuredRows, primary, ...allRows.filter(row => normaliseTitle(row.title) === titleKey)]
      : [...structuredRows, ...rankRowsForPage(allRows, `${pageTitle} ${pageText}`).slice(0, 8)],
  ).slice(0, 8);
  if (!related.length) return NextResponse.json({ error: "record_not_found" }, { status: 404, headers });
  const updates = await serviceRest<MemoryUpdateRow[]>(
    recordId
      ? `/memory_updates?select=current_title,update_text,origin,original_source_url,created_at&organisation_id=eq.${encodeURIComponent(token.organisationId)}&source_record_id=eq.${encodeURIComponent(recordId)}&order=created_at.desc&limit=6`
      : `/memory_updates?select=current_title,update_text,origin,original_source_url,created_at&organisation_id=eq.${encodeURIComponent(token.organisationId)}&order=created_at.desc&limit=6`,
  ).catch(() => []);

  const prompt = buildPrompt({ organisationName: token.organisationName, pageText, pageTitle, pageUrl, question, records: related, updates });
  try {
    const answer = await queryHermes(prompt, token.organisationId);
    return NextResponse.json({ answer, sources: related.map(toSource) }, { headers });
  } catch (error) {
    if (error instanceof HermesUnavailableError) return NextResponse.json({ error: "hermes_unavailable" }, { status: 503, headers });
    throw error;
  }
}

function buildPrompt(input: { organisationName: string; pageText: string; pageTitle: string; pageUrl: string; question: string; records: KnowledgeRow[]; updates: MemoryUpdateRow[] }): string {
  return `You are Hermes, Found's decision and memory layer for ${input.organisationName}.
Answer the user's battlecard question only from the source receipts and memory updates below.
If the evidence is insufficient, reply exactly: I couldn’t find enough evidence in company knowledge to answer this.
Do not add general advice, external knowledge, or assumptions.
Keep the answer concise, useful, and cite source names/links inline.

Question:
${input.question}

Current page context:
Title: ${input.pageTitle || "Not provided"}
URL: ${input.pageUrl || "Not provided"}
Excerpt: ${input.pageText ? input.pageText.slice(0, 1500) : "Not provided"}

Source receipts:
${input.records.map((record, index) => `${index + 1}. ${record.source} · ${record.title}
Owner: ${record.author_name ?? "Owner not indexed"}
Status: ${record.metadata?.status ?? "Indexed"}
Link: ${record.source_url}
Evidence: ${record.body.slice(0, 1600)}`).join("\n\n")}

Memory updates:
${input.updates.length ? input.updates.map((update, index) => `${index + 1}. ${update.origin} · ${update.created_at}
Title: ${update.current_title}
Link: ${update.original_source_url}
Update: ${update.update_text.slice(0, 900)}`).join("\n\n") : "None indexed."}`;
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

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normaliseTitle(value: string): string {
  return value.toLowerCase().replace(/^\[[^\]]+\]\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function rankRowsForPage(rows: KnowledgeRow[], pageContext: string): KnowledgeRow[] {
  const terms = new Set(pageContext.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
  if (!terms.size) return rows.slice(0, 8);
  return rows
    .map(row => {
      const haystack = `${row.title} ${row.department ?? ""} ${row.body}`.toLowerCase();
      let score = 0;
      for (const term of terms) if (haystack.includes(term)) score += 1;
      return { row, score };
    })
    .sort((a, b) => b.score - a.score)
    .filter(item => item.score > 0)
    .map(item => item.row);
}

function uniqueRows(rows: KnowledgeRow[]): KnowledgeRow[] {
  const seen = new Set<string>();
  return rows.filter(row => {
    const key = `${row.source}:${row.external_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadStructuredGoogleSheetRows(organisationId: string, question: string): Promise<KnowledgeRow[]> {
  const identifiers = extractStructuredIdentifiers(question);
  if (!identifiers.length) return [];
  const results = await Promise.all(identifiers.map(identifier => {
    const query = new URLSearchParams({
      select: "source,external_id,title,body,author_name,department,source_url,metadata",
      organisation_id: `eq.${organisationId}`,
      visibility: "eq.workspace",
      source: "eq.Google Sheets",
      "metadata->>record_kind": "eq.sheet_row",
      "metadata->>row_key_normalized": `eq.${identifier}`,
      limit: "10",
    });
    return serviceRest<KnowledgeRow[]>(`/knowledge_records?${query}`).catch(() => []);
  }));
  return uniqueRows(results.flat());
}

function toSource(record: KnowledgeRow) {
  return { label: `${record.source} evidence`, title: record.title, url: record.source_url };
}
