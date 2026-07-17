import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const source = path => readFile(new URL(path, root), "utf8");
const browserTokenModule = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(
  await source("lib/auth/browser-token.ts"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText).toString("base64")}`);
const { issueBrowserToken, verifyBrowserToken } = browserTokenModule;

test("unauthenticated product routes preserve their destination through sign-in", async () => {
  const [auth, workspace, integrations, browserAuthorize] = await Promise.all([
    source("app/auth.ts"),
    source("app/workspace/page.tsx"),
    source("app/integrations/page.tsx"),
    source("app/browser/authorize/page.tsx"),
  ]);

  assert.match(workspace, /requireFoundUser\("\/workspace"\)/);
  assert.match(integrations, /requireFoundUser\("\/integrations"\)/);
  assert.match(browserAuthorize, /requireFoundUser\(returnTo\)/);
  assert.match(auth, /redirect\(`\/login\?return_to=\$\{target\}`\)/);
  assert.match(auth, /hasRefreshToken\(\)[\s\S]*\/auth\/refresh\?return_to=/);
});

test("Google login keeps a safe return_to value across PKCE authorization", async () => {
  const [login, start, callback, session] = await Promise.all([
    source("app/login/page.tsx"),
    source("app/auth/google/route.ts"),
    source("app/auth/callback/route.ts"),
    source("lib/auth/session.ts"),
  ]);

  assert.match(login, /safeReturnPath\(single\(params\.return_to\), "\/integrations"\)/);
  assert.match(start, /safeReturnPath\(request\.nextUrl\.searchParams\.get\("return_to"\)\)/);
  assert.match(start, /store\.set\(RETURN_TO_COOKIE, returnTo, cookieOptions\)/);
  assert.match(start, /code_challenge_method", "s256"/);
  assert.match(callback, /safeReturnPath\(store\.get\(RETURN_TO_COOKIE\)\?\.value\)/);
  assert.match(callback, /NextResponse\.redirect\(new URL\(returnTo, request\.url\)\)/);
  assert.match(callback, /exchangePkceCode\(code, verifier\)/);
  assert.match(session, /if \(!value\?\.startsWith\("\/"\) \|\| value\.startsWith\("\/\/"\)\) return fallback/);
});

test("Google and Slack remain two separate explicit connector consents", async () => {
  const [setup, google, slack] = await Promise.all([
    source("app/integrations/integration-setup.tsx"),
    source("app/auth/integrations/[provider]/route.ts"),
    source("app/auth/slack/route.ts"),
  ]);

  assert.match(setup, /First approve Google Workspace, then Slack\. Each opens its own OAuth consent screen/);
  assert.match(setup, /Continuing opens \{selected\.name\}.*OAuth consent screen/);
  assert.match(setup, /selected\.provider === "slack" \? "\/auth\/slack" : `\/auth\/integrations\/\$\{selected\.provider\}`/);
  assert.match(google, /buildAuthorizationUrl\(provider, state\)/);
  assert.match(slack, /https:\/\/slack\.com\/oauth\/v2\/authorize/);
  assert.match(slack, /connections\.some\(connection => connection\.provider === "google"\)/);
  assert.match(slack, /error=google_required/);
});

test("onboarding status is derived from persisted live connections and never invented", async () => {
  const [page, setup, workspaceStore, authCallback] = await Promise.all([
    source("app/integrations/page.tsx"),
    source("app/integrations/integration-setup.tsx"),
    source("lib/auth/workspace.ts"),
    source("app/auth/callback/route.ts"),
  ]);

  assert.match(page, /listIntegrationConnections\(workspace\.organisationId\)/);
  assert.match(setup, /new Map\(connections\.map\(item => \[item\.provider, item\]\)\)/);
  assert.match(setup, /AUTHORISED · NOT INDEXED/);
  assert.match(setup, /indexing not started/);
  assert.match(workspaceStore, /\/integration_connections\?select=provider,status,external_workspace_name,last_synced_at&organisation_id=eq\./);
  assert.doesNotMatch(page + setup + workspaceStore, /seedDemoWorkspace|notion-rental-kb|slack-reloop-seed/);
  assert.doesNotMatch(authCallback, /seedDemoWorkspace|DEMO_ACCESS_EMAIL|DEMO_ACCESS_CODE/);
});

test("Chrome identity pairing requires a visible approval and an exact extension callback", async () => {
  const [background, authorize, complete] = await Promise.all([
    source("extension/background.js"),
    source("app/browser/authorize/page.tsx"),
    source("app/browser/authorize/complete/route.ts"),
  ]);

  assert.match(background, /chrome\.identity\.getRedirectURL\("found"\)/);
  assert.match(background, /chrome\.identity\.launchWebAuthFlow\(\{ url: authUrl, interactive: true \}\)/);
  assert.match(authorize, /Connect this browser\?/);
  assert.match(authorize, /<form action="\/browser\/authorize\/complete" method="post"/);
  assert.match(complete, /hasSamePublicOrigin\(request\)/);
  assert.ok(complete.includes("/^https:\\/\\/[a-p]{32}\\.chromiumapp\\.org\\/found\\/?$/"));
  assert.match(complete, /issueBrowserToken\(\{ \.\.\.profile, userId: user\.id \}\)/);
  assert.match(complete, /"cache-control": "no-store"/);
});

test("browser sessions are signed, tenant-bound, and valid for exactly one hour", () => {
  const previousSecret = process.env.BROWSER_SESSION_SECRET;
  const originalNow = Date.now;
  process.env.BROWSER_SESSION_SECRET = "production-onboarding-qa-secret";
  const issuedAtMs = 1_800_000_000_000;
  Date.now = () => issuedAtMs;

  try {
    const token = issueBrowserToken({
      email: "cto@example.com",
      organisationId: "org-a",
      organisationName: "Acme",
      userId: "user-1",
    });
    const parsed = verifyBrowserToken(token);
    assert.ok(parsed);
    assert.equal(parsed.organisationId, "org-a");
    assert.equal(parsed.userId, "user-1");
    assert.equal(parsed.exp - parsed.iat, 60 * 60);

    const [payload, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const crossTenantPayload = Buffer.from(JSON.stringify({ ...claims, organisationId: "org-b" })).toString("base64url");
    assert.equal(verifyBrowserToken(`${crossTenantPayload}.${signature}`), null);

    Date.now = () => issuedAtMs + 60 * 60 * 1000 + 1;
    assert.equal(verifyBrowserToken(token), null);
  } finally {
    Date.now = originalNow;
    if (previousSecret === undefined) delete process.env.BROWSER_SESSION_SECRET;
    else process.env.BROWSER_SESSION_SECRET = previousSecret;
  }
});

test("every browser insight revalidates membership and queries only the token tenant", async () => {
  const route = await source("app/api/browser/match/route.ts");

  assert.match(route, /verifyBrowserToken\(authorization\.slice\(7\)\)/);
  assert.match(route, /\/memberships\?select=id&organisation_id=eq\.\$\{encodeURIComponent\(token\.organisationId\)\}&user_id=eq\.\$\{encodeURIComponent\(token\.userId\)\}/);
  assert.match(route, /workspace_access_revoked/);
  assert.match(route, /\/knowledge_records\?[^`]*organisation_id=eq\.\$\{encodeURIComponent\(token\.organisationId\)\}/);
  assert.doesNotMatch(route, /body\?\.organisationId|requestedOrganisationId/);
});

test("no live-data or browser-match path falls back to demo knowledge", async () => {
  const [workspacePage, browserRoute, browserMatcher, callback] = await Promise.all([
    source("app/workspace/page.tsx"),
    source("app/api/browser/match/route.ts"),
    source("lib/browser/matcher.js"),
    source("app/auth/callback/route.ts"),
  ]);

  assert.match(workspacePage, /demoMode \? null : await getFoundWorkspace\(\)/);
  assert.match(workspacePage, /workspace[\s\S]*listWorkspaceKnowledgeRecords\(workspace\.organisationId\)/);
  assert.match(browserRoute, /if \(!match\) return NextResponse\.json\(\{ match: null \}/);
  assert.doesNotMatch(browserRoute + browserMatcher + callback, /notion-rental-kb|slack-reloop-seed|seedDemoWorkspace/);
});
