import assert from "node:assert/strict";
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
  assert.match(html, /Bring the work/);
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
  assert.doesNotMatch(html, /DEMO MEMORY/);
});
