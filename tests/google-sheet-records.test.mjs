import assert from "node:assert/strict";
import test from "node:test";
import { buildGoogleSheetRows, extractStructuredIdentifiers, stableRowExternalId } from "../lib/integrations/google-sheet-records.ts";

const sourceUrl = "https://docs.google.com/spreadsheets/d/orders-2026/edit";

test("indexes an order row with dispatch, blocker, next-action, and owner evidence first", () => {
  const indexed = buildGoogleSheetRows({
    fileId: "orders-2026",
    fileName: "Rental dispatch tracker",
    generation: "generation-a",
    sourceUrl,
    grids: [{
      sheetId: 481,
      title: "Orders",
      values: [
        ["Daily dispatch operations"],
        [],
        ["Order ID", "Dispatch Status", "Ready for Dispatch", "Blocker", "Next Action", "Next Action Owner", "Customer Note"],
        ["RLP-7842", "On hold", "No", "Final QC photo missing", "Upload QC photo", "Meera Nair", "Event is Friday"],
      ],
    }],
  });

  assert.equal(indexed.rows.length, 1);
  const row = indexed.rows[0];
  assert.equal(row.title, "RLP-7842 · Rental dispatch tracker");
  assert.equal(row.authorName, "Meera Nair");
  assert.equal(row.status, "On hold");
  assert.equal(row.metadata.record_kind, "sheet_row");
  assert.equal(row.metadata.row_key, "RLP-7842");
  assert.equal(row.metadata.row_key_normalized, "RLP-7842");
  assert.equal(row.metadata.blocker, "Final QC photo missing");
  assert.equal(row.metadata.next_action, "Upload QC photo");
  assert.equal(row.metadata.owner, "Meera Nair");
  assert.equal(row.metadata.ready_for_dispatch, "No");
  assert.equal(row.metadata.row_number, 4);
  assert.match(row.sourceUrl, /#gid=481&range=4%3A4$/);
  assert.deepEqual(row.body.split("\n").slice(0, 6), [
    "Order ID: RLP-7842",
    "Dispatch Status: On hold",
    "Ready for Dispatch: No",
    "Blocker: Final QC photo missing",
    "Next Action: Upload QC photo",
    "Next Action Owner: Meera Nair",
  ]);
});

test("keeps unique business-key IDs stable when rows move or operational fields change", () => {
  const first = buildGoogleSheetRows({
    fileId: "orders-2026",
    fileName: "Orders",
    generation: "one",
    sourceUrl,
    grids: [{ sheetId: 7, title: "Orders", values: [["Order ID", "Status"], ["RLP-7842", "Blocked"]] }],
  }).rows[0];
  const moved = buildGoogleSheetRows({
    fileId: "orders-2026",
    fileName: "Orders",
    generation: "two",
    sourceUrl,
    grids: [{ sheetId: 7, title: "Renamed Orders", values: [["Updated nightly"], ["Order ID", "Status"], ["RLP-1000", "Ready"], ["RLP-7842", "Ready"]] }],
  }).rows.find(row => row.metadata.row_key === "RLP-7842");

  assert.ok(moved);
  assert.equal(first.externalId, moved.externalId);
  assert.notEqual(first.metadata.row_number, moved.metadata.row_number);
  assert.equal(first.externalId, stableRowExternalId({ fileId: "orders-2026", key: "RLP-7842", rowNumber: 999, sheetId: 7 }));
});

test("falls back to row-position IDs for duplicate or missing business keys", () => {
  const indexed = buildGoogleSheetRows({
    fileId: "orders-2026",
    fileName: "Orders",
    generation: "generation-a",
    sourceUrl,
    grids: [{
      sheetId: 9,
      title: "Orders",
      values: [["Order ID", "Status"], ["RLP-42", "Ready"], ["RLP-42", "Blocked"], ["", "Queued"]],
    }],
  });

  assert.deepEqual(indexed.rows.map(row => row.externalId), [
    "orders-2026:sheet:9:row:2",
    "orders-2026:sheet:9:row:3",
    "orders-2026:sheet:9:row:4",
  ]);
  assert.ok(indexed.rows.every(row => row.metadata.row_key === undefined));
});

test("does not invent an operational owner when a row has no owner field", () => {
  const row = buildGoogleSheetRows({
    fileId: "orders-2026",
    fileName: "Orders",
    generation: "generation-a",
    sourceUrl,
    grids: [{ sheetId: 9, title: "Orders", values: [["Order ID", "Ready for Dispatch"], ["RLP-7842", "No"]] }],
  }).rows[0];

  assert.equal(row.authorName, null);
  assert.equal(row.metadata.owner, undefined);
  assert.equal(row.status, "Ready for dispatch: No");
});

test("indexes every worksheet and reports a concise file-level manifest", () => {
  const indexed = buildGoogleSheetRows({
    fileId: "operations",
    fileName: "Operations",
    generation: "generation-a",
    sourceUrl,
    grids: [
      { sheetId: 1, title: "Orders", values: [["Order ID", "Status"], ["RLP-1", "Ready"]] },
      { sheetId: 2, title: "Returns", values: [["Return ID", "Owner"], ["RET-8", "Kabir"]] },
    ],
  });

  assert.equal(indexed.rows.length, 2);
  assert.equal(indexed.manifest.worksheetCount, 2);
  assert.equal(indexed.manifest.rowCount, 2);
  assert.match(indexed.manifest.body, /Worksheet: Orders · 1 row/);
  assert.match(indexed.manifest.body, /Worksheet: Returns · 1 row/);
  assert.match(indexed.manifest.body, /Rows indexed: 2/);
});

test("extracts structured identifiers for exact retrieval without generic words", () => {
  assert.deepEqual(
    extractStructuredIdentifiers("Is order RLP-7842 ready? Compare rlp-7842 with RET/008 and status."),
    ["RLP-7842", "RET/008"],
  );
});
