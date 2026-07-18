import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = path => readFile(new URL(path, root), "utf8");

test("Slack OAuth permits silent ingestion plus explicit user-initiated sharing", async () => {
  const [route, catalog] = await Promise.all([
    source("app/auth/slack/route.ts"),
    source("lib/integrations/catalog.ts"),
  ]);
  for (const text of [route, catalog]) {
    assert.doesNotMatch(text, /groups:(?:history|read)/);
  }
  assert.match(route, /"channels:history"/);
  assert.match(route, /"channels:read"/);
  assert.match(route, /"users:read"/);
  assert.match(route, /"users:read.email"/);
  assert.match(route, /"im:write"/);
  assert.match(route, /"chat:write"/);
});

test("continuous ingestion is durable, silent, and authenticated", async () => {
  const route = await source("app/api/slack/events/route.ts");
  const worker = await source("app/api/internal/ingestion/run/route.ts");
  const migration = await source("supabase/migrations/0004_continuous_ingestion.sql");
  const google = await source("lib/integrations/google-sync.ts");
  const slack = await source("lib/integrations/slack-events.ts");
  assert.match(route, /enqueueSlackEvent/);
  assert.doesNotMatch(route, /chat\.postMessage/);
  assert.match(worker, /INGESTION_CRON_SECRET/);
  assert.match(worker, /timingSafeEqual/);
  assert.match(migration, /unique \(provider, external_event_id\)/);
  assert.match(google, /changes\/startPageToken/);
  assert.match(google, /newStartPageToken/);
  assert.match(google, /GOOGLE_SYNC_TIMEOUT_MS = 20_000/);
  assert.match(google, /const controller = new AbortController\(\)/);
  assert.match(google, /parentSignal\?\.addEventListener\("abort", abort/);
  assert.match(slack, /integration_sync_runs\?on_conflict=id/);
  assert.match(slack, /status: "succeeded"/);
  assert.match(slack, /status: "failed"[\s\S]*error_code: "slack_backfill_failed"/);
  assert.doesNotMatch(slack, /status: "running"/);
  assert.doesNotMatch(slack, /status=in\.\(connected,pending,attention\)/);
});

test("browser battle cards use authenticated tenant memory", async () => {
  const [route, session, token, extension, background] = await Promise.all([
    source("app/api/browser/match/route.ts"),
    source("app/api/browser/session/route.ts"),
    source("lib/auth/browser-token.ts"),
    source("extension/content.js"),
    source("extension/background.js"),
  ]);
  assert.match(session, /getFoundUser/);
  assert.match(session, /getFoundWorkspace/);
  assert.match(token, /createHmac/);
  assert.match(token, /timingSafeEqual/);
  assert.match(route, /verifyBrowserToken/);
  assert.match(route, /organisation_id=eq/);
  assert.match(route, /chrome-extension/);
  assert.match(route, /authorization, content-type/);
  assert.doesNotMatch(route, /integration_secrets/);
  assert.match(extension, /type: "found:match-page"/);
  assert.doesNotMatch(extension, /Bearer \$\{token\}|\/api\/browser\/match/);
  assert.match(background, /Bearer \$\{token\}/);
  assert.match(background, /\/api\/browser\/match/);
  assert.match(extension, /google.*search/);
  assert.doesNotMatch(extension, /credentials:\s*"include"/);
});

test("browser Ask Hermes stays tenant-scoped and closed-world", async () => {
  const [askRoute, content, background] = await Promise.all([
    source("app/api/browser/ask/route.ts"),
    source("extension/content.js"),
    source("extension/background.js"),
  ]);
  assert.match(askRoute, /verifyBrowserToken/);
  assert.match(askRoute, /\/memberships\?select=id&organisation_id=eq/);
  assert.match(askRoute, /\/knowledge_records\?select=/);
  assert.match(askRoute, /organisation_id=eq\.\$\{encodeURIComponent\(token\.organisationId\)\}/);
  assert.match(askRoute, /\/memory_updates\?select=/);
  assert.match(askRoute, /queryHermes/);
  assert.match(askRoute, /I couldn’t find enough evidence in company knowledge to answer this/);
  assert.doesNotMatch(askRoute, /getFoundUser|integration_secrets|PATCH|PUT|DELETE/);
  assert.match(content, /type: "found:ask-hermes"/);
  assert.doesNotMatch(content, /\/api\/browser\/ask|authorization: `Bearer/);
  assert.match(background, /\/api\/browser\/ask/);
  assert.match(background, /hermes_unavailable/);
});

test("browser matching uses Hermes as the final non-exact battlecard decision layer", async () => {
  const route = await source("app/api/browser/match/route.ts");
  assert.match(route, /reviewBrowserMatchWithHermes/);
  assert.match(route, /queryHermes/);
  assert.match(route, /show=true only when the open page is the same concrete work/);
  assert.match(route, /show=false for merely same industry, same vendor, broad AI\/research overlap/);
  assert.match(route, /If unsure, show=false/);
  assert.match(route, /parsed\.confidence/);
  assert.match(route, /hermes_unavailable/);
  assert.match(route, /exactOpenCompanySource/);
  assert.match(route, /return NextResponse\.json\(\{ match: null, reason: hermesVerdict\.reason \}/);
});

test("Google ingestion isolates unreadable files and always records a terminal run", async () => {
  const google = await source("lib/integrations/google-sync.ts");
  assert.match(google, /Promise\.allSettled\([\s\S]*toKnowledgeRecord/);
  assert.match(google, /status: unreadableFiles \? "partial" : "succeeded"/);
  assert.match(google, /error_code: unreadableFiles \? "google_files_unreadable" : null/);
  assert.match(google, /status: "failed",[\s\S]*error_code: errorCode/);
  assert.match(google, /integration_sync_runs\?on_conflict=id/);
  assert.match(google, /resolution=merge-duplicates,return=minimal/);
  assert.doesNotMatch(google, /error_code:\s*(?:error\b|reason\b|result\.reason)/);
});

test("Google ingestion skips uncredentialed seeds and preserves incremental cursors", async () => {
  const google = await source("lib/integrations/google-sync.ts");
  assert.match(google, /integration_secrets!inner\(connection_id\)/);
  assert.match(google, /const nextCursor = await getStartPageToken\(accessToken, signal\);[\s\S]*const files = await listFiles\(accessToken, signal\)/);
  assert.match(google, /let nextCursor = cursor/);
  assert.match(google, /if \(payload\.newStartPageToken\) nextCursor = payload\.newStartPageToken/);
  assert.match(google, /cursor: delta\.nextCursor/);
});

test("Google ingestion is not limited to bracket-prefixed demo document names", async () => {
  const google = await source("lib/integrations/google-sync.ts");
  assert.match(google, /function isReadableWorkspaceFile/);
  assert.doesNotMatch(google, /name contains '\['/);
  assert.match(google, /function inferDepartment/);
  assert.match(google, /call center/);
  assert.match(google, /human in the loop/);
});

test("Slack event ingestion enforces signatures, a five-minute timestamp window, and message permalinks", async () => {
  const [route, ingestion] = await Promise.all([
    source("app/api/slack/events/route.ts"),
    source("lib/integrations/slack-events.ts"),
  ]);
  assert.match(route, /x-slack-request-timestamp/);
  assert.match(route, /x-slack-signature/);
  assert.match(route, /\^\\d\{10\}\$/);
  assert.match(route, /> 300/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /invalid_request/);
  assert.match(ingestion, /\/p\$\{encodeURIComponent\(messageId\)\}/);
});

test("Slack event ingestion stores broader work intent beyond hardcoded demo clusters", async () => {
  const slack = await source("lib/integrations/slack-events.ts");
  assert.match(slack, /function inferSlackDepartment/);
  assert.match(slack, /function inferSlackTitle/);
  assert.match(slack, /inferSlackMemory\(message\.text\)/);
  assert.match(slack, /voice agent/);
  assert.match(slack, /call center/);
  assert.match(slack, /const sourceRecordId = input\.match\.sourceRecordId \?\? externalId/);
});

test("Slack desktop users get a private native battlecard surface, not public bot noise", async () => {
  const [route, slack] = await Promise.all([
    source("app/api/slack/interactions/route.ts"),
    source("lib/integrations/slack-events.ts"),
  ]);
  assert.match(route, /x-slack-request-timestamp/);
  assert.match(route, /x-slack-signature/);
  assert.match(route, /message_action/);
  assert.match(route, /openSlackBattlecard/);
  assert.match(slack, /views\.open/);
  assert.match(slack, /type: "modal"/);
  assert.match(slack, /Private to you/);
  assert.doesNotMatch(route, /chat\.postMessage/);
  assert.match(slack, /shareBrowserPageToSlack/);
  assert.match(slack, /conversations\.open/);
  assert.match(slack, /chat\.postMessage/);
  assert.match(slack, /There are deliberately no call sites from Slack event ingestion/);
});

test("browser Slack sharing is tenant-authenticated and recipient constrained", async () => {
  const [targets, share, slack, background] = await Promise.all([
    source("app/api/browser/slack-targets/route.ts"),
    source("app/api/browser/slack-share/route.ts"),
    source("lib/integrations/slack-events.ts"),
    source("extension/background.js"),
  ]);
  for (const route of [targets, share]) {
    assert.match(route, /verifyBrowserToken/);
    assert.match(route, /organisation_id=eq/);
    assert.match(route, /chrome-extension/);
    assert.match(route, /workspace_access_revoked/);
    assert.doesNotMatch(route, /integration_secrets/);
  }
  assert.match(targets, /listSlackBrowserShareTargets/);
  assert.match(share, /normaliseRecipients/);
  assert.match(share, /shareBrowserPageToSlack/);
  assert.match(slack, /Promise\.allSettled/);
  assert.match(slack, /validUsers/);
  assert.match(slack, /validChannels/);
  assert.match(background, /slack_reconnect_required/);
});

test("exact Google source lookups are not limited to the recent-memory window", async () => {
  const route = await source("app/api/browser/match/route.ts");
  assert.match(route, /loadExactSourceRows/);
  assert.match(route, /external_id=eq/);
  assert.match(route, /source_url=ilike/);
  assert.match(route, /\[\.\.\.exactRows, \.\.\.rows\]/);
});

test("provider credentials are encrypted server-side before service-role persistence", async () => {
  const [callback, slackCallback, secrets, store] = await Promise.all([
    source("app/auth/integrations/[provider]/callback/route.ts"),
    source("app/auth/slack/callback/route.ts"),
    source("lib/integrations/secrets.ts"),
    source("lib/integrations/store.ts"),
  ]);
  assert.match(callback, /encryptIntegrationSecret/);
  assert.match(slackCallback, /encryptIntegrationSecret/);
  assert.match(secrets, /AES-GCM/);
  assert.match(secrets, /key\.byteLength !== 32/);
  assert.match(store, /integration_secrets/);
  assert.doesNotMatch(store, /accessToken|refreshToken/);
});

test("live authentication callback does not seed fictional demo knowledge", async () => {
  const callback = await source("app/auth/callback/route.ts");
  assert.doesNotMatch(callback, /seedDemoWorkspace|DEMO_ACCESS_EMAIL/);
});

test("password login uses the server-side Supabase grant and HttpOnly session cookies", async () => {
  const [route, session] = await Promise.all([
    source("app/auth/password/route.ts"),
    source("lib/auth/session.ts"),
  ]);
  assert.match(session, /\/auth\/v1\/token\?grant_type=password/);
  assert.match(route, /signInWithPassword\(email, password\)/);
  assert.match(route, /hasSamePublicOrigin\(request\)/);
  assert.match(route, /safeReturnPath[\s\S]*"\/workspace"/);
  assert.doesNotMatch(route, /access_token|refresh_token/);
  assert.match(session, /ACCESS_COOKIE[\s\S]*httpOnly: true/);
  assert.match(session, /REFRESH_COOKIE[\s\S]*httpOnly: true/);
  assert.match(session, /secure/);
});

test("password failures are generic and secrets are not hardcoded", async () => {
  const [route, login] = await Promise.all([
    source("app/auth/password/route.ts"),
    source("app/login/page.tsx"),
  ]);
  assert.match(route, /invalid_credentials/);
  assert.doesNotMatch(route + login, /anuj\.modi@nurix\.ai/i);
  assert.doesNotMatch(login, /user not found|wrong password|password is invalid/i);
  assert.match(login, /email or password is incorrect/i);
  assert.match(login, /action="\/auth\/email"/);
  assert.match(login, /action="\/auth\/password"/);
  assert.match(login, /NEXT_PUBLIC_DEMO_ACCESS_VISIBLE === "true"/);
});

test("magic-link recovery uses PKCE and never exposes session tokens to browser code", async () => {
  const [emailRoute, callback, clientFiles] = await Promise.all([
    source("app/auth/email/route.ts"),
    source("app/auth/callback/route.ts"),
    Promise.all([source("app/login/page.tsx"), source("app/auth.ts")]).then(files => files.join("\n")),
  ]);
  assert.match(emailRoute, /code_challenge/);
  assert.match(emailRoute, /code_challenge_method: "s256"/);
  assert.match(emailRoute, /PKCE_COOKIE/);
  assert.match(emailRoute, /hasSamePublicOrigin\(request\)/);
  assert.match(callback, /exchangePkceCode/);
  assert.doesNotMatch(clientFiles, /access_token|refresh_token/);
});

test("Google PKCE callback follows Supabase's code-and-verifier contract", async () => {
  const [start, callback] = await Promise.all([source("app/auth/google/route.ts"), source("app/auth/callback/route.ts")]);
  assert.doesNotMatch(start, /url\.searchParams\.set\("state"/);
  assert.match(callback, /!code \|\| !verifier/);
  assert.match(callback, /exchangePkceCode\(code, verifier\)/);
});

test("login preserves return_to when starting Google identity sign-in", async () => {
  const login = await source("app/login/page.tsx");
  assert.match(login, /\/auth\/google\?return_to=\$\{encodeURIComponent\(returnTo\)\}/);
  assert.match(login, /Continue with Google/);
});

test("onboarding keeps source consent explicit and browser state honest", async () => {
  const onboarding = await source("app/integrations/integration-setup.tsx");
  assert.match(onboarding, /REVIEW GOOGLE WORKSPACE CONSENT/);
  assert.match(onboarding, /REVIEW SLACK CONSENT/);
  assert.match(onboarding, /It does not approve Google Workspace or Slack access/);
  assert.match(onboarding, /this page never pretends to detect it/);
  assert.match(onboarding, /Chrome Web Store publishing is still pending/);
  assert.match(onboarding, /\/found-extension-v0\.5\.8\.zip/);
  assert.match(onboarding, /remove older Found versions/i);
});

test("Google connector requests only read-only content scopes", async () => {
  const oauth = await source("lib/integrations/oauth.ts");
  assert.match(oauth, /drive\.readonly/);
  assert.match(oauth, /documents\.readonly/);
  assert.doesNotMatch(oauth, /auth\/drive(?:["'])/);
  assert.doesNotMatch(oauth, /auth\/documents(?:["'])/);
});

test("tenant-facing queries require a user token and organisation filter", async () => {
  const workspace = await source("lib/auth/workspace.ts");
  assert.match(workspace, /authorization: `Bearer \$\{accessToken\}`/);
  assert.match(workspace, /organisation_id: `eq\.\$\{organisationId\}`/);
  assert.match(workspace, /getFoundWorkspace\(requestedOrganisationId/);
});

test("team input remains separate from verified company knowledge", async () => {
  const [intelligence, decisionPage] = await Promise.all([
    source("lib/workspace/intelligence.ts"),
    source("app/workspace/decision/[recordId]/page.tsx"),
  ]);
  assert.match(intelligence, /verifiedText: latest\.body/);
  assert.match(intelligence, /latestInput: latestUpdate\?\.updateText \?\? null/);
  assert.match(decisionPage, /VERIFIED DECISION/);
  assert.match(decisionPage, /LATEST TEAM INPUT/);
  assert.match(decisionPage, /pending verification|until it is verified/i);
});

test("decision detail pages render exact browser and Slack records instead of falling back to overview", async () => {
  const decisionPage = await source("app/workspace/decision/[recordId]/page.tsx");
  assert.match(decisionPage, /decodeRecordId/);
  assert.match(decisionPage, /getWorkspaceKnowledgeRecord\(workspace\.organisationId,recordId\)/);
  assert.match(decisionPage, /exactRecordDecision\(exactRecord,updates\)/);
  assert.match(decisionPage, /sourceRecordId===record\.externalId/);
});

test("decision detail pages summarize captured articles instead of dumping full page text", async () => {
  const decisionPage = await source("app/workspace/decision/[recordId]/page.tsx");
  assert.match(decisionPage, /memorySummary\(decision\.verifiedText\)/);
  assert.match(decisionPage, /memorySummary\(event\.body\)/);
  assert.match(decisionPage, /Captured page context:/);
  assert.match(decisionPage, /Captured page:/);
  assert.match(decisionPage, /compactText\(context,220\)/);
});

test("connector readiness requires the complete auth and webhook boundary", async () => {
  const readiness = await source("lib/integrations/readiness.ts");
  for (const name of [
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "INTEGRATION_ENCRYPTION_KEY",
    "SLACK_SIGNING_SECRET",
  ]) assert.match(readiness, new RegExp(`"${name}"`));
});
