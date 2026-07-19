import assert from "node:assert/strict";
import test from "node:test";
import { parseHermesPriorWorkDecision, parseHermesSlackAnswer } from "../lib/integrations/slack-hermes-contract.mjs";

const records = [
  { title: "Dynamic security deposits", source_url: "https://example.com/deposit" },
  { title: "Harness engineering", source_url: "https://example.com/harness" },
];

test("only strong exact, same-idea, or conflict decisions pass", () => {
  for (const classification of ["exact", "same_idea", "conflict"]) {
    const result = parseHermesPriorWorkDecision(JSON.stringify({ show: true, confidence: 85, classification, candidate: 1, reason: "Same intervention." }), 2);
    assert.equal(result?.classification, classification);
    assert.equal(result?.candidateIndex, 0);
  }
});

test("weak, tangential, invalid, malformed, and hidden matches fail closed", () => {
  const rejected = [
    { show: true, confidence: 84, classification: "exact", candidate: 1 },
    { show: false, confidence: 99, classification: "exact", candidate: 1 },
    { show: true, confidence: 99, classification: "tangential", candidate: 1 },
    { show: true, confidence: 99, classification: "no_match", candidate: 1 },
    { show: true, confidence: 99, classification: "exact", candidate: 3 },
    { show: true, confidence: 101, classification: "exact", candidate: 1 },
    { show: true, confidence: 85, classification: "exact", candidate: 1.9 },
  ];
  for (const value of rejected) assert.equal(parseHermesPriorWorkDecision(JSON.stringify(value), 2), null);
  assert.equal(parseHermesPriorWorkDecision("not-json", 2), null);
});

test("Slack answers expose only Hermes-validated source IDs", () => {
  const result = parseHermesSlackAnswer(JSON.stringify({ verdict: "answer", answer: "The approved policy keeps a reduced deposit.", sources: [1] }), records);
  assert.equal(result.verdict, "answer");
  assert.deepEqual(result.sources, [{ title: records[0].title, url: records[0].source_url }]);
  assert.throws(
    () => parseHermesSlackAnswer(JSON.stringify({ verdict: "answer", answer: "Unsupported source padding.", sources: [1, 1, 99] }), records),
    /Invalid Hermes Slack answer sources/,
  );
});

test("Slack answer contract preserves silence and insufficiency", () => {
  assert.deepEqual(parseHermesSlackAnswer(JSON.stringify({ verdict: "no_reply", answer: "", sources: [] }), records), { answer: "NO_REPLY", sources: [], verdict: "no_reply" });
  assert.deepEqual(parseHermesSlackAnswer(JSON.stringify({ verdict: "insufficient", answer: "anything", sources: [1] }), records), {
    answer: "I couldn’t find enough evidence in company knowledge to answer this.",
    sources: [],
    verdict: "insufficient",
  });
  assert.throws(() => parseHermesSlackAnswer(JSON.stringify({ verdict: "answer", answer: "Unsupported", sources: [] }), records), SyntaxError);
});
