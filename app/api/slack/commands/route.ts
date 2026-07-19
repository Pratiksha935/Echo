import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { answerSlackQuestion } from "../../../../lib/integrations/slack-events";

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!validSlackSignature(request, raw)) return new NextResponse(null, { status: 401 });
  const form = new URLSearchParams(raw);
  const text = (form.get("text") ?? "").trim();
  const teamId = form.get("team_id") ?? undefined;
  const question = text.replace(/^ask\b[:\s-]*/i, "").trim();
  if (question.length < 4) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Ask Found privately with `/found ask <question>`. Example: `/found ask what did we decide about security deposits?`",
    });
  }

  try {
    const result = await answerSlackQuestion({ question, teamId });
    return NextResponse.json({
      response_type: "ephemeral",
      text: formatAnswer(result.answer, result.sources),
      unfurl_links: false,
      unfurl_media: false,
    });
  } catch {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Found could not answer from company memory right now.",
    });
  }
}

function formatAnswer(answer: string, sources: Array<{ title: string; url: string }>): string {
  const sourceText = sources.length
    ? `\n\n*Sources*\n${sources.map(source => `• <${source.url}|${escapeSlackText(source.title).slice(0, 90)}>`).join("\n")}`
    : "";
  return `*Ask Found*\n${escapeSlackText(answer).slice(0, 2800)}${sourceText}`;
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

function escapeSlackText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
