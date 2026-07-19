import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { enqueueSlackEvent, publishSlackHome, respondToSlackMention, type SlackEnvelope } from "../../../../lib/integrations/slack-events";

type ChallengeEnvelope = SlackEnvelope & {
  challenge?: string;
  event?: { bot_id?: string; channel?: string; channel_type?: string; subtype?: string; text?: string; ts?: string; type?: string; user?: string };
  event_id?: string;
  team_id?: string;
  type?: string;
};

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!validSlackSignature(request, raw)) return new NextResponse(null, { status:401 });
  const payload = parseSlackEnvelope(raw) as ChallengeEnvelope | null;
  if (!payload) return NextResponse.json({ error:"invalid_request" }, { status:400 });
  if (payload.type === "url_verification" && payload.challenge) return NextResponse.json({ challenge:payload.challenge });
  const event = payload.event;
  if (!event || !payload.team_id || event.bot_id) {
    return NextResponse.json({ ok:true });
  }
  if (event.type === "app_home_opened" && event.user) {
    after(() => publishSlackHome({ teamId: payload.team_id!, userId: event.user! }).catch(() => undefined));
    return NextResponse.json({ ok:true });
  }
  if (event.type === "app_mention" && event.channel && event.user && event.text) {
    after(() => respondToSlackMention({ channelId: event.channel!, teamId: payload.team_id!, text: event.text!, threadTs: event.ts, userId: event.user! }).catch(() => undefined));
    return NextResponse.json({ ok:true });
  }
  if (event.type !== "message" || (event.channel_type && event.channel_type !== "channel") || !event.channel || !payload.event_id) {
    return NextResponse.json({ ok:true });
  }
  after(() => enqueueSlackEvent(payload).catch(() => undefined));
  return NextResponse.json({ ok:true });
}

function validSlackSignature(request: NextRequest, body: string): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");
  if (!secret || !timestamp || !signature || !/^\d{10}$/.test(timestamp)) return false;
  if (Math.abs(Math.floor(Date.now()/1000) - Number(timestamp)) > 300) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function parseSlackEnvelope(body: string): ChallengeEnvelope | null {
  try {
    const payload = JSON.parse(body) as unknown;
    return payload !== null && typeof payload === "object" && !Array.isArray(payload)
      ? payload as ChallengeEnvelope
      : null;
  } catch {
    return null;
  }
}
