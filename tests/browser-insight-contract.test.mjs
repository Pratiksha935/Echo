import assert from "node:assert/strict";
import test from "node:test";
import { matchBrowserKnowledge } from "../lib/browser/matcher.js";

const documentId = "1tYUQ-GVmVVtRgHbBrjc3I1O7X-faVi0NmYJzSwpnQGc";
const records = [
  {
    authorName: "Rohan Desai",
    body: "Customers become trusted renters after five completed, on-time, damage-free returns. Keep a 50% deposit reduction and do not remove the deposit completely.",
    department: "Product",
    externalId: documentId,
    source: "Google Docs",
    sourceUrl: `https://docs.google.com/document/d/${documentId}/edit?usp=drivesdk`,
    status: "Experiment approved",
    title: "Dynamic security deposits for trusted renters",
  },
  {
    authorName: "U08PRODUCT",
    body: "The approved policy is a 50% lower security deposit after five clean returns. The zero-deposit proposal was rejected.",
    department: "Product",
    externalId: "slack:C0BHQ2MCM2P:1784281557.141129",
    source: "Slack",
    sourceUrl: "https://app.slack.com/client/T08LC40MYVB/C0BHQ2MCM2P/p1784281557141129",
    status: "Latest Slack update",
    title: "Dynamic security deposits for trusted renters",
  },
];

const engineeringRecord = {
  authorName: "Vikram Rao",
  body: "Pilot running for one developer portal with a canonical service catalog, service owners, runbooks, dependency metadata, maturity scorecards, golden paths and Harness IDP evaluation.",
  department: "Engineering",
  externalId: "ENG-214",
  source: "Slack",
  sourceUrl: "https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX",
  status: "Pilot running",
  title: "Developer portal and service maturity scorecards",
};

test("the production document contract returns a cross-source actionable insight", () => {
  const match = matchBrowserKnowledge({
    pageText: "",
    pageTitle: "Dynamic security deposits for trusted renters - Google Docs",
    pageUrl: `https://docs.google.com/document/d/${documentId}/edit?tab=t.0`,
    records,
  });
  assert.ok(match);
  assert.equal(match.title, "Dynamic security deposits for trusted renters");
  assert.equal(match.status, "Latest Slack update");
  assert.match(match.summary, /Slack evidence connected to this Google Docs document/);
  assert.match(match.summary, /50% lower security deposit/);
  assert.match(match.recommendation, /Review the Slack evidence/);
  assert.deepEqual(match.links.map(link => link.label), ["Google Docs evidence", "Slack evidence"]);
});

test("unindexed and unrelated pages do not fabricate a battlecard", () => {
  const match = matchBrowserKnowledge({
    pageText: "Lunch at one?",
    pageTitle: "Untitled document",
    pageUrl: "https://docs.google.com/document/d/unindexed/edit",
    records,
  });
  assert.equal(match, null);
});

test("an exact indexed Google Doc URL matches without editor title or text", () => {
  const match = matchBrowserKnowledge({
    pageText: "",
    pageTitle: "",
    pageUrl: `https://docs.google.com/document/d/${documentId}/edit`,
    records: [records[0]],
  });
  assert.ok(match);
  assert.equal(match.id, documentId);
  assert.equal(match.title, "Dynamic security deposits for trusted renters");
  assert.match(match.summary, /exact indexed company source/);
});

test("Harness Engineering web pages match engineering portal memory, not product deposit memory", () => {
  const match = matchBrowserKnowledge({
    pageText: "Harness Engineering discusses internal developer portals, service catalog ownership metadata, scorecards, golden paths and platform engineering workflows.",
    pageTitle: "Harness Engineering - Martin Fowler",
    pageUrl: "https://martinfowler.com/articles/harness-engineering.html",
    records: [...records, engineeringRecord],
  });
  assert.ok(match);
  assert.equal(match.id, "ENG-214");
  assert.equal(match.title, "Developer portal and service maturity scorecards");
});

test("engineering articles do not cross-domain match product security-deposit records", () => {
  const match = matchBrowserKnowledge({
    pageText: "Harness Engineering covers developer experience, service ownership, platform scorecards and internal developer portals.",
    pageTitle: "Harness Engineering",
    pageUrl: "https://martinfowler.com/articles/harness-engineering.html",
    records,
  });
  assert.equal(match, null);
});
