import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = path => readFile(new URL(path, root), "utf8");

test("onboarding completion comes from tenant workspace and integration state", async () => {
  const [page, wizard, workspace] = await Promise.all([
    source("app/integrations/page.tsx"),
    source("app/integrations/integration-setup.tsx"),
    source("lib/auth/workspace.ts"),
  ]);
  assert.match(page, /getFoundWorkspace\(\)/);
  assert.match(page, /listIntegrationConnections\(workspace\.organisationId\)/);
  assert.match(workspace, /organisation_id=eq\.\$\{encodeURIComponent\(organisationId\)\}/);
  assert.match(wizard, /status !== "disconnected"/);
  assert.match(wizard, /googleApproved && slackApproved/);
  assert.doesNotMatch(wizard, /useState\(true\)/);
});

test("Google and Slack retain separate explicit consent actions", async () => {
  const wizard = await source("app/integrations/integration-setup.tsx");
  assert.match(wizard, /EXPLICIT OAUTH CONSENT/);
  assert.match(wizard, /provider === "slack" \? "\/auth\/slack" : "\/auth\/integrations\/google"/);
  assert.match(wizard, /provider === "slack" && !googleApproved/);
  assert.match(wizard, /Opens the provider consent screen/);
});

test("browser steps complete only after the extension pairing handshake", async () => {
  const [wizard, extension] = await Promise.all([
    source("app/integrations/integration-setup.tsx"),
    source("extension/content.js"),
  ]);
  assert.match(wizard, /data-found-pair-status/);
  assert.match(wizard, /MutationObserver/);
  assert.match(wizard, /textContent\?\.trim\(\) === "Browser connected\."/);
  assert.match(wizard, /browserPaired \? <Link href="\/workspace">ENTER DASHBOARD/);
  assert.match(extension, /fetch\("\/api\/browser\/session"/);
  assert.match(extension, /chrome\.storage\.local\.set/);
  assert.match(extension, /status\.textContent = "Browser connected\."/);
});

test("onboarding does not alter protected extension or auth callback surfaces", async () => {
  const tracked = await source("app/integrations/integration-setup.tsx");
  assert.doesNotMatch(tracked, /access_token|refresh_token|integration_secrets/);
});
