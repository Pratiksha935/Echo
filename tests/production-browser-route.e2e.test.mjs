import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runInNewContext } from "node:vm";

const root = new URL("../", import.meta.url);
const extensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const documentId = "1tYUQ-GVmVVtRgHbBrjc3I1O7X-faVi0NmYJzSwpnQGc";
const signingSecret = "found-production-route-contract-secret";
const organisationId = "org-production-contract";
const userId = "user-production-contract";
const requests = [];
let membershipActive = true;
const writtenUpdates = [];
const capturedRecords = [];

const records = [
  {
    author_name: "Rohan Desai",
    body: "Customers become trusted renters after five completed, on-time, damage-free returns. Keep a 50% deposit reduction.",
    department: "Product",
    external_id: documentId,
    metadata: { status: "Experiment approved" },
    source: "Google Docs",
    source_url: `https://docs.google.com/document/d/${documentId}/edit?usp=drivesdk`,
    title: "Dynamic security deposits for trusted renters",
  },
  {
    author_name: "U08PRODUCT",
    body: "The approved policy is a 50% lower security deposit after five clean returns. The zero-deposit proposal was rejected.",
    department: "Product",
    external_id: "slack:C0BHQ2MCM2P:1784281557.141129",
    metadata: { status: "Latest Slack update" },
    source: "Slack",
    source_url: "https://app.slack.com/client/T08LC40MYVB/C0BHQ2MCM2P/p1784281557141129",
    title: "Dynamic security deposits for trusted renters",
  },
];

let app;
let persistence;
let appOrigin;

test.before(async () => {
  persistence = createServer((request, response) => {
    const url = new URL(request.url, "http://persistence.invalid");
    requests.push(url.pathname + url.search);
    response.setHeader("content-type", "application/json");
    if (url.pathname.endsWith("/memberships")) {
      response.end(JSON.stringify(membershipActive ? [{ id: "membership-1" }] : []));
      return;
    }
    if (url.pathname.endsWith("/knowledge_records") && request.method === "POST") {
      let body = "";
      request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        capturedRecords.push(JSON.parse(body));
        response.statusCode = 201;
        response.end(JSON.stringify([capturedRecords.at(-1)]));
      });
      return;
    }
    if (url.pathname.endsWith("/knowledge_records")) {
      const tenant = url.searchParams.get("organisation_id");
      const externalId = url.searchParams.get("external_id");
      const tenantRecords = tenant === `eq.${organisationId}` ? records : [];
      response.end(JSON.stringify(externalId ? tenantRecords.filter(record => `eq.${record.external_id}` === externalId).map(record => ({ source_url: record.source_url, title: record.title })) : tenantRecords));
      return;
    }
    if (url.pathname.endsWith("/memory_updates") && request.method === "POST") {
      let body = "";
      request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        writtenUpdates.push(JSON.parse(body));
        response.statusCode = 201;
        response.end(JSON.stringify([writtenUpdates.at(-1)]));
      });
      return;
    }
    if (url.pathname.endsWith("/memory_updates") && request.method === "GET") {
      const tenant = url.searchParams.get("organisation_id");
      const recordId = url.searchParams.get("source_record_id");
      const matches = writtenUpdates.filter(update => tenant === `eq.${update.organisation_id}` && recordId === `eq.${update.source_record_id}`);
      response.end(JSON.stringify(matches.slice(-1).map(update => ({ created_at: update.created_at, update_text: update.update_text }))));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  persistence.listen(0, "127.0.0.1");
  await once(persistence, "listening");
  const persistencePort = persistence.address().port;

  const appPort = await availablePort();
  appOrigin = `http://127.0.0.1:${appPort}`;
  app = spawn(process.execPath, [fileURLToPath(import.meta.resolve("next/dist/bin/next")), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(appPort)], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      BROWSER_SESSION_SECRET: signingSecret,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "production-contract-publishable",
      NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${persistencePort}`,
      SUPABASE_SERVICE_ROLE_KEY: "production-contract-service-role",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForApp(appOrigin, app);
});

test.after(async () => {
  if (app && !app.killed) {
    app.kill("SIGTERM");
    await Promise.race([once(app, "exit"), delay(3_000)]);
  }
  if (persistence) await new Promise(resolve => persistence.close(resolve));
});

test("production browser route enforces CORS for a valid Chrome extension origin", async () => {
  const allowed = await fetch(`${appOrigin}/api/browser/match`, { method: "OPTIONS", headers: { origin: extensionOrigin } });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), extensionOrigin);
  assert.equal(allowed.headers.get("access-control-allow-headers"), "authorization, content-type");
  assert.match(allowed.headers.get("vary"), /origin/i);

  const forbidden = await fetch(`${appOrigin}/api/browser/match`, { method: "OPTIONS", headers: { origin: "https://attacker.example" } });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.get("access-control-allow-origin"), null);
});

test("production browser route rejects expired signed sessions", async () => {
  const response = await matchRequest({ token: browserToken(-1) });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthorized" });
  assert.equal(response.headers.get("access-control-allow-origin"), extensionOrigin);
});

test("production browser route revalidates membership and reports revocation", async () => {
  membershipActive = false;
  const response = await matchRequest({ token: browserToken(3600) });
  membershipActive = true;
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "workspace_access_revoked" });
});

test("production browser route tenant-filters the known Google Doc and returns cross-source receipts", async () => {
  requests.length = 0;
  const response = await matchRequest({
    token: browserToken(3600),
    body: {
      organisationId: "org-attacker-controlled-body",
      pageText: "",
      pageTitle: "Dynamic security deposits for trusted renters - Google Docs",
      pageUrl: `https://docs.google.com/document/d/${documentId}/edit?tab=t.0`,
    },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.match.title, "Dynamic security deposits for trusted renters");
  assert.equal(payload.match.status, "Latest Slack update");
  assert.match(payload.match.summary, /Slack evidence connected to this Google Docs document/);
  assert.deepEqual(payload.match.links.map(link => link.label), ["Google Docs evidence", "Slack evidence"]);
  assert.deepEqual(payload.match.account, { email: "cto@example.com", organisationName: "Production Contract" });
  assert.match(payload.match.dashboardUrl, /\/workspace\/decision\//);
  assert.ok(requests.some(path => path.includes(`/memberships?`) && path.includes(`organisation_id=eq.${organisationId}`) && path.includes(`user_id=eq.${userId}`)));
  assert.ok(requests.some(path => path.includes(`/knowledge_records?`) && path.includes(`organisation_id=eq.${organisationId}`)));
  assert.ok(requests.some(path => path.includes(`external_id=eq.${documentId}`)));
  assert.ok(requests.some(path => path.includes(`source_url=ilike.*${documentId}*`)));
  assert.ok(requests.every(path => !path.includes("org-attacker-controlled-body")));
});

test("production browser capture writes explicit tenant-bound knowledge with a source receipt", async () => {
  capturedRecords.length = 0;
  const response = await fetch(`${appOrigin}/api/browser/capture`, {
    method: "POST",
    headers: { authorization: `Bearer ${browserToken(3600)}`, "content-type": "application/json", origin: extensionOrigin },
    body: JSON.stringify({
      organisationId: "org-attacker-controlled-body",
      department: "Research",
      note: "Potential competitor signal for the ReLoop research team.",
      pageTitle: "Rental market intelligence",
      pageUrl: "https://example.com/rental-market-intelligence",
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.match(payload.decisionUrl, /\/workspace\/decision\//);
  assert.equal(capturedRecords.length, 1);
  assert.equal(capturedRecords[0].organisation_id, organisationId);
  assert.equal(capturedRecords[0].department, "Research");
  assert.equal(capturedRecords[0].source, "Browser");
  assert.equal(capturedRecords[0].metadata.submitted_by, userId);
  assert.equal(capturedRecords[0].source_url, "https://example.com/rental-market-intelligence");
  assert.ok(requests.every(path => !path.includes("org-attacker-controlled-body")));
});

test("production browser route returns an explicit no-match response", async () => {
  const response = await matchRequest({
    token: browserToken(3600),
    body: { pageText: "Lunch at one?", pageTitle: "Untitled document", pageUrl: "https://docs.google.com/document/d/unindexed/edit" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { match: null });
});

test("downloadable v0.5.3 ZIP is byte-aligned with every required production extension file", async () => {
  const required = ["manifest.json", "background.js", "content.js", "content.css", "update.css", "popup.html", "popup.js", "popup.css", "README.md"];
  const archive = new URL("public/found-extension-v0.5.3.zip", root);
  const entries = (await command("unzip", ["-Z1", archive.pathname])).trim().split("\n").sort();
  assert.deepEqual(entries, [...required].sort());
  for (const name of required) {
    const [packaged, source] = await Promise.all([
      command("unzip", ["-p", archive.pathname, name]),
      readFile(new URL(`extension/${name}`, root), "utf8"),
    ]);
    assert.equal(packaged, source, `${name} differs between extension/ and the downloadable ZIP`);
  }
  const manifest = JSON.parse(await command("unzip", ["-p", archive.pathname, "manifest.json"]));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.5.3");
  assert.deepEqual(manifest.background, { service_worker: "background.js" });
  assert.deepEqual(manifest.content_scripts[0].js, ["content.js"]);
  assert.deepEqual(manifest.content_scripts[0].css, ["content.css", "update.css"]);
  assert.equal(manifest.action.default_popup, "popup.html");
});

test("production browser memory update revalidates membership and tenant-binds the record", async () => {
  writtenUpdates.length = 0;
  const matchedRecordId = records[1].external_id;
  const response = await fetch(`${appOrigin}/api/browser/memory-update`, {
    method: "POST",
    headers: { authorization: `Bearer ${browserToken(3600)}`, "content-type": "application/json", origin: extensionOrigin },
    body: JSON.stringify({ organisationId: "org-attacker", recordId: matchedRecordId, sourceUrl: `https://docs.google.com/document/d/${documentId}/edit`, updateText: "The rollout is now approved for the next cohort." }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(writtenUpdates.length, 1);
  assert.equal(writtenUpdates[0].organisation_id, organisationId);
  assert.equal(writtenUpdates[0].actor_user_id, userId);
  assert.equal(writtenUpdates[0].source_record_id, matchedRecordId);
  assert.equal(writtenUpdates[0].origin, "user");

  const refreshed = await matchRequest({
    token: browserToken(3600),
    body: { pageText: "", pageTitle: "Dynamic security deposits", pageUrl: `https://docs.google.com/document/d/${documentId}/edit` },
  });
  const refreshedMatch = (await refreshed.json()).match;
  assert.equal(refreshedMatch.status, "Memory updated");
  assert.match(refreshedMatch.summary, /Latest team update: The rollout is now approved/);
});

test("authenticated matching runs in the extension worker, never in the Google Docs page context", async () => {
  const [background, content] = await Promise.all([
    readFile(new URL("extension/background.js", root), "utf8"),
    readFile(new URL("extension/content.js", root), "utf8"),
  ]);
  assert.match(background, /message\?\.type (?:===|!==) "found:match-page"/);
  assert.match(background, /fetch\(`\$\{FOUND_ORIGIN\}\/api\/browser\/match`/);
  assert.match(background, /authorization: `Bearer \$\{token\}`/);
  assert.match(content, /chrome\.runtime\.sendMessage\(\{[\s\S]*type: "found:match-page"/);
  assert.doesNotMatch(content, /\/api\/browser\/match|authorization: `Bearer/);
});

test("the extension worker executes the authenticated match handoff", async () => {
  const background = await readFile(new URL("extension/background.js", root), "utf8");
  let listener;
  let request;
  const token = browserToken(3600);
  runInNewContext(background, {
    TextDecoder,
    URL,
    Uint8Array,
    atob,
    chrome: {
      identity: {},
      runtime: { onMessage: { addListener(value) { listener = value; } } },
      storage: { local: {
        async get() { return { "found:browser-session": token }; },
        async remove() {},
        async set() {},
      } },
    },
    fetch: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, async json() { return { match: { id: documentId, links: records.map(record => ({ label: `${record.source} evidence`, url: record.source_url })) } }; } };
    },
  });
  const response = await new Promise(resolve => {
    assert.equal(listener({
      type: "found:match-page",
      page: { pageText: "", pageTitle: "Production document", pageUrl: `https://docs.google.com/document/d/${documentId}/edit` },
    }, {}, resolve), true);
  });
  assert.equal(request.url, "https://sage-profiterole-3b1c22.netlify.app/api/browser/match");
  assert.equal(request.options.headers.authorization, `Bearer ${token}`);
  assert.equal(JSON.parse(request.options.body).pageUrl, `https://docs.google.com/document/d/${documentId}/edit`);
  assert.equal(response.reason, "matched");
  assert.deepEqual(Array.from(response.match.links, link => link.label), ["Google Docs evidence", "Slack evidence"]);
});

function browserToken(ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    email: "cto@example.com",
    exp: now + ttlSeconds,
    iat: now,
    organisationId,
    organisationName: "Production Contract",
    userId,
    version: 1,
  })).toString("base64url");
  const signature = createHmac("sha256", signingSecret).update(`found-browser:${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

function matchRequest({ token, body = { pageText: "", pageTitle: "", pageUrl: "" } }) {
  return fetch(`${appOrigin}/api/browser/match`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", origin: extensionOrigin },
    body: JSON.stringify(body),
  });
}

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForApp(origin, child) {
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Next exited before readiness: ${stderr}`);
    try {
      const response = await fetch(`${origin}/api/browser/match`, { method: "OPTIONS", headers: { origin: extensionOrigin } });
      if (response.status === 204) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`Next did not become ready: ${stderr}`);
}

function command(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: new URL("..", import.meta.url), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(`${file} exited ${code}: ${stderr}`)));
  });
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
