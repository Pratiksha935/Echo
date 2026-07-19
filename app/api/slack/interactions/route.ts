import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { buildSlackAskLoadingModal, openSlackAskModal, openSlackBattlecard, updateSlackAskModalWithAnswer } from "../../../../lib/integrations/slack-events";

type SlackInteractionPayload = {
  actions?: Array<{ action_id?: string }>;
  callback_id?: string;
  message?: { text?: string };
  response_url?: string;
  team?: { id?: string };
  trigger_id?: string;
  type?: string;
  user?: { id?: string };
  view?: {
    callback_id?: string;
    hash?: string;
    id?: string;
    private_metadata?: string;
    state?: { values?: Record<string, Record<string, { value?: string }>> };
  };
};

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!validSlackSignature(request, raw)) return new NextResponse(null, { status: 401 });
  const payload = parseInteraction(raw);
  if (!payload) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const submittedView = payload.type === "view_submission" && ["found_slack_battlecard", "found_ask_modal"].includes(payload.view?.callback_id ?? "")
    ? payload.view
    : null;
  if (submittedView) {
    const question = submittedView.state?.values?.found_ask?.question?.value?.trim() ?? "";
    if (question.length < 4) {
      return NextResponse.json({ response_action: "errors", errors: { found_ask: "Ask a question with at least four characters." } });
    }
    if (payload.team?.id && submittedView.id) {
      after(() => updateSlackAskModalWithAnswer({ question, teamId: payload.team!.id!, viewId: submittedView.id! }).catch(() => undefined));
    }
    return NextResponse.json({
      response_action: "update",
      view: buildSlackAskLoadingModal(question),
    });
  }

  if (payload.type === "block_actions" && payload.actions?.some(action => action.action_id === "found_open_ask")) {
    after(() => openSlackAskModal({ teamId: payload.team?.id, triggerId: payload.trigger_id }).catch(() => undefined));
    return NextResponse.json({ ok: true });
  }

  if (payload.type === "shortcut" && payload.callback_id === "found_ask") {
    after(() => openSlackAskModal({ teamId: payload.team?.id, triggerId: payload.trigger_id }).catch(() => undefined));
    return NextResponse.json({ ok: true });
  }

  if (!["message_action", "shortcut"].includes(payload.type ?? "")) {
    return NextResponse.json({ ok: true });
  }

  after(() => openSlackBattlecard({
      messageText: payload.message?.text,
      responseUrl: payload.response_url,
      teamId: payload.team?.id,
      triggerId: payload.trigger_id,
      userId: payload.user?.id,
    }).catch(() => undefined));

  return NextResponse.json({ ok: true });
}

function validSlackSignature(request: NextRequest, body: string): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");
  if (!secret || !timestamp || !signature || !/^\d{10}$/.test(timestamp)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function parseInteraction(body: string): SlackInteractionPayload | null {
  try {
    const form = new URLSearchParams(body);
    const payloadText = form.get("payload");
    if (!payloadText) return null;
    const payload = JSON.parse(payloadText) as unknown;
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as SlackInteractionPayload : null;
  } catch {
    return null;
  }
}
