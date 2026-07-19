const TOKEN = /[a-z0-9]+(?:-[a-z0-9]+)+|[a-z0-9]{4,}/gi;

/**
 * Selects the part of a source receipt that answers the current question.
 * Structured identifiers (for example RLP-7842) receive the highest weight,
 * so a row deep inside a large sheet is not hidden by a fixed prefix slice.
 */
export function selectEvidenceExcerpt(body, question, maxLength = 1_200) {
  const text = String(body ?? "").replace(/\r/g, "").trim();
  if (!text || maxLength < 80) return text.slice(0, Math.max(0, maxLength));
  if (text.length <= maxLength) return text;

  const terms = [...new Set((String(question ?? "").toLowerCase().match(TOKEN) ?? []))];
  if (!terms.length) return text.slice(0, maxLength);
  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  const csvHeader = looksLikeDelimitedRow(lines[0]) ? lines[0] : null;
  const ranked = lines.map((line, index) => ({ index, line, score: evidenceScore(line, terms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const best = ranked[0];
  if (!best || best.score <= 0) return text.slice(0, maxLength);

  if (csvHeader) {
    const selected = [csvHeader];
    for (const item of ranked) {
      if (item.index === 0 || item.score <= 0 || selected.includes(item.line)) continue;
      selected.push(item.line);
      if (selected.join("\n").length >= maxLength * 0.8 || selected.length >= 5) break;
    }
    return selected.join("\n").slice(0, maxLength);
  }

  const context = lines.slice(Math.max(0, best.index - 1), Math.min(lines.length, best.index + 2)).join("\n");
  return context.slice(0, maxLength);
}

function evidenceScore(line, terms) {
  const value = line.toLowerCase();
  return terms.reduce((score, term) => {
    if (!value.includes(term)) return score;
    return score + (term.includes("-") || /\d/.test(term) ? 8 : 1);
  }, 0);
}

function looksLikeDelimitedRow(line = "") {
  return (line.match(/,/g) ?? []).length >= 2 || (line.match(/\t/g) ?? []).length >= 2;
}
