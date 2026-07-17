import { NextRequest, NextResponse } from "next/server";
import { verifyBrowserToken } from "../../../../lib/auth/browser-token";
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

  const body = await request.json().catch(() => null) as { recordId?: unknown; sourceUrl?: unknown; updateText?: unknown } | null;
  const recordId = text(body?.recordId, 200);
  const sourceUrl = safeUrl(text(body?.sourceUrl, 2_000));
  const updateText = text(body?.updateText, 800);
  if (!recordId || !sourceUrl || updateText.length < 12) return NextResponse.json({ error: "invalid_update" }, { status: 400, headers });

  const records = await serviceRest<Array<{ source_url: string; title: string }>>(`/knowledge_records?select=source_url,title&organisation_id=eq.${encodeURIComponent(token.organisationId)}&external_id=eq.${encodeURIComponent(recordId)}&limit=1`);
  const record = records[0];
  if (!record) return NextResponse.json({ error: "record_not_found" }, { status: 404, headers });

  const createdAt = new Date().toISOString();
  await serviceRest("/memory_updates", {
    body: JSON.stringify({
      actor_user_id: token.userId,
      current_title: record.title,
      organisation_id: token.organisationId,
      origin: "user",
      original_source_url: record.source_url,
      source_record_id: recordId,
      update_source_url: sourceUrl,
      update_text: updateText,
      created_at: createdAt,
    }),
    headers: { Prefer: "return=representation" },
    method: "POST",
  });
  return NextResponse.json({ createdAt, ok: true }, { headers });
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

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
}
