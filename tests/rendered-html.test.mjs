import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";


async function render(pathname = "/", headers = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html", ...headers } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the Found public landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Found — Your company already knows<\/title>/i);
  assert.match(html, /Your company(?:<!-- -->)?\s*already knows/i);
  assert.match(html, /COMPANY MEMORY, WITH RECEIPTS/);
  assert.match(html, /HOW FOUND WORKS/);
  assert.match(html, /SECURITY BY ARCHITECTURE/);
  assert.match(html, /Log in and connect/);
  assert.doesNotMatch(html, /vinext-starter|Your site is taking shape|Codex is working/i);
});

test("renders the code prior-art route", async () => {
  const response = await render("/code-review");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Has this code/);
  assert.match(html, /PROPOSED PULL REQUEST/);
  assert.match(html, /CHECK FOR DUPLICATE IMPLEMENTATION/);
});

test("renders the public login activation surface", async () => {
  const response = await render("/login?return_to=%2Fworkspace");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /SECURE WORKSPACE ACCESS/);
  assert.match(html, /Continue with Google/);
  assert.match(html, /Supabase environment values/);
});

test("rejects cross-origin password login without contacting authentication", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-password-origin`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/auth/password", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://attacker.example" },
      body: new URLSearchParams({ email: "founder@example.com", password: "not-a-real-password", return_to: "//attacker.example" }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.pathname, "/login");
  assert.equal(location.searchParams.get("error"), "invalid_credentials");
  assert.equal(location.searchParams.get("return_to"), "/workspace");
  assert.equal(response.headers.get("set-cookie"), null);
});

test("rejects unauthenticated company-knowledge API calls", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-api`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/knowledge/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "What did we decide?", organisationId: "org-test" }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 401);
});

test("protects the integration control plane behind sign-in", async () => {
  const response = await render("/integrations");
  assert.equal(response.status, 307);
  const location = new URL(response.headers.get("location"));
  assert.equal(`${location.pathname}${location.search}`, "/signin-with-chatgpt?return_to=%2Fintegrations");
});

test("renders integration onboarding for an authenticated user", async () => {
  const response = await render("/integrations", { "oai-authenticated-user-email": "founder@example.com" });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /GUIDED SETUP/);
  assert.match(html, /Set up Found/);
  assert.match(html, /Install the browser companion/);
  assert.match(html, /Pair this browser/);
  assert.match(html, /Ask Found decision layer/);
  assert.match(html, /Hermes is the underlying engine/);
  assert.match(html, /HERMES_API_URL/);
  assert.match(html, /PRIVATE RELEASE/);
  assert.match(html, /Chrome Web Store publishing is still pending/);
  assert.match(html, /AFTER ONBOARDING/);
  assert.match(html, /Slack/);
  assert.match(html, /Notion/);
  assert.match(html, /Jira Cloud/);
  assert.match(html, /Google Workspace/);
  assert.match(html, /GitHub/);
});

test("renders the centralized workspace for an authenticated user", async () => {
  const response = await render("/workspace", { "oai-authenticated-user-email": "founder@example.com" });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /COMPANY INTELLIGENCE/);
  assert.match(html, /Tenant isolated/);
  assert.match(html, /Good (?:morning|afternoon|evening)/);
  assert.match(html, /TRENDING/);
  assert.match(html, /LATEST ACTIVITY/);
  assert.match(html, /DEPARTMENTS/);
  assert.match(html, /KNOWLEDGE GRAPH/);
  assert.match(html, /Ask Found/);
  assert.match(html, /Ask Found intelligence layer/);
  assert.match(html, /ASK FOUND · POWERED BY HERMES/);
  assert.doesNotMatch(html, /PRIMARY INTELLIGENCE · BATTLE CARD|OPEN ORIGINAL SOURCE|DEMO MEMORY/);
});

test("workspace accepts prefilled Ask Found prompts from decision and browser surfaces", async () => {
  const response = await render("/workspace?ask=What%20did%20we%20decide%20about%20security%20deposits%3F", { "oai-authenticated-user-email": "founder@example.com" });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /What did we decide about security deposits\?/);
  assert.match(html, /Ask Found about decisions, customers, campaigns, or code/);
  assert.doesNotMatch(html, /Ask Hermes/);
});

test("renders the source-preserving memory update review", async () => {
  const params = new URLSearchParams({
    record_id: "ENG-PLAT-014",
    title: "Developer portal and service maturity scorecards",
    correction: "The pilot moved into rollout after platform review.",
    source_url: "https://docs.google.com/document/d/test",
  });
  const response = await render(`/memory/correct?${params}`, { "oai-authenticated-user-email": "founder@example.com" });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /THE ORIGINAL EVIDENCE STAYS UNTOUCHED/);
  assert.match(html, /ADD TO FOUND MEMORY/);
  assert.match(html, /The pilot moved into rollout/);
});

test("rejects unsigned Slack event delivery", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-slack`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/slack/events", { method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type:"event_callback"}) }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 401);
  assert.equal(await response.text(), "");
});

test("accepts signed public Slack events silently and ignores weak matches", async () => {
  const previousSecret = process.env.SLACK_SIGNING_SECRET;
  const previousSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousSupabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = globalThis.fetch;
  process.env.SLACK_SIGNING_SECRET = "test-slack-signing-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  globalThis.fetch = async input => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://supabase.test/rest/v1/ingestion_events")) return new Response(null, { status: 204 });
    return originalFetch(input);
  };
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-signed-slack`);
  const { default: worker } = await import(workerUrl.href);
  const secret = process.env.SLACK_SIGNING_SECRET;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({
    type: "event_callback",
    team_id: "T_PUBLIC",
    event_id: "Ev_weak",
    event: { type: "message", channel_type: "channel", channel: "C_PUBLIC", user: "U_AUTHOR", ts: "1783839807.897629", text: "Thanks, got it" },
  });
  const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  const response = await worker.fetch(
    new Request("http://localhost/api/slack/events", { method: "POST", headers: { "content-type": "application/json", "x-slack-request-timestamp": timestamp, "x-slack-signature": signature }, body }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, SLACK_SIGNING_SECRET: secret },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  globalThis.fetch = originalFetch;
  if (previousSecret === undefined) delete process.env.SLACK_SIGNING_SECRET;
  else process.env.SLACK_SIGNING_SECRET = previousSecret;
  if (previousSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = previousSupabaseUrl;
  if (previousSupabaseKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousSupabaseKey;
  if (previousServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceKey;
});

test("keeps Slack ingestion public-only and silent while explicit browser shares can post", async () => {
  const [oauth, catalog, events, migration] = await Promise.all([
    readFile(new URL("../app/auth/slack/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations/catalog.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations/slack-events.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/0003_memory_updates.sql", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(oauth + catalog, /groups:history|groups:read/);
  assert.match(oauth, /chat:write/);
  assert.match(oauth, /app_mentions:read/);
  assert.match(oauth, /commands/);
  assert.match(catalog, /Slack web and desktop users get private Ask Found modals/);
  assert.match(events, /There are deliberately no call sites from Slack event ingestion/);
  assert.match(events, /workspace_id: input\.teamId/);
  assert.match(events, /channel_id: input\.channelId/);
  assert.match(events, /author_id: input\.userId/);
  assert.match(events, /message_timestamp: input\.timestamp/);
  assert.match(events, /on_conflict=organisation_id,origin,external_event_id/);
  assert.match(events, /error_code: "slack_event_ingestion_failed"/);
  assert.match(events, /status: "attention"/);
  assert.match(migration, /unique index memory_updates_external_event_idx/);
});

test("Slack message events are durably queued before acknowledgement and slow work is deferred", async () => {
  const [eventsRoute, interactionsRoute, commandsRoute, slackNative] = await Promise.all([
    readFile(new URL("../app/api/slack/events/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/slack/interactions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/slack/commands/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations/slack-events.ts", import.meta.url), "utf8"),
  ]);
  assert.match(eventsRoute, /import \{ after, NextRequest, NextResponse \} from "next\/server"/);
  assert.match(eventsRoute, /await enqueueSlackEvent\(payload\)/);
  assert.match(eventsRoute, /after\(\(\) => processQueuedSlackEvent\(payload\.event_id!/);
  assert.match(eventsRoute, /after\(\(\) => publishSlackHome/);
  assert.match(slackNative, /event\.type === "app_mention"/);
  assert.doesNotMatch(eventsRoute, /after\(\(\) => respondToSlackMention/);
  assert.doesNotMatch(eventsRoute, /await (?:publishSlackHome|respondToSlackMention|notifySlackAuthorAboutPriorWork|respondToSlackDirectMessage)/);

  assert.match(interactionsRoute, /import \{ after, NextRequest, NextResponse \} from "next\/server"/);
  assert.match(interactionsRoute, /buildSlackAskLoadingModal/);
  assert.match(interactionsRoute, /after\(\(\) => updateSlackAskModalWithAnswer\(\{ question, teamId:/);
  assert.match(interactionsRoute, /after\(\(\) => openSlackAskModal/);
  assert.match(interactionsRoute, /after\(\(\) => openSlackBattlecard/);
  assert.doesNotMatch(interactionsRoute, /await (?:answerSlackQuestion|openSlackAskModal|openSlackBattlecard|updateSlackAskModalWithAnswer)/);

  assert.match(commandsRoute, /import \{ after, NextRequest, NextResponse \} from "next\/server"/);
  assert.match(commandsRoute, /responseUrl/);
  assert.match(commandsRoute, /after\(\(\) => postSlackAskResponse/);
  assert.match(commandsRoute, /checking company memory privately/);
  assert.doesNotMatch(commandsRoute, /await (?:answerSlackQuestion|postSlackAskResponse)/);

  assert.match(slackNative, /action_id: "found_open_ask"/);
  assert.match(slackNative, /callback_id: "found_ask_modal"/);
  assert.match(slackNative, /function isExplicitSlackAskFoundQuestion/);
  assert.match(slackNative, /CASUAL\.test\(clean\) \|\| CATALOGUE\.test\(clean\)/);
  assert.doesNotMatch(slackNative, /question\.includes\("\\\?"\)/);
  assert.match(slackNative, /views\.update/);
  assert.doesNotMatch(slackNative, /hash: input\.hash|\.\.\.\(input\.hash/);
  assert.match(slackNative, /chat\.postEphemeral/);
  assert.match(slackNative, /buildSlackBattlecardLoadingModal/);
  assert.match(slackNative, /buildSlackNoMatchModal/);
  assert.match(slackNative, /view_id: viewId/);
});

test("keeps Google Workspace APIs read-only and records visible sync failures", async () => {
  const [oauth, sync] = await Promise.all([
    readFile(new URL("../lib/integrations/oauth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations/google-sync.ts", import.meta.url), "utf8"),
  ]);
  assert.match(oauth, /drive\.readonly/);
  assert.match(oauth, /documents\.readonly/);
  assert.match(oauth, /spreadsheets\.readonly/);
  assert.doesNotMatch(oauth, /spreadsheets(?!\.readonly)/);
  assert.match(sync, /sheets\.googleapis\.com/);
  assert.match(sync, /values:batchGet/);
  assert.doesNotMatch(sync, /(?:batchUpdate|values:append|:create)/);
  assert.match(sync, /const sourceUpdatedAt = file\.modifiedTime/);
  assert.match(sync, /source_updated_at: sourceUpdatedAt/);
  assert.match(sync, /const sourceUrl = file\.webViewLink/);
  assert.match(sync, /source_url: sourceUrl/);
  assert.match(sync, /status: "failed",[\s\S]*error_code: errorCode/);
  assert.match(sync, /google_workspace_sync_failed/);
  assert.match(sync, /status: "attention"/);
});
