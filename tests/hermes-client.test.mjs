import assert from "node:assert/strict";
import test from "node:test";
import { HermesUnavailableError, queryHermes } from "../lib/hermes/client.ts";

const originalFetch = globalThis.fetch;
const originalEnv = {
  HERMES_API_TOKEN: process.env.HERMES_API_TOKEN,
  HERMES_API_URL: process.env.HERMES_API_URL,
  HERMES_MODEL: process.env.HERMES_MODEL,
};

test.beforeEach(() => {
  process.env.HERMES_API_TOKEN = "test-token";
  process.env.HERMES_API_URL = "https://hermes.invalid/";
  delete process.env.HERMES_MODEL;
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("sends the OpenAI-compatible Hermes request and returns trimmed content", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://hermes.invalid/v1/chat/completions");
    assert.equal(init.method, "POST");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.authorization, "Bearer test-token");
    assert.ok(init.signal instanceof AbortSignal);

    const body = JSON.parse(init.body);
    assert.equal(body.model, "gpt-5.6-sol");
    assert.equal(body.stream, false);
    assert.equal(body.temperature, 0);
    assert.match(body.messages[0].content, /Organisation: org-123$/);
    assert.deepEqual(body.messages[1], { role: "user", content: "What changed?" });
    return Response.json({ choices: [{ message: { content: "  Evidence-grounded answer.  " } }] });
  };

  assert.equal(await queryHermes("What changed?", "org-123"), "Evidence-grounded answer.");
});

test("honours the configured model", async () => {
  process.env.HERMES_MODEL = "configured-model";
  globalThis.fetch = async (_url, init) => {
    assert.equal(JSON.parse(init.body).model, "configured-model");
    return Response.json({ choices: [{ message: { content: "NO_REPLY" } }] });
  };
  assert.equal(await queryHermes("Thanks", "org-123"), "NO_REPLY");
});

test("fails closed when Hermes configuration is incomplete", async () => {
  delete process.env.HERMES_API_TOKEN;
  await assert.rejects(queryHermes("Question", "org-123"), HermesUnavailableError);
});

for (const [name, responseFactory] of [
  ["a transport failure", () => Promise.reject(new TypeError("fetch failed"))],
  ["a non-success status", () => new Response("upstream failed", { status: 502 })],
  ["malformed JSON", () => new Response("not json", { status: 200 })],
  ["an empty completion", () => Response.json({ choices: [{ message: { content: "  " } }] })],
]) {
  test(`maps ${name} to a secret-safe availability error`, async () => {
    globalThis.fetch = responseFactory;
    await assert.rejects(
      queryHermes("Question", "org-123"),
      error => error instanceof HermesUnavailableError && error.message === "Hermes is unavailable.",
    );
  });
}
