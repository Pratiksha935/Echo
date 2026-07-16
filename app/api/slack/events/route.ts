import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { appendSlackMemory, matchSlackMemory, recordSlackSyncFailure } from "../../../../lib/integrations/slack-events";

type SlackEnvelope = {
  challenge?: string;
  event?: { bot_id?: string; channel?: string; channel_type?: string; subtype?: string; text?: string; ts?: string; type?: string; user?: string };
  event_id?: string;
  team_id?: string;
  type?: string;
};

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!validSlackSignature(request, raw)) return new NextResponse(null, { status:401 });
  let payload: SlackEnvelope;
  try {
    payload = JSON.parse(raw) as SlackEnvelope;
  } catch {
    return NextResponse.json({ ok:true });
  }
  if (payload.type === "url_verification" && payload.challenge) return NextResponse.json({ challenge:payload.challenge });
  const event = payload.event;
  if (!event || event.type !== "message" || event.channel_type !== "channel" || event.bot_id || event.subtype || !event.text || !event.channel || !event.ts || !event.user || !payload.team_id || !payload.event_id) {
    return NextResponse.json({ ok:true });
  }
  const match = matchSlackMemory(event.text);
  if (!match) return NextResponse.json({ ok:true });
  try {
    await appendSlackMemory({ channelId:event.channel,eventId:payload.event_id,match,teamId:payload.team_id,text:event.text,timestamp:event.ts,userId:event.user });
  } catch {
    // Slack is an ingestion transport only. Sync failures are surfaced in Found,
    // never through a Slack response or message.
    await recordSlackSyncFailure(payload.team_id);
  }
  return NextResponse.json({ ok:true });
}

function validSlackSignature(request: NextRequest, body: string): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");
  if (!secret || !timestamp || !signature) return false;
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now()/1000 - Number(timestamp)) > 300) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
