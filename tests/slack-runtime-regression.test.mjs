import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as hermesContract from "../lib/integrations/slack-hermes-contract.mjs";
import * as messageGate from "../lib/integrations/slack-message-gate.mjs";

// Transpile the real server module and replace only its network/persistence
// boundaries. This keeps the assertions behavioral without adding production
// exports solely for tests.
const require = createRequire(import.meta.url);
const ts = require("typescript");
const slackEventsUrl = new URL("../lib/integrations/slack-events.ts", import.meta.url);
const slackEventsFilename = fileURLToPath(slackEventsUrl);
const slackEventsSource = await readFile(slackEventsUrl, "utf8");

const fullSlackScopes = [
  "app_mentions:read",
  "channels:history",
  "channels:read",
  "chat:write",
  "chat:write.public",
  "commands",
  "im:history",
  "im:write",
  "users:read",
  "users:read.email",
];
const privateDmScopes = ["chat:write", "im:write", "users:read"];

test("an attention-bound signed event is indexed but cannot be falsely marked succeeded", { concurrency: false }, async () => {
  const runtime = createRuntime({
    connection: connection({ status: "attention", scopes: ["channels:history", "channels:read", "users:read"] }),
  });
  const slack = loadSlackEvents(runtime, { hermesMode: "match" });

  const result = await withSlackFetch(runtime, () => slack.processQueuedSlackEvent(runtime.event.external_event_id));

  assert.equal(result, false, "an outbound authorization block must leave the durable event retryable");
  assert.equal(runtime.calls.some(call => call.path.startsWith("/knowledge_records?on_conflict=")), true, "the signed inbound work intent should still be indexed");
  assert.equal(runtime.calls.some(call => call.path.startsWith("/memory_updates?on_conflict=")), true, "the signed inbound update should still be appended");
  assert.deepEqual(queueStatuses(runtime.calls), ["failed"]);
  assert.equal(runtime.credentialLoads, 0, "an attention-bound connection must not attempt outbound Slack delivery");
  assert.equal(runtime.slackRequests.length, 0);
});

test("a connected legacy grant missing write scopes is rejected before Slack API delivery", { concurrency: false }, async () => {
  const runtime = createRuntime({
    connection: connection({ status: "connected", scopes: ["channels:history", "channels:read", "users:read"] }),
  });
  const slack = loadSlackEvents(runtime, { hermesMode: "match" });

  const result = await withSlackFetch(runtime, () => slack.processQueuedSlackEvent(runtime.event.external_event_id));

  assert.equal(result, false);
  assert.equal(runtime.calls.some(call => call.path.startsWith("/knowledge_records?on_conflict=")), true, "write-scope drift must not discard signed inbound knowledge");
  assert.deepEqual(queueStatuses(runtime.calls), ["failed"]);
  assert.equal(runtime.credentialLoads, 0, "stored granted scopes should reject delivery before decrypting or refreshing credentials");
  assert.equal(runtime.slackRequests.length, 0, "missing im:write/chat:write must not reach conversations.open or chat.postMessage");
});

test("Hermes true no_match is suppressed, while Hermes unavailability remains retryable", { concurrency: false }, async () => {
  const noMatchRuntime = createRuntime({ connection: connection({ status: "connected", scopes: fullSlackScopes }) });
  const noMatchSlack = loadSlackEvents(noMatchRuntime, { hermesMode: "no_match" });
  await withSlackFetch(noMatchRuntime, () => noMatchSlack.notifySlackAuthorAboutPriorWork(notification("Ev-no-match")));

  assert.deepEqual(deliveryStatuses(noMatchRuntime.calls), ["suppressed"]);
  assert.equal(noMatchRuntime.slackRequests.some(request => request.includes("conversations.open") || request.includes("chat.postMessage")), false);

  const unavailableRuntime = createRuntime({ connection: connection({ status: "connected", scopes: fullSlackScopes }) });
  const unavailableSlack = loadSlackEvents(unavailableRuntime, { hermesMode: "unavailable" });
  await assert.rejects(
    withSlackFetch(unavailableRuntime, () => unavailableSlack.notifySlackAuthorAboutPriorWork(notification("Ev-hermes-down"))),
    /Hermes is unavailable/,
  );

  assert.deepEqual(deliveryStatuses(unavailableRuntime.calls), ["failed"]);
  assert.equal(unavailableRuntime.slackRequests.some(request => request.includes("conversations.open") || request.includes("chat.postMessage")), false);
});

test("OAuth records incomplete Slack grants as attention instead of connected", async () => {
  const [callback, route, scopes] = await Promise.all([
    readFile(new URL("../app/auth/slack/callback/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/auth/slack/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations/slack-scopes.ts", import.meta.url), "utf8").catch(() => ""),
  ]);

  assert.match(scopes, /SLACK_REQUIRED_SCOPES/);
  assert.match(scopes, /SLACK_PRIVATE_DM_SCOPES/);
  assert.match(scopes, /"chat:write"/);
  assert.match(scopes, /"im:write"/);
  assert.match(route, /SLACK_REQUIRED_SCOPES\.join\(","\)/);
  assert.match(callback, /missingSlackScopes\(grantedScopes\)/);
  assert.match(callback, /status:\s*missingScopes\.length\s*\?\s*"attention"\s*:\s*"connected"/);
  assert.match(callback, /slack_scope_missing/);
});

function loadSlackEvents(runtime, { hermesMode }) {
  class StubHermesUnavailableError extends Error {
    constructor() {
      super("Hermes is unavailable.");
    }
  }

  const queryHermes = async () => {
    if (hermesMode === "unavailable") throw new StubHermesUnavailableError();
    if (hermesMode === "no_match") {
      return JSON.stringify({ show: false, confidence: 99, classification: "no_match", candidate: 1, reason: "Different intervention." });
    }
    return JSON.stringify({ show: true, confidence: 96, classification: "same_idea", candidate: 1, reason: "Same trusted-renter deposit intervention." });
  };

  const mocks = {
    "../hermes/client": { HermesUnavailableError: StubHermesUnavailableError, queryHermes },
    "./credentials": {
      loadSlackConnectionCredential: async () => {
        runtime.credentialLoads += 1;
        return { accessToken: "xoxb-test" };
      },
    },
    "./google-sheet-records": {
      extractStructuredIdentifiers: text => [...new Set((text.match(/\b[A-Z][A-Z0-9]{1,11}-\d{2,16}\b/gi) ?? []).map(value => value.toLowerCase()))],
    },
    "./knowledge-evidence.mjs": { selectEvidenceExcerpt: (body, _question, limit) => body.slice(0, limit) },
    "./service-rest": { serviceRest: runtime.serviceRest },
    "./slack-hermes-contract.mjs": hermesContract,
    "./slack-message-gate.mjs": messageGate,
    "./slack-scopes": slackScopePolicy(),
    "./slack-scopes.ts": slackScopePolicy(),
  };
  const output = ts.transpileModule(slackEventsSource, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: slackEventsFilename,
  }).outputText;
  const compiledModule = { exports: {} };
  const localRequire = specifier => {
    if (specifier in mocks) return mocks[specifier];
    if (specifier.startsWith("node:")) return require(specifier);
    throw new Error(`Unmocked slack-events dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", "__filename", "__dirname", output)(
    localRequire,
    compiledModule,
    compiledModule.exports,
    slackEventsFilename,
    dirname(slackEventsFilename),
  );
  return compiledModule.exports;
}

function createRuntime({ connection: storedConnection }) {
  const calls = [];
  const slackRequests = [];
  const event = {
    id: "00000000-0000-4000-8000-000000000001",
    attempts: 0,
    external_event_id: "Ev-regression",
    external_workspace_id: "T-test",
    payload: {
      event_id: "Ev-regression",
      team_id: "T-test",
      event: {
        channel: "C-test",
        channel_type: "channel",
        text: "What if trusted renters with five clean returns paid a 50% smaller security deposit?",
        ts: "1783839807.897629",
        type: "message",
        user: "U-test",
      },
    },
  };
  const runtime = {
    calls,
    credentialLoads: 0,
    event,
    slackRequests,
    async serviceRest(path, init = {}) {
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ body, method: init.method ?? "GET", path });

      if (path === "/rpc/claim_slack_ingestion_event") return [event];
      if (path === "/rpc/claim_slack_dm_delivery") return [{ id: `delivery-${body?.p_external_event_id ?? "event"}` }];
      if (path.startsWith("/integration_connections?") && (init.method ?? "GET") === "GET") {
        return connectionVisibleToQuery(storedConnection, path) ? [storedConnection] : [];
      }
      if (path.startsWith("/knowledge_records?select=")) return [priorWorkRecord()];
      if (path.startsWith("/memory_updates?select=")) return [];
      if (path.startsWith("/knowledge_records?on_conflict=")) return undefined;
      if (path.startsWith("/memory_updates?on_conflict=")) return undefined;
      if (path.startsWith("/ingestion_events?id=eq.")) return undefined;
      if (path.startsWith("/slack_dm_deliveries?id=eq.")) return undefined;
      if (path.startsWith("/integration_connections?id=eq.")) return undefined;
      if (path === "/integration_sync_runs") return undefined;
      throw new Error(`Unhandled serviceRest request: ${init.method ?? "GET"} ${path}`);
    },
  };
  return runtime;
}

function connection({ scopes, status }) {
  return {
    granted_scopes: scopes,
    id: "00000000-0000-4000-8000-000000000010",
    organisation_id: "00000000-0000-4000-8000-000000000020",
    status,
  };
}

function connectionVisibleToQuery(storedConnection, path) {
  const decoded = decodeURIComponent(path);
  if (decoded.includes("status=eq.connected")) return storedConnection.status === "connected";
  const allowed = decoded.match(/status=in\.\(([^)]+)\)/)?.[1]?.split(",");
  if (allowed) return allowed.includes(storedConnection.status);
  if (decoded.includes("status=neq.disconnected")) return storedConnection.status !== "disconnected";
  return true;
}

function priorWorkRecord() {
  return {
    author_name: "Rohan Desai",
    body: "Experiment approved. Trusted renters receive a 50% lower deposit after five clean returns.",
    department: "Product",
    external_id: "RLP-101",
    metadata: { status: "Experiment approved" },
    source: "Notion",
    source_url: "https://app.notion.com/p/39b630edf61f811fb5c2fb52bd1b2507",
    title: "Dynamic security deposits for trusted renters",
  };
}

function notification(eventId) {
  return {
    channelId: "C-test",
    eventId,
    teamId: "T-test",
    text: "What if trusted renters with five clean returns paid a 50% smaller security deposit?",
    timestamp: "1783839807.897629",
    userId: "U-test",
  };
}

function slackScopePolicy() {
  const missingSlackScopes = (granted, required = fullSlackScopes) => {
    const available = new Set(granted ?? []);
    return required.filter(scope => !available.has(scope));
  };
  return {
    SLACK_PRIVATE_DM_SCOPES: privateDmScopes,
    SLACK_REQUIRED_SCOPES: fullSlackScopes,
    hasSlackScopes: (granted, required) => missingSlackScopes(granted, required).length === 0,
    missingSlackScopes,
  };
}

async function withSlackFetch(runtime, operation) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    runtime.slackRequests.push(String(url));
    if (String(url).includes("users.info")) {
      return jsonResponse({ ok: true, user: { id: "U-test", team_id: "T-test", deleted: false, is_bot: false, is_restricted: false, is_stranger: false, is_ultra_restricted: false } });
    }
    if (String(url).includes("conversations.open")) {
      return jsonResponse({ ok: true, channel: { id: "D-test" } });
    }
    if (String(url).includes("chat.postMessage")) return jsonResponse({ ok: true, ts: "1783839810.000100" });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    return await operation();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

function jsonResponse(payload) {
  return { ok: true, json: async () => payload };
}

function queueStatuses(calls) {
  return calls
    .filter(call => call.path.startsWith("/ingestion_events?id=eq.") && call.body?.status)
    .map(call => call.body.status);
}

function deliveryStatuses(calls) {
  return calls
    .filter(call => call.path.startsWith("/slack_dm_deliveries?id=eq.") && call.body?.status)
    .map(call => call.body.status);
}
