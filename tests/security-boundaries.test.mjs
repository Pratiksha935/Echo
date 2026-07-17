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
  assert.match(route, /enqueueSlackEvent/);
  assert.doesNotMatch(route, /chat\.postMessage/);
  assert.match(worker, /INGESTION_CRON_SECRET/);
  assert.match(worker, /timingSafeEqual/);
  assert.match(migration, /unique \(provider, external_event_id\)/);
  assert.match(google, /changes\/startPageToken/);
  assert.match(google, /newStartPageToken/);
});

test("Google ingestion isolates unreadable files and always records a terminal run", async () => {
  const google = await source("lib/integrations/google-sync.ts");
  assert.match(google, /Promise\.allSettled\([\s\S]*toKnowledgeRecord/);
  assert.match(google, /status: unreadableFiles \? "partial" : "succeeded"/);
  assert.match(google, /error_code: unreadableFiles \? "google_files_unreadable" : null/);
  assert.match(google, /status: "failed", error_code: "google_workspace_sync_failed"/);
  assert.doesNotMatch(google, /error_code:\s*(?:error|reason|result\.reason)/);
});

test("Google ingestion skips uncredentialed seeds and preserves incremental cursors", async () => {
  const google = await source("lib/integrations/google-sync.ts");
  assert.match(google, /integration_secrets!inner\(connection_id\)/);
  assert.match(google, /const nextCursor = await getStartPageToken\(accessToken\);[\s\S]*const files = await listFiles\(accessToken\)/);
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
