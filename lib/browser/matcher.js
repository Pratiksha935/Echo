const STOP_WORDS = new Set(["about", "after", "again", "already", "could", "from", "have", "into", "should", "that", "their", "there", "these", "this", "what", "when", "where", "which", "with", "would"]);

/**
 * Match an open browser page against records already filtered to one authorised organisation.
 * The function is deliberately pure so the exact retrieval contract can be exercised end to end.
 * @param {{records: Array<{authorName: string|null, body: string, department: string|null, externalId: string, source: string, sourceUrl: string, status: string, title: string}>, pageText: string, pageTitle: string, pageUrl: string}} input
 */
export function matchBrowserKnowledge({ records, pageText, pageTitle, pageUrl }) {
  const pageResourceId = googleResourceId(pageUrl);
  const sourceRecord = pageResourceId
    ? records.find(record => record.externalId === pageResourceId || googleResourceId(record.sourceUrl) === pageResourceId)
    : records.find(record => canonicalUrl(record.sourceUrl) === canonicalUrl(pageUrl));
  const query = `${sourceRecord?.title ?? ""} ${sourceRecord?.body ?? ""} ${pageTitle} ${pageText}`.toLowerCase();
  const terms = [...new Set(query.split(/\W+/).filter(term => term.length > 3 && !STOP_WORDS.has(term)))].slice(0, 80);
  const ranked = records.map(record => {
    const title = record.title.toLowerCase();
    const evidence = `${record.title} ${record.body} ${record.department ?? ""}`.toLowerCase();
    const matchedTerms = terms.filter(term => evidence.includes(term));
    const score = matchedTerms.reduce((total, term) => total + (title.includes(term) ? 4 : 1), 0);
    return { record, terms: matchedTerms, matchedTerms: matchedTerms.length, score };
  }).filter(candidate => candidate.record.externalId !== sourceRecord?.externalId)
    .filter(candidate => candidate.score >= 5 && candidate.matchedTerms >= 2)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0] ?? (sourceRecord ? { record: sourceRecord, terms: [], matchedTerms: terms.length, score: 12 } : null);
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

function normaliseTitle(value) {
  return value.toLowerCase().replace(/^\[[^\]]+\]\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
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
    const key = `${record.source}:${record.externalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
