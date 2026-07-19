import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { enqueueSlackEvent, processQueuedSlackEvent, publishSlackHome, type SlackEnvelope } from "../../../../lib/integrations/slack-events";

type ChallengeEnvelope = SlackEnvelope & {
  challenge?: string;
  event?: { app_id?: string; bot_id?: string; bot_profile?: unknown; channel?: string; channel_type?: string; subtype?: string; text?: string; thread_ts?: string; ts?: string; type?: string; user?: string };
  event_id?: string;
  is_ext_shared_channel?: boolean;
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
  if (!event || !payload.team_id || event.bot_id || event.bot_profile || event.app_id || payload.is_ext_shared_channel) {
    return NextResponse.json({ ok:true });
  }
  if (event.type === "app_home_opened" && event.user) {
    after(() => publishSlackHome({ teamId: payload.team_id!, userId: event.user! }).catch(() => undefined));
    return NextResponse.json({ ok:true });
  }
  if (event.type === "app_mention" && event.channel && event.user && event.text && payload.event_id) {
    await enqueueSlackEvent(payload);
    after(() => processQueuedSlackEvent(payload.event_id!).catch(() => undefined));
    return NextResponse.json({ ok:true });
  }
  if (event.type !== "message" || !event.channel || !payload.event_id || (event.channel_type && !["channel", "im"].includes(event.channel_type))) {
    return NextResponse.json({ ok:true });
  }
  await enqueueSlackEvent(payload);
  after(() => processQueuedSlackEvent(payload.event_id!).catch(() => undefined));
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
