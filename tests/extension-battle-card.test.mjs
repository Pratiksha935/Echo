import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = path => readFile(new URL(path, root), "utf8");

test("browser battle card presents the complete prior-work receipt", async () => {
  const content = await source("extension/content.js");
  for (const label of ["HIGH-CONFIDENCE MATCH", "OWNER", "STATUS", "WHY THIS MATCHES", "SOURCE RECEIPTS"]) {
    assert.match(content, new RegExp(label));
  }
  assert.match(content, /app\.slack\.com\/client\/T08LC40MYVB\/C0BGU0STURX/);
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

test("battle card is explicit about source preservation and silent Slack behavior", async () => {
  const content = await source("extension/content.js");
  assert.match(content, /Slack and Google Docs stay untouched/);
  assert.match(content, /Silent in Slack · no automatic replies/);
  assert.doesNotMatch(content, /Analysed locally|searching|processing|trace/i);
});

test("toolbar check explicitly reruns the matcher and reports the outcome", async () => {
  const [content, popup] = await Promise.all([
    source("extension/content.js"),
    source("extension/popup.js"),
  ]);
  assert.match(content, /message\?\.type !== "found:run"/);
  assert.match(content, /sendResponse\(\{ matched: Boolean\(match\) \}\)/);
  assert.match(popup, /sendMessage\(tab\.id, \{ type: "found:run" \}\)/);
  assert.match(popup, /Match found\. The battlecard is open/);
  assert.match(popup, /No matching company knowledge was found/);
});
