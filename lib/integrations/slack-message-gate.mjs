export const CASUAL = /^(hi|hello|hey|thanks|thank you|ok|okay|done|sounds good|good morning|good night|let'?s (go|grab|have) (lunch|coffee)|anyone free for (lunch|coffee))[!.\s]*$/i;
export const CATALOGUE = /\b(saree|dress|lehenga|kurta|under\s*₹?\d+|size\s+[xsml]+)\b/i;

const SOCIAL_COORDINATION = /\b(lunch|coffee|dinner|drinks|birthday|weekend plans?)\b/i;
const COMPANY_KNOWLEDGE_OBJECT = /\b(order|dispatch|shipment|delivery|ready|block(?:ed|er|ing)?|owner|status|next action|decision|prior work|duplicate|company knowledge|source|receipt|ticket|jira|document|campaign|experiment|feature|implementation|customer|metric|measurement|proof of value|roi|project|initiative|policy|launch|slack|sheet|spreadsheet)\b/i;
const EXPLICIT_COMPANY_QUESTION = /\b(?:ask found|found\s+(?:ask|check)|company knowledge|prior work|duplicate|already\s+(?:decided|discussed|tried|built|measured|recorded)|has this been discussed|have we\s+(?:decided|discussed|tried|built|measured|recorded)|did we\s+(?:decide|discuss|try|build|measure|record)|what\s+(?:did|do|does|have|has|was|were)\s+(?:we|the company|customers?|team)|who\s+(?:owns|owned)|source receipt|what source|status|decision|decided|measurement problem|prove roi)\b/i;
const DM_CONTINUATION = /^(?:tell me more|show (?:me )?(?:the )?sources?|open (?:the )?(?:source|receipt)|was (?:it|this) implemented|what happened next|why|how|when|who|where)\b/i;

export function isDirectSlackKnowledgeQuestion(question, allowConversationContinuation = false) {
  const clean = String(question ?? "").trim();
  if (clean.length < 8 || CASUAL.test(clean) || SOCIAL_COORDINATION.test(clean) || CATALOGUE.test(clean)) return false;
  if (EXPLICIT_COMPANY_QUESTION.test(clean) || (allowConversationContinuation && DM_CONTINUATION.test(clean))) return true;
  const beginsAsQuestion = /^(?:is|are|was|were|has|have|had|did|do|does|what|when|where|who|why|how|which|can|could|should|would|will)\b/i.test(clean);
  return COMPANY_KNOWLEDGE_OBJECT.test(clean) && (beginsAsQuestion || clean.includes("?"));
}

export function isSlackDmKnowledgeQuestion(question) {
  return isDirectSlackKnowledgeQuestion(question, true);
}

/**
 * @param {unknown} text
 * @param {(text: string) => boolean} [isMeaningfulWork]
 */
export function classifySlackMessageText(text, isMeaningfulWork = () => false) {
  const clean = String(text ?? "").trim();
  if (!clean || CASUAL.test(clean) || SOCIAL_COORDINATION.test(clean)) return "CASUAL";
  if (CATALOGUE.test(clean)) return "CATALOGUE_QUERY";
  if (isDirectSlackKnowledgeQuestion(clean)) return "DIRECT_KNOWLEDGE_QUESTION";
  return isMeaningfulWork(clean) ? "WORK_INTENT" : "CASUAL";
}
