import { NextRequest } from "next/server";
import { verifyBrowserToken } from "../../../../lib/auth/browser-token";
import { matchBrowserKnowledge } from "../../../../lib/browser/matcher";
import { browserMatchOptions, createBrowserMatchHandler } from "../../../../lib/browser/match-route";
import { serviceRest } from "../../../../lib/integrations/service-rest";

const handleBrowserMatch = createBrowserMatchHandler({
  matchKnowledge: matchBrowserKnowledge,
  query: serviceRest,
  verifyToken: verifyBrowserToken,
});

export async function OPTIONS(request: NextRequest) {
  return browserMatchOptions(request);
}

export async function POST(request: NextRequest) {
  return handleBrowserMatch(request);
}
