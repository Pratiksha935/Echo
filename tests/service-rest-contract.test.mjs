import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serviceRestSource = await readFile(new URL("../lib/integrations/service-rest.ts", import.meta.url), "utf8");
const integrationStoreSource = await readFile(new URL("../lib/integrations/store.ts", import.meta.url), "utf8");

test("successful empty PostgREST responses are accepted", () => {
  assert.match(serviceRestSource, /const body = await response\.text\(\)/);
  assert.match(serviceRestSource, /if \(!body\.trim\(\)\) return undefined as T/);
  assert.doesNotMatch(serviceRestSource, /return response\.json\(\)/);
});

test("integration persistence uses the shared empty-body-safe helper", () => {
  assert.match(integrationStoreSource, /import \{ serviceRest \} from "\.\/service-rest"/);
  assert.doesNotMatch(integrationStoreSource, /async function serviceRest/);
  assert.match(integrationStoreSource, /return=minimal/);
});
