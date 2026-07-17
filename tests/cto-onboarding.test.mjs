import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = path => readFile(new URL(path, root), "utf8");

async function render(pathname, headers = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("cto-onboarding", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html", ...headers } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("unauthenticated CTO onboarding redirects to sign-in with the intended return path", async () => {
  const response = await render("/integrations");
  assert.equal(response.status, 307);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.pathname, "/signin-with-chatgpt");
  assert.equal(location.searchParams.get("return_to"), "/integrations");
});

test("authenticated workspace selection is constrained to a membership", async () => {
  const workspace = await source("lib/auth/workspace.ts");
  assert.match(workspace, /getFoundWorkspace\(requestedOrganisationId\?: string\)/);
  assert.match(workspace, /user_id: `eq\.\$\{context\.user\.id\}`/);
  assert.match(workspace, /requestedOrganisationId[\s\S]*membershipQuery\.set\("organisation_id", `eq\.\$\{requestedOrganisationId\}`\)/);
  assert.match(workspace, /id=eq\.\$\{encodeURIComponent\(membership\.organisation_id\)\}/);
  assert.doesNotMatch(workspace, /serviceRest|SUPABASE_SERVICE_ROLE_KEY/);
});

test("Google and Slack remain separate explicit consents", async () => {
  const [setup, googleRoute, slackRoute] = await Promise.all([
    source("app/integrations/integration-setup.tsx"),
    source("app/auth/integrations/[provider]/route.ts"),
    source("app/auth/slack/route.ts"),
  ]);
  assert.match(setup, /First approve Google Workspace, then Slack/);
  assert.match(setup, /item\.provider === "slack" && !googleApproved/);
  assert.match(setup, /\/auth\/slack/);
  assert.match(setup, /`\/auth\/integrations\/\$\{selected\.provider\}`/);
  assert.match(setup, /Cancelling grants Found no access and starts no indexing/);
  assert.match(googleRoute, /buildAuthorizationUrl\(provider, state\)/);
  assert.match(slackRoute, /slack\.com\/oauth\/v2\/authorize/);
});

test("extension pairing has explicit connected, signed-out, forbidden, revoked, and retry states", async () => {
  const [pairPage, sessionRoute, extension] = await Promise.all([
    source("app/browser/connect/page.tsx"),
    source("app/api/browser/session/route.ts"),
    source("extension/content.js"),
  ]);
  assert.match(pairPage, /requireFoundUser\("\/browser\/connect"\)/);
  assert.match(pairPage, /if \(!workspace\) redirect\("\/integrations\?return_to=%2Fbrowser%2Fconnect"\)/);
  assert.match(sessionRoute, /status: 401/);
  assert.match(sessionRoute, /status: 403/);
  assert.match(sessionRoute, /issueBrowserToken/);
  assert.match(extension, /"Browser connected\."/);
  assert.match(extension, /"Sign in to connect\."/);
  assert.match(extension, /"Workspace access required\."/);
  assert.match(extension, /workspace_access_revoked/);
  assert.match(extension, /"Connection could not be completed\."/);
  assert.match(extension, /chrome\.storage\.local\.remove\(\[TOKEN_KEY, PROFILE_KEY\]\)/);
});

test("tenant data cannot cross membership, query, or extension-token boundaries", async () => {
  const [migration, workspace, browserRoute, browserToken] = await Promise.all([
    source("supabase/migrations/0001_found_foundation.sql"),
    source("lib/auth/workspace.ts"),
    source("app/api/browser/match/route.ts"),
    source("lib/auth/browser-token.ts"),
  ]);
  assert.match(migration, /alter table public\.knowledge_records enable row level security/);
  assert.match(migration, /m\.organisation_id = knowledge_records\.organisation_id and m\.user_id = auth\.uid\(\)/);
  assert.match(workspace, /organisation_id: `eq\.\$\{organisationId\}`/);
  assert.match(browserRoute, /organisation_id=eq\.\$\{encodeURIComponent\(token\.organisationId\)\}/);
  assert.match(browserToken, /organisationId/);
  assert.match(browserToken, /timingSafeEqual/);
});

test("production authentication and onboarding never seed or silently fall back to demo data", async () => {
  const [callback, auth, integrations, workspacePage] = await Promise.all([
    source("app/auth/callback/route.ts"),
    source("app/auth.ts"),
    source("app/integrations/page.tsx"),
    source("app/workspace/page.tsx"),
  ]);
  assert.doesNotMatch(callback, /seedDemoWorkspace|workspace-seed|DEMO_ACCESS_EMAIL/);
  assert.doesNotMatch(integrations, /seedDemoWorkspace|workspace-seed/);
  assert.doesNotMatch(workspacePage, /seedDemoWorkspace|workspace-seed/);
  assert.match(auth, /const demoUser = await getDemoAccessUser\(\);[\s\S]*if \(demoUser\) return demoUser/);
  assert.match(workspacePage, /const demoMode = user\.id\.startsWith\("demo:"\)/);
  assert.match(workspacePage, /demoMode \? null : await getFoundWorkspace\(\)/);
});
