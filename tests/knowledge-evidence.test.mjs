import assert from "node:assert/strict";
import test from "node:test";
import { selectEvidenceExcerpt } from "../lib/integrations/knowledge-evidence.mjs";

test("selects the matching order row from a large spreadsheet receipt", () => {
  const header = "order_id,customer_name,dispatch_ready,blocker,owner,next_action";
  const filler = Array.from({ length: 120 }, (_, index) => `RLP-${7000 + index},Customer ${index},YES,,Owner ${index},Dispatch`).join("\n");
  const body = `${header}\n${filler}\nRLP-7842,Aarav Mehta,NO,QC photo missing,Neha Kapoor,Upload QC photo`;
  const excerpt = selectEvidenceExcerpt(body, "Is order RLP-7842 ready for dispatch? What is blocking it and who owns the next action?");
  assert.match(excerpt, new RegExp(`^${header}`));
  assert.match(excerpt, /RLP-7842,Aarav Mehta,NO,QC photo missing,Neha Kapoor,Upload QC photo/);
  assert.ok(excerpt.length <= 1_200);
});

test("selects relevant document context without inventing content", () => {
  const body = `${"General background.\n".repeat(120)}The call-center launch is blocked by telecom approval.\nPriya owns the carrier escalation.\nThe next action is to submit the compliance pack.`;
  const excerpt = selectEvidenceExcerpt(body, "What blocks the call-center launch and who owns it?");
  assert.match(excerpt, /blocked by telecom approval/);
  assert.match(excerpt, /Priya owns/);
  assert.doesNotMatch(excerpt, /security deposit/);
});

test("uses a bounded prefix only when there is no lexical anchor", () => {
  const body = "A".repeat(2_000);
  assert.equal(selectEvidenceExcerpt(body, "unrelated query", 200), "A".repeat(200));
});
