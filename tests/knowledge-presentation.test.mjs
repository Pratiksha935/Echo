import assert from "node:assert/strict";
import test from "node:test";
import { presentKnowledgeRecord } from "../lib/workspace/presentation.ts";

test("turns a raw order CSV record into a readable spreadsheet presentation", () => {
  const raw = [
    "Order ID,Customer,Status,Total,Dispatch owner",
    "RLP-7842,Meera Shah,Ready to dispatch,₹4,800,Aarav",
  ].join("\n");
  const presentation = presentKnowledgeRecord({
    body: raw,
    source: "Google Sheets",
    sourceUrl: "https://docs.google.com/spreadsheets/d/orders/edit",
    title: raw,
  });

  assert.equal(presentation.kind, "spreadsheet");
  assert.equal(presentation.eyebrow, "SPREADSHEET EVIDENCE");
  assert.equal(presentation.title, "Order: RLP-7842");
  assert.doesNotMatch(presentation.title, /Order ID,Customer/);
  assert.match(presentation.summary, /Status: Ready to dispatch/);
  assert.deepEqual(presentation.columns.slice(0, 3), ["Order ID", "Customer", "Status"]);
  assert.deepEqual(presentation.rows[0].slice(0, 3), ["RLP-7842", "Meera Shah", "Ready to dispatch"]);
});

test("presents a multi-row sheet as a bounded table instead of a giant decision body", () => {
  const raw = [
    "Order ID,Customer,Status,Notes",
    "RLP-1001,Asha,Blocked,Waiting for address confirmation",
    'RLP-1002,Rahul,Ready,"Courier booked, pickup at 4pm"',
    "RLP-1003,Nisha,Delivered,Receipt confirmed",
  ].join("\n");
  const presentation = presentKnowledgeRecord({ body: raw, source: "Google Sheets", title: "Orders" });

  assert.equal(presentation.title, "Orders spreadsheet");
  assert.equal(presentation.summary, "3 spreadsheet rows. Columns: Order ID, Customer, Status, Notes.");
  assert.deepEqual(presentation.fields, [{ label: "Rows", value: "3" }, { label: "Columns", value: "4" }]);
  assert.equal(presentation.rows.length, 3);
  assert.equal(presentation.rows[1][3], "Courier booked, pickup at 4pm");
  assert.ok(presentation.summary.length < 160);
});

test("keeps narrative documents and captured articles concise", () => {
  const document = presentKnowledgeRecord({
    body: "The team approved event-aware reminders for late returns. This preserves the courier rescheduling path. ".repeat(20),
    source: "Google Docs",
    title: "Late-return prevention",
  });
  const article = presentKnowledgeRecord({
    body: "Team note. Captured page context: A very long public article body about developer portals and service ownership. ".repeat(20),
    source: "Browser",
    sourceUrl: "https://example.com/research/developer-portals",
    title: "Developer portal research",
  });

  assert.equal(document.kind, "document");
  assert.equal(document.title, "Late-return prevention");
  assert.ok(document.summary.length <= 240);
  assert.equal(document.rows.length, 0);
  assert.equal(article.kind, "article");
  assert.match(article.summary, /^Team note\./);
  assert.match(article.summary, /Captured page:/);
  assert.ok(article.summary.length <= 240);
});

test("never labels CSV-shaped data as a verified decision even when its source type is wrong", () => {
  const presentation = presentKnowledgeRecord({
    body: "account,status,next_action\nAcme,At risk,Schedule proof-of-value review",
    source: "Imported record",
    title: "account,status,next_action",
  });

  assert.equal(presentation.kind, "spreadsheet");
  assert.equal(presentation.eyebrow, "SPREADSHEET EVIDENCE");
  assert.notEqual(presentation.title, "account,status,next_action");
});

test("does not overstate an arbitrary imported record as a verified decision", () => {
  const presentation = presentKnowledgeRecord({
    body: "Customer requested an address update.",
    source: "Imported record",
    title: "Account note",
  });

  assert.equal(presentation.kind, "record");
  assert.equal(presentation.eyebrow, "SOURCE RECORD");
});

test("presents independently indexed sheet rows from typed metadata", () => {
  const sourceUrl = "https://docs.google.com/spreadsheets/d/orders/edit#gid=0&range=A42:F42";
  const presentation = presentKnowledgeRecord({
    body: "RLP-9001,Meera Shah,Blocked,Aarav,Address missing,Confirm delivery address",
    metadata: {
      record_kind: "sheet_row",
      headers: ["Order ID", "Customer", "Status", "Owner", "Blocker", "Next Action"],
      fields: ["RLP-9001", "Meera Shah", "Blocked", "Aarav", "Address missing", "Confirm delivery address"],
      row_key: "RLP-9001",
      row_number: 42,
      owner: "Aarav",
      status: "Blocked",
      blocker: "Address missing",
      next_action: "Confirm delivery address",
      ready_for_dispatch: false,
    },
    source: "Google Sheets",
    sourceUrl,
    title: "Orders row 42",
  });

  assert.equal(presentation.title, "Order: RLP-9001");
  assert.equal(presentation.eyebrow, "SPREADSHEET EVIDENCE");
  assert.match(presentation.summary, /^Status: Blocked · Owner: Aarav · Blocker: Address missing · Next Action: Confirm delivery address/);
  assert.deepEqual(presentation.fields.slice(0, 3), [
    { label: "Order ID", value: "RLP-9001" },
    { label: "Customer", value: "Meera Shah" },
    { label: "Status", value: "Blocked" },
  ]);
  assert.ok(presentation.fields.some(field => field.label === "Ready for dispatch" && field.value === "No"));
});

test("prefers bounded Hermes normalization while retaining the raw-source fallback contract", () => {
  const presentation = presentKnowledgeRecord({
    body: "order_id,status,blocker\nRLP-9010,At risk,Courier capacity",
    metadata: {
      record_type: "sheet_row",
      normalized: {
        version: "hermes-knowledge-v1",
        type: "order_record",
        title: "Order RLP-9010 delivery risk",
        summary: "Order RLP-9010 is at risk because courier capacity is blocked.",
        facts: { order_id: "RLP-9010", status: "At risk", blocker: "Courier capacity" },
        entities: ["RLP-9010"],
        owner: "Operations",
        nextAction: "Assign a backup courier",
      },
    },
    source: "Google Sheets",
    sourceUrl: "https://docs.google.com/spreadsheets/d/orders/edit#range=A10:C10",
    title: "order_id,status,blocker",
  });

  assert.equal(presentation.title, "Order RLP-9010 delivery risk");
  assert.equal(presentation.summary, "Order RLP-9010 is at risk because courier capacity is blocked.");
  assert.deepEqual(presentation.fields.slice(0, 3), [
    { label: "Order Id", value: "RLP-9010" },
    { label: "Status", value: "At risk" },
    { label: "Blocker", value: "Courier capacity" },
  ]);
});
