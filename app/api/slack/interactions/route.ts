import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { openSlackBattlecard } from "../../../../lib/integrations/slack-events";

type SlackInteractionPayload = {
  message?: { text?: string };
  response_url?: string;
  team?: { id?: string };
  trigger_id?: string;
  type?: string;
  user?: { id?: string };
};

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!validSlackSignature(request, raw)) return new NextResponse(null, { status: 401 });
  const payload = parseInteraction(raw);
  if (!payload) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  if (!["message_action", "shortcut"].includes(payload.type ?? "")) {
    return NextResponse.json({ ok: true });
  }

  try {
    await openSlackBattlecard({
      messageText: payload.message?.text,
      responseUrl: payload.response_url,
      teamId: payload.team?.id,
      triggerId: payload.trigger_id,
      userId: payload.user?.id,
    });
  } catch {
    // Slack is a product surface. Fail closed and do not expose internals.
  }

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
