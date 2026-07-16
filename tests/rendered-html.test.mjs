import assert from "node:assert/strict";
import test from "node:test";

process.env.FOUNDER_ACCESS_EMAILS = "founder@example.com";

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
  assert.match(html, /FOUNDER ONBOARDING \/ 3 STEPS/);
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
});
