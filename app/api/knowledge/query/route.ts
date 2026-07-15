import { NextRequest, NextResponse } from "next/server";
import { getFoundUser } from "../../../auth";
import { HermesUnavailableError, queryHermes } from "../../../../lib/hermes/client";
import { getFoundWorkspace } from "../../../../lib/auth/workspace";

export async function POST(request: NextRequest) {
  const user = await getFoundUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as { message?: unknown; organisationId?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const requestedOrganisationId = typeof body?.organisationId === "string" ? body.organisationId : undefined;
  if (!message || message.length > 4000) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const workspace = await getFoundWorkspace(requestedOrganisationId);
  if (!workspace) return NextResponse.json({ error: "workspace_forbidden" }, { status: 403 });

  try {
    return NextResponse.json({ answer: await queryHermes(message, workspace.organisationId) });
  } catch (error) {
    if (error instanceof HermesUnavailableError) return NextResponse.json({ error: "temporarily_unavailable" }, { status: 503 });
    throw error;
  }
}
