import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { syncAllGoogleConnections } from "../../../../../lib/integrations/google-sync";
import { drainSlackQueue } from "../../../../../lib/integrations/slack-events";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  if (!isAuthorised(request.headers.get("authorization"))) return new NextResponse(null, { status: 401 });
  const [googleResult, slackResult] = await Promise.allSettled([syncAllGoogleConnections(5), drainSlackQueue(25)]);
  const google = googleResult.status === "fulfilled" ? googleResult.value : { attempted: 0, succeeded: 0, failed: true };
  const slack = slackResult.status === "fulfilled" ? slackResult.value : { attempted: 0, succeeded: 0, failed: true };
  return NextResponse.json({ ok: googleResult.status === "fulfilled" || slackResult.status === "fulfilled", google, slack });
}

function isAuthorised(header: string | null): boolean {
  const secret = process.env.INGESTION_CRON_SECRET;
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
