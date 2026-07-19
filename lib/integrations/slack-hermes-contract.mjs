function extractJson(response) {
  const text = String(response ?? "");
  return text.match(/\{[\s\S]*\}/)?.[0] ?? text;
}

export function parseHermesPriorWorkDecision(response, candidateCount) {
  try {
    const parsed = JSON.parse(extractJson(response));
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : Number.NaN;
    const classification = typeof parsed.classification === "string" ? parsed.classification : "";
    const candidateIndex = Number.isInteger(parsed.candidate) ? parsed.candidate - 1 : -1;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) return null;
    if (parsed.show !== true || confidence < 85 || !["exact", "same_idea", "conflict"].includes(classification)) return null;
    if (candidateIndex < 0 || candidateIndex >= candidateCount) return null;
    return {
      candidateIndex,
      classification,
      confidence: Math.round(confidence),
      reason: typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim().slice(0, 300)
        : "The message matches the same recorded intervention and outcome.",
    };
  } catch {
    return null;
  }
}

export function parseHermesSlackAnswer(response, records) {
  const parsed = JSON.parse(extractJson(response));
  if (parsed.verdict === "no_reply") return { answer: "NO_REPLY", sources: [], verdict: "no_reply" };
  if (parsed.verdict === "insufficient") {
    return { answer: "I couldn’t find enough evidence in company knowledge to answer this.", sources: [], verdict: "insufficient" };
  }
  const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
  if (!Array.isArray(parsed.sources) || !parsed.sources.length) {
    throw new SyntaxError("Invalid Hermes Slack answer contract.");
  }
  const indexes = parsed.sources;
  const validIndexes = indexes.every(value => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= records.length);
  if (!validIndexes || new Set(indexes).size !== indexes.length) {
    throw new SyntaxError("Invalid Hermes Slack answer sources.");
  }
  if (parsed.verdict !== "answer" || !answer || !indexes.length || answer === "NO_REPLY") {
    throw new SyntaxError("Invalid Hermes Slack answer contract.");
  }
  return {
    answer: answer.slice(0, 2_800),
    sources: indexes.map(index => ({ title: records[index - 1].title, url: records[index - 1].source_url })),
    verdict: "answer",
  };
}
