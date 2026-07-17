import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = path => readFile(new URL(path, root), "utf8");

test("Slack OAuth remains ingestion-only", async () => {
  const [route, catalog] = await Promise.all([
    source("app/auth/slack/route.ts"),
    source("lib/integrations/catalog.ts"),
  ]);
  for (const text of [route, catalog]) {
    assert.doesNotMatch(text, /chat:write/);
    assert.doesNotMatch(text, /groups:(?:history|read)/);
  }
  assert.match(route, /"channels:history"/);
  assert.match(route, /"channels:read"/);
  assert.match(route, /"users:read"/);
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
  const [route, session, token, extension] = await Promise.all([
    source("app/api/browser/match/route.ts"),
    source("app/api/browser/session/route.ts"),
    source("lib/auth/browser-token.ts"),
    source("extension/content.js"),
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
  assert.match(extension, /\/api\/browser\/session/);
  assert.match(extension, /Bearer \$\{token\}/);
  assert.match(extension, /\/api\/browser\/match/);
  assert.match(extension, /google.*search/);
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
  assert.match(route, /safeReturnPath[\s\S]*"\/integrations"/);
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
  assert.match(emailRoute, /sameOrigin\(request\)/);
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
  assert.match(onboarding, /does not replace or silently approve Google Workspace or Slack consent/);
  assert.match(onboarding, /this page does not pretend to detect it/);
  assert.match(onboarding, /Production store distribution pending/);
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

test("connector readiness requires the complete auth and webhook boundary", async () => {
  const readiness = await source("lib/integrations/readiness.ts");
  for (const name of [
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "INTEGRATION_ENCRYPTION_KEY",
    "SLACK_SIGNING_SECRET",
  ]) assert.match(readiness, new RegExp(`"${name}"`));
});
