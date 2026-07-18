const STOP_WORDS = new Set(["about", "after", "again", "already", "also", "article", "being", "could", "from", "have", "into", "latest", "must", "page", "should", "source", "status", "team", "that", "their", "there", "these", "this", "title", "what", "when", "where", "which", "with", "would"]);
const GENERIC_TERMS = new Set(["approved", "browser", "company", "current", "department", "document", "evidence", "found", "google", "indexed", "knowledge", "latest", "memory", "notion", "owner", "page", "product", "record", "slack", "source", "status", "team", "title", "update", "window", "work"]);
const DOMAIN_TERMS = {
  Engineering: ["backstage", "canary", "catalog", "catalogue", "deployment", "developer", "dora", "engineering", "feature flag", "golden path", "guardrail", "harness", "incident", "internal developer portal", "platform", "postmortem", "progressive delivery", "rollback", "runbook", "scorecard", "service catalog", "service catalogue", "slo"],
  Product: ["clean return", "damage free", "deposit", "event", "fit", "inventory", "renter", "rental", "return reminder", "security deposit", "trusted renter", "wedding"],
  Sales: ["abm", "account", "customer", "pilot", "proof of value", "roi", "sales", "success metric"],
  GTM: ["campaign", "gtm", "launch", "marketing", "pipeline"],
  Research: ["article", "market", "research"],
  Browser: [],
};

/**
 * Match an open browser page against records already filtered to one authorised organisation.
 * The function is deliberately pure so the exact retrieval contract can be exercised end to end.
 * @param {{records: Array<{authorName: string|null, body: string, department: string|null, externalId: string, source: string, sourceUrl: string, status: string, title: string}>, pageText: string, pageTitle: string, pageUrl: string}} input
 */
export function matchBrowserKnowledge({ records, pageText, pageTitle, pageUrl }) {
  const pageResourceId = googleResourceId(pageUrl);
  const sourceRecord = sourceRecordForPage(records, pageResourceId, pageUrl);
  const pageCorpus = normaliseText(`${pageUrl} ${pageTitle} ${pageText}`);
  const sourceCorpus = normaliseText(`${sourceRecord?.title ?? ""} ${sourceRecord?.body ?? ""}`);
  const includeSourceAsQuery = sourceRecord && trustedCompanySource(sourceRecord);
  const query = [includeSourceAsQuery ? sourceCorpus : "", pageCorpus, stemmedText(includeSourceAsQuery ? sourceCorpus : ""), stemmedText(pageCorpus)].filter(Boolean).join(" ");
  const terms = uniqueTokens(query).slice(0, 120);
  const pageDomains = inferDomains(`${pageUrl} ${pageTitle} ${pageText}`);
  const ranked = records.map(record => {
    const title = normaliseText(record.title);
    const evidence = normaliseText(`${record.title} ${record.body} ${record.department ?? ""}`);
    const phrases = importantPhrases(record);
    const matchedPhrases = phrases.filter(phrase => phraseAppears(query, phrase));
    const matchedTerms = terms.filter(term => !GENERIC_TERMS.has(term) && evidence.includes(term));
    const phraseScore = matchedPhrases.reduce((total, phrase) => total + (title.includes(phrase) ? 8 : 5), 0);
    const termScore = matchedTerms.reduce((total, term) => total + (title.includes(term) ? 2 : 1), 0);
    const domainScore = domainOverlapScore(record, pageCorpus);
    const score = phraseScore + Math.min(8, termScore) + domainScore;
    return { record, terms: [...matchedPhrases, ...matchedTerms], matchedPhrases, matchedTerms: matchedTerms.length, score };
  }).filter(candidate => candidate.record.externalId !== sourceRecord?.externalId)
    .filter(candidate => domainCompatible(candidate.record, pageDomains, sourceRecord))
    .filter(candidate => candidate.score >= 12 && (candidate.matchedPhrases.length >= 1 || domainOverlapScore(candidate.record, pageCorpus) >= 9) && candidate.matchedTerms >= 2)
    .sort((a, b) => b.score - a.score);

  const sameDecisionRecord = sourceRecord
    ? records.find(record => record.externalId !== sourceRecord.externalId && normaliseTitle(record.title) === normaliseTitle(sourceRecord.title))
    : null;
  const best = ranked[0]
    ?? (sameDecisionRecord ? { record: sameDecisionRecord, terms: ["same indexed decision"], matchedTerms: 2, score: 18 } : null)
    ?? (sourceRecord && trustedCompanySource(sourceRecord) ? { record: sourceRecord, terms: [], matchedTerms: terms.length, score: 12 } : null);
  if (!best) return null;
  const related = uniqueRecords([
    ...(sourceRecord ? [sourceRecord] : []),
    ...ranked.slice(0, 3).map(candidate => candidate.record),
    ...records.filter(record => normaliseTitle(record.title) === normaliseTitle(best.record.title)),
  ]);
  const sources = [...new Set(related.map(record => record.source))];
  const crossSource = Boolean(sourceRecord && best.record.externalId !== sourceRecord.externalId);
  const overlap = best.terms.slice(0, 4).join(", ");
  const insight = sourceRecord && crossSource
    ? `${best.record.source} evidence connected to this ${sourceRecord.source} document: ${best.record.body.slice(0, 320)}`
    : best.record.body.slice(0, 380);
  const whyMatches = crossSource && overlap
    ? `The open document and this ${best.record.source} record overlap on ${overlap}.`
    : "This page is an exact indexed company source.";

  return {
    id: best.record.externalId,
    links: related.slice(0, 4).map(record => ({ label: `${record.source} evidence`, url: record.sourceUrl })),
    live: true,
    owner: best.record.authorName ?? "Company knowledge",
    recommendation: crossSource
      ? `Review the ${best.record.source} evidence and current status before creating another proposal or ticket.`
      : "Open the indexed source receipts to review the latest company context.",
    score: Math.min(5, Math.max(2, Math.ceil(best.score / 6))),
    source: sources.join(" + "),
    status: best.record.status,
    summary: `${insight} ${whyMatches}`.slice(0, 520),
    title: best.record.title,
  };
}

function sourceRecordForPage(records, pageResourceId, pageUrl) {
  if (pageResourceId) {
    return records.find(record => record.externalId === pageResourceId)
      ?? records.find(record => googleResourceId(record.sourceUrl) === pageResourceId);
  }
  return records.find(record => canonicalUrl(record.sourceUrl) === canonicalUrl(pageUrl));
}

function normaliseTitle(value) {
  return normaliseText(value).replace(/^\[[^\]]+\]\s*/, "").trim();
}

function normaliseText(value) {
  return String(value || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function uniqueTokens(value) {
  return [...new Set(normaliseText(value).split(" ").map(stem).filter(term => term.length > 3 && !STOP_WORDS.has(term) && !GENERIC_TERMS.has(term)))];
}

function stemmedText(value) {
  return normaliseText(value).split(" ").map(stem).join(" ");
}

function stem(term) {
  if (term.endsWith("ies") && term.length > 5) return `${term.slice(0, -3)}y`;
  if (term.endsWith("s") && !term.endsWith("ss") && term.length > 4) return term.slice(0, -1);
  return term;
}

function importantPhrases(record) {
  const titleTokens = uniqueTokens(record.title);
  const bodyTokens = uniqueTokens(record.body).slice(0, 45);
  const phrases = new Set();
  addNgrams(phrases, titleTokens, 2, 5);
  addNgrams(phrases, bodyTokens, 2, 4);
  for (const phrase of Object.values(DOMAIN_TERMS).flat()) {
    const normalised = normaliseText(phrase);
    if (normaliseText(`${record.title} ${record.body}`).includes(normalised)) phrases.add(normalised);
  }
  return [...phrases].filter(phrase => phrase.split(" ").some(term => !GENERIC_TERMS.has(term)));
}

function addNgrams(target, tokens, min, max) {
  for (let size = min; size <= max; size += 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      target.add(tokens.slice(index, index + size).join(" "));
    }
  }
}

function phraseAppears(haystack, phrase) {
  const compact = ` ${haystack} `;
  if (compact.includes(` ${phrase} `)) return true;
  const tokens = phrase.split(" ");
  if (tokens.length === 2) return tokens.every(token => compact.includes(` ${token} `));
  return false;
}

function inferDomains(value) {
  const text = normaliseText(value);
  const domains = new Set();
  for (const [domain, terms] of Object.entries(DOMAIN_TERMS)) {
    if (terms.some(term => text.includes(normaliseText(term)))) domains.add(domain);
  }
  return domains;
}

function domainCompatible(record, pageDomains, sourceRecord) {
  if (sourceRecord && normaliseTitle(sourceRecord.title) === normaliseTitle(record.title)) return true;
  const department = record.department || "Browser";
  if (!pageDomains.size) return true;
  if (pageDomains.has(department)) return true;
  if (department === "Browser" || department === "Research") return true;
  return false;
}

function domainOverlapScore(record, pageCorpus) {
  const terms = DOMAIN_TERMS[record.department || ""] || [];
  return terms.filter(term => pageCorpus.includes(normaliseText(term))).length * 3;
}

function trustedCompanySource(record) {
  return Boolean(record && !/^browser$/i.test(record.source));
}

function googleResourceId(value) {
  try {
    const url = new URL(value);
    if (!/(^|\.)google\.com$/.test(url.hostname)) return null;
    return url.pathname.match(/\/(?:document|spreadsheets|presentation|file)\/d\/([^/]+)/)?.[1] ?? url.searchParams.get("id");
  } catch {
    return null;
  }
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return value;
  }
}

function uniqueRecords(records) {
  const seen = new Set();
  return records.filter(record => {
    if (!record?.source || !record?.sourceUrl || !record?.externalId) return false;
    const key = `${record.source}:${record.externalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
