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
  assert.match(html, /Supabase environment values/);
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
  assert.match(html, /WORKSPACE ONBOARDING \/ 3 STEPS/);
  assert.match(html, /Approve the work/);
  assert.match(html, /MORE INTEGRATIONS/);
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
  assert.match(html, /GENERAL INTELLIGENCE OF YOUR COMPANY/);
  assert.match(html, /PRIVATE WORKSPACE/);
  assert.match(html, /Connect a source to begin/);
  assert.match(html, /EXECUTIVE PULSE · TODAY/);
  assert.match(html, /ORGANISATIONAL KNOWLEDGE GRAPH/);
  assert.match(html, /OPEN ORIGINAL SOURCE/);
  assert.match(html, /PRIMARY INTELLIGENCE · BATTLE CARD/);
  assert.match(html, /The conclusion,[\s\S]*with its receipts/);
  assert.match(html, /APPEND-ONLY CORRECTIONS · ORIGINALS ARE NOT OVERWRITTEN/);
  assert.match(html, /Found presents evidence here. It does not post this analysis back into Slack/);
  assert.doesNotMatch(html, /DEMO MEMORY/);
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
  process.env.SLACK_SIGNING_SECRET = "test-slack-signing-secret";
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
  if (previousSecret === undefined) delete process.env.SLACK_SIGNING_SECRET;
  else process.env.SLACK_SIGNING_SECRET = previousSecret;
});

test("keeps Slack ingestion public-only, non-posting, source-preserving and deduplicated", async () => {
  const [oauth, catalog, events, migration] = await Promise.all([
    readFile(new URL("../app/auth/slack/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations/catalog.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations/slack-events.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/0003_memory_updates.sql", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(oauth + catalog, /chat:write|groups:history|groups:read/);
  assert.match(events, /workspace_id: input\.teamId/);
  assert.match(events, /channel_id: input\.channelId/);
  assert.match(events, /author_id: input\.userId/);
  assert.match(events, /message_timestamp: input\.timestamp/);
  assert.match(events, /on_conflict=organisation_id,origin,external_event_id/);
  assert.match(events, /error_code: "slack_event_ingestion_failed"/);
  assert.match(events, /status: "attention"/);
  assert.match(migration, /unique index memory_updates_external_event_idx/);
});

test("keeps Google Workspace APIs read-only and records visible sync failures", async () => {
  const [oauth, sync] = await Promise.all([
    readFile(new URL("../lib/integrations/oauth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations/google-sync.ts", import.meta.url), "utf8"),
  ]);
  assert.match(oauth, /drive\.readonly/);
  assert.match(oauth, /documents\.readonly/);
  assert.doesNotMatch(oauth, /spreadsheets(?!\.readonly)/);
  assert.doesNotMatch(sync, /docs\.googleapis\.com.*(?:batchUpdate|:create)/);
  assert.doesNotMatch(sync, /sheets\.googleapis\.com/);
  assert.match(sync, /source_updated_at: file\.modifiedTime/);
  assert.match(sync, /source_url: file\.webViewLink/);
  assert.match(sync, /status: "failed", error_code: "google_workspace_sync_failed"/);
  assert.match(sync, /status: "attention"/);
});
