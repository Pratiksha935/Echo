import { NextRequest, NextResponse } from "next/server";
import { getFoundUser } from "../../../auth";
import { getDemoMemoryCorrections, setDemoMemoryCorrections } from "../../../../lib/auth/session";
import { createMemoryUpdate, getFoundWorkspace } from "../../../../lib/auth/workspace";
import { HermesUnavailableError, queryHermes } from "../../../../lib/hermes/client";

export async function POST(request: NextRequest) {
  const user = await getFoundUser();
  if (!user) return NextResponse.redirect(new URL("/login?return_to=%2Fworkspace", request.url), 303);
  const form = await request.formData();
  const recordId = field(form, "recordId", 120);
  const title = field(form, "title", 180);
  const updateText = field(form, "updateText", 800);
  const sourceUrl = safeSourceUrl(field(form, "sourceUrl", 400));
  if (!recordId || !title || updateText.length < 12 || !sourceUrl) {
    return NextResponse.redirect(new URL("/workspace?memory_error=invalid", request.url), 303);
  }

  if (user.id.startsWith("demo:")) {
    const previous = await getDemoMemoryCorrections();
    const next = [{ correction: updateText, createdAt: new Date().toISOString(), recordId, sourceUrl, title }, ...previous.filter(item => item.recordId !== recordId)].slice(0, 3);
    const response = NextResponse.redirect(new URL("/workspace?memory_updated=1", request.url), 303);
    setDemoMemoryCorrections(response, next);
    return response;
  }

  const workspace = await getFoundWorkspace();
  if (!workspace) return NextResponse.redirect(new URL("/workspace?memory_error=workspace", request.url), 303);
  let hermesReview: string | null = null;
  try {
    hermesReview = await queryHermes(`Review this new append-only memory update against company knowledge. Do not overwrite the original source.\nRecord: ${title}\nUpdate: ${updateText}\nReturn only a concise evidence-grounded interpretation.`, workspace.organisationId);
  } catch (error) {
    if (!(error instanceof HermesUnavailableError)) throw error;
  }
  await createMemoryUpdate({ currentTitle: title, hermesReview, organisationId: workspace.organisationId, sourceRecordId: recordId, sourceUrl, updateText });
  return NextResponse.redirect(new URL("/workspace?memory_updated=1", request.url), 303);
}

function field(form: FormData, key: string, max: number): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
