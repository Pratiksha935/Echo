import assert from "node:assert/strict";
import test from "node:test";
import { supabaseServiceHeaders } from "../lib/integrations/service-headers.js";

test("serviceRest sends opaque Supabase secret keys only as API keys", () => {
  const headers = supabaseServiceHeaders("sb_secret_server_only");
  assert.equal(headers.get("apikey"), "sb_secret_server_only");
  assert.equal(headers.has("authorization"), false);
  assert.equal(headers.get("content-type"), "application/json");
});

test("serviceRest retains bearer authorization for legacy service-role JWTs", () => {
  const headers = supabaseServiceHeaders("legacy.jwt.value");
  assert.equal(headers.get("apikey"), "legacy.jwt.value");
  assert.equal(headers.get("authorization"), "Bearer legacy.jwt.value");
});

test("serviceRest never overwrites the server API key with caller headers", () => {
  const headers = supabaseServiceHeaders("sb_secret_server_only", { apikey: "untrusted", "x-request-id": "request-1" });
  assert.equal(headers.get("apikey"), "sb_secret_server_only");
  assert.equal(headers.get("x-request-id"), "request-1");
});
