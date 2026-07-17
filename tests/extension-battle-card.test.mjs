import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = path => readFile(new URL(path, root), "utf8");

test("browser battle card presents the complete prior-work receipt", async () => {
  const content = await source("extension/content.js");
  for (const label of ["HIGH-CONFIDENCE MATCH", "OWNER", "STATUS", "WHAT FOUND KNOWS", "RECOMMENDED NEXT STEP", "SOURCE RECEIPTS"]) {
    assert.match(content, new RegExp(label));
  }
  assert.match(content, /safeSourceUrl/);
  assert.match(content, /Array\.isArray\(match\.links\)/);
  assert.match(content, /class="ec-original"/);
});

test("corrections use authenticated centralized memory and never browser storage", async () => {
  const [content, manifest, page, route] = await Promise.all([
    source("extension/content.js"),
    source("extension/manifest.json"),
    source("app/memory/correct/page.tsx"),
    source("app/api/memory/update/route.ts"),
  ]);
  assert.match(content, /\/memory\/correct\?/);
  assert.match(content, /TOKEN_KEY/);
  assert.doesNotMatch(content, /updateText[\s\S]{0,200}chrome\.storage/);
  assert.match(manifest, /"storage"/);
  assert.match(page, /requireFoundUser/);
  assert.match(page, /attributed to \{user\.email\}/);
  assert.match(route, /createMemoryUpdate/);
  assert.match(route, /Do not overwrite the original source/);
});

test("battle card preserves original sources and exposes no internal traces", async () => {
  const [content, popup] = await Promise.all([source("extension/content.js"), source("extension/popup.html")]);
  assert.match(content, /Original Slack and Google sources stay untouched/);
  assert.match(popup, /Live authorised evidence only/);
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
});

test("browser sessions are short-lived, workspace-bound, and revalidated", async () => {
  const [token, session, match] = await Promise.all([
    source("lib/auth/browser-token.ts"),
    source("app/api/browser/session/route.ts"),
    source("app/api/browser/match/route.ts"),
  ]);
  assert.match(token, /now \+ 60 \* 60/);
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
  const [page, content, popup, manifest] = await Promise.all([
    source("app/browser/connect/page.tsx"),
    source("extension/content.js"),
    source("extension/popup.html"),
    source("extension/manifest.json"),
  ]);
  assert.match(page, /data-found-pair-status/);
  assert.match(page, /data-found-pair-detail/);
  assert.match(page, /requireFoundUser\("\/browser\/connect"\)/);
  assert.match(content, /Browser connected\./);
  assert.match(content, /payload\.profile\.organisationName/);
  assert.match(popup, /\/browser\/connect/);
  assert.match(popup, /Connect or switch workspace/);
  assert.match(manifest, /"version": "0\.4\.1"/);
});
