import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserMatchHandler } from "../lib/browser/match-route.js";
import { matchBrowserKnowledge } from "../lib/browser/matcher.js";

const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const documentId = "1tYUQ-GVmVVtRgHbBrjc3I1O7X-faVi0NmYJzSwpnQGc";
const token = {
  email: "member@example.com",
  organisationId: "org-a",
  organisationName: "Acme",
  userId: "user-1",
};
const rows = [{
  author_name: "Rohan Desai",
  body: "Customers become trusted renters after five completed, on-time, damage-free returns.",
  department: "Product",
  external_id: documentId,
  metadata: { status: "Experiment approved" },
  source: "Google Docs",
  source_url: `https://docs.google.com/document/d/${documentId}/edit?usp=drivesdk`,
  title: "Dynamic security deposits for trusted renters",
}];

function request(body, bearer = "valid") {
  return new Request("https://found.example/api/browser/match", {
    body: JSON.stringify(body),
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", origin },
    method: "POST",
  });
}

function handler({ member = true, records = rows, verifyToken = value => value === "valid" ? token : null } = {}) {
  const paths = [];
  const handle = createBrowserMatchHandler({
    matchKnowledge: matchBrowserKnowledge,
    query: async path => {
      paths.push(path);
      return path.startsWith("/memberships") ? (member ? [{ id: "membership-1" }] : []) : records;
    },
    reportError: () => {},
    verifyToken,
  });
  return { handle, paths };
}

test("a valid token revalidates membership and matches an exact Google Doc URL within its tenant", async () => {
  const { handle, paths } = handler();
  const response = await handle(request({
    pageText: "",
    pageTitle: "Dynamic security deposits for trusted renters - Google Docs",
    pageUrl: `https://docs.google.com/document/d/${documentId}/edit?tab=t.0`,
  }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.match.id, documentId);
  assert.equal(payload.match.account.email, token.email);
  assert.match(paths[0], /organisation_id=eq\.org-a/);
  assert.match(paths[0], /user_id=eq\.user-1/);
  assert.match(paths[1], /knowledge_records/);
  assert.match(paths[1], /organisation_id=eq\.org-a/);
});

test("a valid member receives match null when no knowledge matches", async () => {
  const { handle } = handler({ records: [] });
  const response = await handle(request({ pageText: "Lunch at one?", pageTitle: "Untitled", pageUrl: "https://example.com/unindexed" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { match: null });
});

test("an expired token is rejected before membership or knowledge access", async () => {
  const { handle, paths } = handler({ verifyToken: () => null });
  const response = await handle(request({ pageTitle: "Document", pageUrl: "https://docs.google.com/" }, "expired"));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthorized" });
  assert.deepEqual(paths, []);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
});

test("revoked membership is rejected before knowledge retrieval", async () => {
  const { handle, paths } = handler({ member: false });
  const response = await handle(request({ pageTitle: "Document", pageUrl: "https://docs.google.com/" }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "workspace_access_revoked" });
  assert.equal(paths.length, 1);
  assert.match(paths[0], /organisation_id=eq\.org-a/);
  assert.match(paths[0], /user_id=eq\.user-1/);
});

test("dependency failures return safe operation-specific categories", async () => {
  const reports = [];
  const membershipFailure = createBrowserMatchHandler({
    matchKnowledge: matchBrowserKnowledge,
    query: async () => { throw new Error("private upstream detail"); },
    reportError: category => reports.push(category),
    verifyToken: () => token,
  });
  const membershipResponse = await membershipFailure(request({ pageTitle: "Document" }));
  assert.equal(membershipResponse.status, 503);
  assert.deepEqual(await membershipResponse.json(), { error: "membership_check_unavailable" });
  assert.deepEqual(reports, ["browser_match_membership_check_failed"]);
});
