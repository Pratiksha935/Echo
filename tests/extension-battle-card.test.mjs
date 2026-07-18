import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = path => readFile(new URL(path, root), "utf8");

test("browser battle card presents the complete prior-work receipt", async () => {
  const content = await source("extension/content.js");
  for (const label of ["HIGH-CONFIDENCE MATCH", "OWNER", "STATUS", "WHAT FOUND KNOWS", "RECOMMENDED NEXT STEP", "CONTINUE IN FOUND"]) {
    assert.match(content, new RegExp(label));
  }
  assert.match(content, /safeSourceUrl/);
  assert.match(content, /Array\.isArray\(match\.links\)/);
  assert.match(content, /Open decision timeline/);
  assert.match(content, /seenUrls/);
  assert.match(content, /seenKinds/);
  assert.doesNotMatch(content, /Open page ↗|class="ec-original"/);
});

test("corrections use the authenticated extension worker and append-only centralized memory", async () => {
  const [content, background, manifest, route] = await Promise.all([
    source("extension/content.js"),
    source("extension/background.js"),
    source("extension/manifest.json"),
    source("app/api/browser/memory-update/route.ts"),
  ]);
  assert.match(content, /type: "found:append-memory"/);
  assert.doesNotMatch(content, /chrome\.storage/);
  assert.doesNotMatch(content, /window\.open|\/memory\/correct\?/);
  assert.match(background, /message\?\.type === "found:append-memory"/);
  assert.match(background, /\/api\/browser\/memory-update/);
  assert.match(manifest, /"storage"/);
  assert.match(route, /organisation_id=eq\.\$\{encodeURIComponent\(token\.organisationId\)\}/);
  assert.match(route, /actor_user_id: token\.userId/);
  assert.match(route, /origin: "user"/);
  assert.doesNotMatch(route, /PATCH|PUT|DELETE/);
  assert.match(content, /VIEW UPDATED DECISION/);
  assert.match(content, /safeSourceUrl\(match\.dashboardUrl\)/);
  assert.match(content, /button\.type = "button"/);
});

test("battle card preserves original sources and exposes no internal traces", async () => {
  const [content, popup] = await Promise.all([source("extension/content.js"), source("extension/popup.html")]);
  assert.match(content, /Original Slack and Google sources stay untouched/);
  assert.match(popup, /Ambient matching/);
  assert.doesNotMatch(content, /Analysed locally|searching|processing|trace/i);
  assert.doesNotMatch(content, /findDemoMatch|Offline demo memory|const knowledge/);
});

test("toolbar check explicitly reruns the matcher and reports the outcome", async () => {
  const [content, popup] = await Promise.all([
    source("extension/content.js"),
    source("extension/popup.js"),
  ]);
  assert.match(content, /message\?\.type !== "found:run"/);
  assert.match(content, /reason: result\.reason/);
  assert.match(popup, /sendMessage\(tab\.id, \{ type: "found:run" \}\)/);
  assert.match(popup, /Insight found\. The battlecard is open/);
  assert.match(popup, /No sufficiently strong insight was found/);
  assert.match(popup, /workspace_access_revoked/);
  assert.match(popup, /server_rejected/);
  assert.match(popup, /temporary_network_failure/);
});

test("browser sessions are workspace-bound and revalidated", async () => {
  const [token, session, match] = await Promise.all([
    source("lib/auth/browser-token.ts"),
    source("app/api/browser/session/route.ts"),
    source("app/api/browser/match/route.ts"),
  ]);
  assert.match(token, /now \+ 60 \* 60 \* 24 \* 30/);
  assert.match(token, /organisationName/);
  assert.match(session, /profile/);
  assert.match(match, /workspace_access_revoked/);
  assert.match(match, /\/memberships\?select=id/);
});

test("live matching recognises indexed Google files by URL before reading editor text", async () => {
  const matcher = await source("lib/browser/matcher.js");
  assert.match(matcher, /const pageResourceId = googleResourceId\(pageUrl\)/);
  assert.match(matcher, /record\.externalId === pageResourceId/);
  assert.match(matcher, /sourceRecord\?\.title/);
  assert.match(matcher, /related\.slice\(0, 4\)/);
});

test("live battlecards surface cross-source insight rather than repeating the open document", async () => {
  const matcher = await source("lib/browser/matcher.js");
  assert.match(matcher, /crossSource/);
  assert.match(matcher, /evidence connected to this/);
  assert.match(matcher, /overlap on/);
  assert.match(matcher, /ranked\.slice\(0, 3\)/);
  assert.match(matcher, /before creating another proposal or ticket/);
});

test("workspace pairing has a dedicated visible confirmation surface", async () => {
  const [page, popupScript, popup, manifest] = await Promise.all([
    source("app/browser/connect/page.tsx"),
    source("extension/popup.js"),
    source("extension/popup.html"),
    source("extension/manifest.json"),
  ]);
  assert.match(page, /data-found-pair-status/);
  assert.match(page, /data-found-pair-detail/);
  assert.match(page, /requireFoundUser\("\/browser\/connect"\)/);
  assert.match(popupScript, /Found will rerun the check on the open page automatically\./);
  assert.match(popup, /id="connect"/);
  assert.match(popup, /Connect or switch workspace/);
  assert.match(manifest, /"version": "0\.5\.0"/);
  assert.match(popupScript, /EXTENSION_VERSION = "0\.5\.0"/);
});

test("Found never matches or renders a battlecard inside its own product", async () => {
  const content = await source("extension/content.js");
  const hostGuard = content.indexOf("FOUND_PRODUCT_HOST.test(location.hostname)");
  const runtimeSetup = content.indexOf("window.__foundExtensionRuntime");
  assert.match(content, /sage-profiterole-3b1c22\\\.netlify\\\.app/);
  assert.ok(hostGuard >= 0 && hostGuard < runtimeSetup);
});

test("browser pairing uses Chrome identity and an explicit workspace grant", async () => {
  const [manifest, background, popup, page, route] = await Promise.all([
    source("extension/manifest.json"),
    source("extension/background.js"),
    source("extension/popup.js"),
    source("app/browser/authorize/page.tsx"),
    source("app/browser/authorize/complete/route.ts"),
  ]);
  assert.match(manifest, /"identity"/);
  assert.match(manifest, /"service_worker": "background\.js"/);
  assert.match(background, /launchWebAuthFlow/);
  assert.match(background, /callback\.origin !== new URL\(redirectUri\)\.origin/);
  assert.match(background, /chrome\.storage\.local\.set/);
  assert.match(popup, /found:connect-workspace/);
  assert.match(page, /Connect this browser\?/);
  assert.match(route, /hasSamePublicOrigin/);
  assert.match(route, /chromiumapp\\\.org/);
});

test("one installed copy owns one content runtime", async () => {
  const [manifestText, popup, content] = await Promise.all([
    source("extension/manifest.json"),
    source("extension/popup.js"),
    source("extension/content.js"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.content_scripts.length, 1);
  assert.deepEqual(manifest.content_scripts[0].js, ["content.js"]);
  assert.ok(!manifest.permissions.includes("scripting"));
  assert.doesNotMatch(popup, /executeScript|insertCSS/);
  assert.match(content, /if \(runtime\) return/);
  assert.match(content, /window\.__foundExtensionRuntime = \{ version: EXTENSION_VERSION \}/);
});

test("popup detects stale page runtimes before requesting a check", async () => {
  const popup = await source("extension/popup.js");
  const statusIndex = popup.indexOf('type: "found:runtime-status"');
  const runIndex = popup.indexOf('type: "found:run"');
  assert.ok(statusIndex >= 0 && runIndex > statusIndex);
  assert.match(popup, /runtime\?\.version !== EXTENSION_VERSION/);
  assert.match(popup, /Reload this page to finish updating Found\./);
});

test("a successful match makes both the companion and battlecard visible immediately", async () => {
  const content = await source("extension/content.js");
  assert.match(content, /document\.documentElement\.appendChild\(root\)/);
  assert.match(content, /avatar\.classList\.add\("arrive"\);\s*setOpen\(true\)/);
  assert.match(content, /existing\?\.querySelector\("\.ec-card"\)\?\.classList\.add\("open"\)/);
  assert.match(content, /setAttribute\("aria-hidden", "false"\)/);
});

test("popup explains automatic in-page battlecards instead of requiring toolbar polling", async () => {
  const [popup, popupScript] = await Promise.all([
    source("extension/popup.html"),
    source("extension/popup.js"),
  ]);
  assert.match(popup, /Found is comparing the open page against approved company memory/);
  assert.match(popupScript, /Strong matches auto-open as a clean battlecard/);
  assert.match(popupScript, /showConnection\(\)\.then\(connected/);
  assert.match(popupScript, /if \(connected\) checkCurrentPage\(\)/);
});

test("battlecard source links dedupe the Found decision timeline", async () => {
  const content = await source("extension/content.js");
  const seenIndex = content.indexOf("const seenUrls = new Set");
  const dashboardIndex = content.indexOf("seenUrls.add(canonicalUrl(dashboardUrl))");
  const sourceLoopIndex = content.indexOf("for (const source of Array.isArray(match.links)");
  assert.ok(seenIndex >= 0 && dashboardIndex > seenIndex && sourceLoopIndex > dashboardIndex);
});

test("automatic checks retry after editor load and follow single-page navigation", async () => {
  const content = await source("extension/content.js");
  assert.match(content, /setTimeout\(checkCurrentPage, 700\)/);
  assert.match(content, /setTimeout\(checkCurrentPage, 2500\)/);
  assert.match(content, /setTimeout\(checkCurrentPage, 6000\)/);
  assert.match(content, /setInterval\(checkCurrentPage, 4000\)/);
  assert.match(content, /location\.href !== lastCheckedUrl/);
  assert.match(content, /const maxAttempts = dynamicPage \|\| recoverable \? 12 : 5/);
  assert.match(content, /automaticAttempts < maxAttempts/);
  assert.match(content, /visibilitychange/);
  assert.match(content, /app\\\.slack\\\.com/);
  assert.match(content, /dynamicSignature/);
  assert.match(content, /MutationObserver/);
  assert.match(content, /setTimeout\(checkCurrentPage, 900\)/);
});

test("Slack web matching reads recent rendered messages instead of the surrounding application chrome", async () => {
  const content = await source("extension/content.js");
  assert.match(content, /function slackPageText/);
  assert.match(content, /message_content/);
  assert.match(content, /c-message_kit__text/);
  assert.match(content, /messages\.slice\(-40\)/);
  assert.match(content, /recentMessages/);
  assert.match(content, /context\.pageText\.slice\(-1200\)/);
});

test("teams can deliberately capture a browser page into a classified workspace department", async () => {
  const [popup,background,content,route]=await Promise.all([source("extension/popup.html"),source("extension/background.js"),source("extension/content.js"),source("app/api/browser/capture/route.ts")]);
  for(const department of ["Research","Product","GTM","Sales","Engineering","Browser"]) assert.match(popup,new RegExp(`value="${department}"`));
  assert.match(content,/found:page-context/);
  assert.match(background,/found:capture-page/);
  assert.match(background,/\/api\/browser\/capture/);
  assert.match(route,/DEPARTMENTS/);
  assert.match(route,/organisation_id:token\.organisationId/);
  assert.match(route,/submitted_by:token\.userId/);
  assert.match(route,/source:"Browser"/);
});

test("the extension worker owns the authenticated cross-origin match request", async () => {
  const [content, background] = await Promise.all([
    source("extension/content.js"),
    source("extension/background.js"),
  ]);
  assert.match(content, /type: "found:match-page"/);
  assert.doesNotMatch(content, /\/api\/browser\/match|Bearer \$\{token\}/);
  assert.match(background, /message\?\.type === "found:match-page"/);
  assert.match(background, /chrome\.storage\.local\.get\(\[TOKEN_KEY\]\)/);
  assert.match(background, /fetch\(`\$\{FOUND_ORIGIN\}\/api\/browser\/match`/);
  for (const reason of ["session_expired", "workspace_access_revoked", "server_rejected", "service_unavailable", "temporary_network_failure"]) {
    assert.match(background, new RegExp(reason));
  }
});
