import { NextRequest, NextResponse } from "next/server";
import { getFoundUser } from "../../../auth";
import { HermesUnavailableError, queryHermes } from "../../../../lib/hermes/client";
import { findWorkspaceGoogleSheetRows, getFoundWorkspace, listMemoryUpdates, listWorkspaceKnowledgeRecords } from "../../../../lib/auth/workspace";
import { extractStructuredIdentifiers } from "../../../../lib/integrations/google-sheet-records";

export async function POST(request: NextRequest) {
  const user = await getFoundUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as { message?: unknown; organisationId?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const requestedOrganisationId = typeof body?.organisationId === "string" ? body.organisationId : undefined;
  if (!message || message.length > 4000) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const workspace = await getFoundWorkspace(requestedOrganisationId);
  if (!workspace) return NextResponse.json({ error: "workspace_forbidden" }, { status: 403 });
  const [structuredRows, recentRecords, updates] = await Promise.all([
    findWorkspaceGoogleSheetRows(workspace.organisationId, extractStructuredIdentifiers(message)),
    listWorkspaceKnowledgeRecords(workspace.organisationId, 80),
    listMemoryUpdates(workspace.organisationId),
  ]);
  const records = uniqueKnowledgeRecords([...structuredRows, ...recentRecords]);
  const evidencePrompt = buildKnowledgePrompt({
    message,
    organisationName: workspace.organisationName,
    records,
    updates,
  });

  try {
    return NextResponse.json({ answer: await queryHermes(evidencePrompt, workspace.organisationId) });
  } catch (error) {
    if (error instanceof HermesUnavailableError) return NextResponse.json({ error: "temporarily_unavailable" }, { status: 503 });
    throw error;
  }
}

function buildKnowledgePrompt(input: {
  message: string;
  organisationName: string;
  records: Awaited<ReturnType<typeof listWorkspaceKnowledgeRecords>>;
  updates: Awaited<ReturnType<typeof listMemoryUpdates>>;
}): string {
  return `You are Hermes, Found's organisational memory and decision layer for ${input.organisationName}.
Answer the user's question only from the indexed company knowledge and append-only memory updates below.
If evidence is insufficient, reply exactly: I couldn’t find enough evidence in company knowledge to answer this.
Do not add external knowledge, generic frameworks, assumptions, or advice.
Lead with the internal answer, then cite source name, owner/status, and link when available.
Keep it concise.

User question:
${input.message}

Indexed company knowledge:
${input.records.slice(0, 60).map((record, index) => `${index + 1}. ${record.source} · ${record.title}
Department: ${record.department ?? "Unknown"}
Owner: ${record.authorName ?? "Owner not indexed"}
Status: ${record.status}
Link: ${record.sourceUrl}
Evidence: ${compact(record.body, 1000)}`).join("\n\n") || "None indexed."}

Append-only memory updates:
${input.updates.slice(0, 30).map((update, index) => `${index + 1}. ${update.origin} · ${update.currentTitle}
Created: ${update.createdAt}
Link: ${update.sourceUrl}
Update: ${compact(update.updateText, 700)}`).join("\n\n") || "None indexed."}`;
}

function compact(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function uniqueKnowledgeRecords<T extends { externalId: string; source: string }>(records: T[]): T[] {
  const seen = new Set<string>();
  return records.filter(record => {
    const key = `${record.source}:${record.externalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
