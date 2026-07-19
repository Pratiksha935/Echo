import assert from "node:assert/strict";
import test from "node:test";
import { classifySlackMessageText, isDirectSlackKnowledgeQuestion, isSlackDmKnowledgeQuestion } from "../lib/integrations/slack-message-gate.mjs";

test("recognises ordinary Slack work questions without a slash command", () => {
  const question = "Is order RLP-7842 ready for dispatch? What is blocking it and who owns the next action?";
  assert.equal(isDirectSlackKnowledgeQuestion(question), true);
  assert.equal(classifySlackMessageText(question), "DIRECT_KNOWLEDGE_QUESTION");
});

test("recognises private conversation follow-ups", () => {
  assert.equal(isDirectSlackKnowledgeQuestion("Tell me more"), false);
  assert.equal(classifySlackMessageText("Tell me more", () => false), "CASUAL");
  assert.equal(isSlackDmKnowledgeQuestion("Tell me more"), true);
  assert.equal(isSlackDmKnowledgeQuestion("Was this implemented?"), true);
  assert.equal(isSlackDmKnowledgeQuestion("Show me the sources"), true);
});

test("keeps casual coordination and catalogue queries silent", () => {
  assert.equal(classifySlackMessageText("Let's go for lunch at 1"), "CASUAL");
  assert.equal(classifySlackMessageText("Is anyone free for coffee?"), "CASUAL");
  assert.equal(classifySlackMessageText("red saree under ₹2,000"), "CATALOGUE_QUERY");
});

test("preserves work intent without treating it as a direct question", () => {
  assert.equal(classifySlackMessageText("We should launch the approved campaign next week", () => true), "WORK_INTENT");
});
