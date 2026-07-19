import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { syncAllGoogleConnections } from "../../../../../lib/integrations/google-sync";
import { drainKnowledgeNormalizationQueue } from "../../../../../lib/integrations/knowledge-normalization";
import { drainSlackQueue, syncAllSlackConnections } from "../../../../../lib/integrations/slack-events";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  if (!isAuthorised(request.headers.get("authorization"))) return new NextResponse(null, { status: 401 });
  // Provider ingestion and a small normalization batch run concurrently to
  // stay inside Netlify's execution window. Durable queues retain remaining
  // work for the next ten-minute invocation.
  const [googleResult, slackBackfillResult, slackResult, normalizationResult] = await Promise.allSettled([
    syncAllGoogleConnections(1),
    syncAllSlackConnections(1),
    drainSlackQueue(25),
    drainKnowledgeNormalizationQueue(3),
  ]);
  const google = googleResult.status === "fulfilled" ? googleResult.value : { attempted: 0, succeeded: 0, failed: true };
  const slackBackfill = slackBackfillResult.status === "fulfilled" ? slackBackfillResult.value : { attempted: 0, succeeded: 0, failed: true };
  const slack = slackResult.status === "fulfilled" ? slackResult.value : { attempted: 0, succeeded: 0, failed: true };
  const normalization = normalizationResult.status === "fulfilled" ? normalizationResult.value : { attempted: 0, succeeded: 0, failed: true, superseded: 0 };
  return NextResponse.json({
    ok: googleResult.status === "fulfilled" || slackBackfillResult.status === "fulfilled" || slackResult.status === "fulfilled" || normalizationResult.status === "fulfilled",
    google,
    normalization,
    slack,
    slackBackfill,
  });
}

function isAuthorised(header: string | null): boolean {
  const secret = process.env.INGESTION_CRON_SECRET;
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
