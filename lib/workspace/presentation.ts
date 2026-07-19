import { readHermesKnowledgeNormalization } from "./knowledge-normalization.ts";

export type KnowledgePresentationKind = "article" | "conversation" | "document" | "record" | "spreadsheet";

export type KnowledgePresentationInput = {
  body: string;
  metadata?: Record<string, unknown> | null;
  source: string;
  sourceUrl?: string;
  title: string;
};

export type KnowledgePresentationField = {
  label: string;
  value: string;
};

export type KnowledgePresentation = {
  columns: string[];
  eyebrow: string;
  fields: KnowledgePresentationField[];
  kind: KnowledgePresentationKind;
  rows: string[][];
  summary: string;
  title: string;
};

const MAX_COLUMNS = 8;
const MAX_ROWS = 8;
const MAX_CSV_SCAN_ROWS = 60;

export function presentKnowledgeRecord(input: KnowledgePresentationInput): KnowledgePresentation {
  const kind = presentationKind(input);
  if (kind === "spreadsheet") return presentSpreadsheet(input);
  const normalized = readHermesKnowledgeNormalization(input.metadata);
  const normalizedTitle = safeNormalizedTitle(normalized?.title);

  return {
    columns: [],
    eyebrow: eyebrowFor(kind, normalized?.type),
    fields: [],
    kind,
    rows: [],
    summary: normalized?.summary ? compactText(normalized.summary, 240) : summarizeKnowledgeText(input.body),
    title: normalizedTitle ?? safeNarrativeTitle(input.title, kind, input.source, input.sourceUrl),
  };
}

export function summarizeKnowledgeText(value: string, max = 240): string {
  const clean = cleanText(value);
  if (!clean) return "No readable summary was indexed for this source.";
  const [note, capturedContext] = clean.split(/Captured page context:/i);
  const primary = compactNarrative(note, Math.min(max, 200));
  if (!capturedContext?.trim()) return primary;
  const context = compactNarrative(capturedContext, Math.min(160, max));
  return compactText([primary, context ? `Captured page: ${context}` : ""].filter(Boolean).join(" "), max);
}

function presentSpreadsheet(input: KnowledgePresentationInput): KnowledgePresentation {
  if (isSheetRow(input.metadata)) return presentSheetRow(input);
  const normalized = readHermesKnowledgeNormalization(input.metadata);
  const table = spreadsheetTable(input.body);
  const safeSourceTitle = safeNormalizedTitle(normalized?.title) ?? safeSpreadsheetSourceTitle(input.title);
  if (!table) {
    return {
      columns: [],
      eyebrow: "SPREADSHEET EVIDENCE",
      fields: [],
      kind: "spreadsheet",
      rows: [],
      summary: normalized?.summary ? compactText(normalized.summary, 240) : "A spreadsheet source was indexed, but no readable tabular rows were available for display.",
      title: safeSourceTitle ?? "Spreadsheet record",
    };
  }

  const identity = identityField(table.columns, table.rows[0]);
  const title = safeSourceTitle && !isGenericSpreadsheetTitle(safeSourceTitle)
    ? safeSourceTitle
    : spreadsheetLabel(identity, table.rows.length);
  const fields = table.rows.length === 1
    ? table.columns.map((label, index) => ({ label, value: table.rows[0][index] ?? "" })).filter(field => field.value).slice(0, MAX_COLUMNS)
    : [
      { label: "Rows", value: String(table.totalRows) },
      { label: "Columns", value: String(table.totalColumns) },
    ];
  const summary = normalized?.summary ? compactText(normalized.summary, 240) : table.rows.length === 1
    ? compactText(fields.slice(0, 5).map(field => `${field.label}: ${field.value}`).join(" · "), 240)
    : `${table.totalRows} spreadsheet rows. Columns: ${table.columns.slice(0, 6).join(", ")}${table.totalColumns > 6 ? ", and more" : ""}.`;

  return {
    columns: table.columns,
    eyebrow: "SPREADSHEET EVIDENCE",
    fields,
    kind: "spreadsheet",
    rows: table.rows,
    summary,
    title,
  };
}

function presentSheetRow(input: KnowledgePresentationInput): KnowledgePresentation {
  const normalized = readHermesKnowledgeNormalization(input.metadata);
  const metadataFields = sheetRowFields(input.metadata);
  const bodyTable = spreadsheetTable(input.body);
  const fields = (metadataFields.length
    ? metadataFields
    : bodyTable?.columns.map((label, index) => ({ label, value: bodyTable.rows[0]?.[index] ?? "" })) ?? [])
    .filter(field => field.value)
    .slice(0, MAX_COLUMNS);
  const columns = fields.map(field => field.label);
  const row = fields.map(field => field.value);
  const identity = identityField(columns, row);
  const safeSourceTitle = safeNormalizedTitle(normalized?.title) ?? safeSpreadsheetSourceTitle(input.title);
  const title = safeNormalizedTitle(normalized?.title) ?? (identity
    ? spreadsheetLabel(identity, 1)
    : safeSourceTitle && !isGenericSpreadsheetTitle(safeSourceTitle)
      ? safeSourceTitle
      : "Spreadsheet row");
  const summaryFields = orderedSummaryFields(fields, identity).slice(0, 5);
  const summary = normalized?.summary ? compactText(normalized.summary, 240) : summaryFields.length
    ? compactText(summaryFields.map(field => `${field.label}: ${field.value}`).join(" · "), 240)
    : "A spreadsheet row was indexed, but no readable field values were available for display.";

  return {
    columns,
    eyebrow: "SPREADSHEET EVIDENCE",
    fields,
    kind: "spreadsheet",
    rows: row.length ? [row] : [],
    summary,
    title,
  };
}

function sheetRowFields(metadata?: Record<string, unknown> | null): KnowledgePresentationField[] {
  if (!metadata) return [];
  const normalized = readHermesKnowledgeNormalization(metadata);
  const headers = Array.isArray(metadata.headers)
    ? metadata.headers.map(header => humanLabel(readableValue(header))).filter(Boolean)
    : [];
  const rawFields = metadata.fields;
  const normalizedFields = normalized?.facts.map(fact => ({ label: humanLabel(fact.label), value: readableValue(fact.value) })) ?? [];
  let indexedFields: KnowledgePresentationField[] = [];

  if (isPlainObject(rawFields)) {
    indexedFields = Object.entries(rawFields).map(([label, value]) => ({ label: humanLabel(label), value: readableValue(value) }));
  } else if (Array.isArray(rawFields)) {
    const namedFields = rawFields.flatMap(item => {
      if (!isPlainObject(item)) return [];
      const label = readableValue(item.label ?? item.header ?? item.name ?? item.key);
      if (label) return [{ label: humanLabel(label), value: readableValue(item.value ?? item.content ?? item.text) }];
      return Object.entries(item).map(([key, value]) => ({ label: humanLabel(key), value: readableValue(value) }));
    });
    indexedFields = namedFields.length
      ? namedFields
      : rawFields.map((value, index) => ({ label: headers[index] ?? `Column ${index + 1}`, value: readableValue(value) }));
  }
  const fields = [...normalizedFields];
  for (const field of indexedFields) {
    if (!fields.some(existing => normaliseFieldLabel(existing.label) === normaliseFieldLabel(field.label))) fields.push(field);
  }

  const directFields: Array<[string, unknown]> = [
    ["Row key", metadata.row_key ?? metadata.rowKey],
    ["Row number", metadata.row_number ?? metadata.rowNumber],
    ["Owner", normalized?.owner ?? metadata.owner],
    ["Status", normalized?.status ?? metadata.status],
    ["Blocker", metadata.blocker],
    ["Next action", normalized?.nextAction ?? metadata.next_action ?? metadata.nextAction],
    ["Ready for dispatch", metadata.ready_for_dispatch ?? metadata.readyForDispatch],
  ];
  for (const [label, value] of directFields) {
    const readable = readableValue(value);
    const duplicatesIdentity = normaliseFieldLabel(label) === "row key" && fields.some(field => field.value === readable);
    if (readable && !duplicatesIdentity && !fields.some(field => normaliseFieldLabel(field.label) === normaliseFieldLabel(label))) fields.push({ label, value: readable });
  }

  const seen = new Set<string>();
  return fields.filter(field => {
    const key = normaliseFieldLabel(field.label);
    if (!key || !field.value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function orderedSummaryFields(fields: KnowledgePresentationField[], identity: KnowledgePresentationField | null): KnowledgePresentationField[] {
  const identityKey = identity ? normaliseFieldLabel(identity.label) : "";
  const priority = ["status", "owner", "blocker", "next action", "ready for dispatch", "customer", "account"];
  return [...fields]
    .filter(field => normaliseFieldLabel(field.label) !== identityKey)
    .sort((left, right) => {
      const leftIndex = priority.indexOf(normaliseFieldLabel(left.label));
      const rightIndex = priority.indexOf(normaliseFieldLabel(right.label));
      return (leftIndex < 0 ? priority.length : leftIndex) - (rightIndex < 0 ? priority.length : rightIndex);
    });
}

function spreadsheetTable(value: string): { columns: string[]; rows: string[][]; totalColumns: number; totalRows: number } | null {
  const parsed = parseCsv(value, MAX_CSV_SCAN_ROWS);
  const headerIndex = parsed.findIndex((row, index) => row.length >= 2 && (parsed[index + 1]?.length ?? 0) >= 2);
  if (headerIndex < 0) return null;
  const rawColumns = parsed[headerIndex];
  const totalColumns = rawColumns.length;
  const columns = uniqueColumnLabels(rawColumns).slice(0, MAX_COLUMNS);
  const allRows = parsed.slice(headerIndex + 1).filter(row => row.some(cell => cleanText(cell)));
  if (!allRows.length) return null;
  return {
    columns,
    rows: allRows.slice(0, MAX_ROWS).map(row => columns.map((_, index) => compactText(row[index] ?? "", 120))),
    totalColumns,
    totalRows: allRows.length,
  };
}

function parseCsv(value: string, maxRows: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = value.replace(/\r\n?/g, "\n").slice(0, 40_000);

  const finishCell = () => {
    row.push(cleanText(cell));
    cell = "";
  };
  const finishRow = () => {
    finishCell();
    if (row.some(item => item)) rows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length && rows.length < maxRows; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"' && !cell) quoted = true;
    else if (character === ",") finishCell();
    else if (character === "\n") finishRow();
    else cell += character;
  }
  if ((cell || row.length) && rows.length < maxRows) finishRow();
  return rows;
}

function uniqueColumnLabels(values: string[]): string[] {
  const seen = new Map<string, number>();
  return values.map((value, index) => {
    const base = humanLabel(value) || `Column ${index + 1}`;
    const count = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), count);
    return count === 1 ? base : `${base} ${count}`;
  });
}

function identityField(columns: string[], row: string[] | undefined): KnowledgePresentationField | null {
  if (!row) return null;
  const priority = [
    /^(order)(?: id| number| no| #)?$/i,
    /^(invoice|ticket|case)(?: id| number| no| #)?$/i,
    /^row key$/i,
    /^(customer|account|campaign|project)$/i,
    /^id$/i,
  ];
  for (const pattern of priority) {
    const index = columns.findIndex(column => pattern.test(column));
    const value = index >= 0 ? row[index] : "";
    if (value) return { label: columns[index], value };
  }
  return null;
}

function spreadsheetLabel(identity: KnowledgePresentationField | null, rowCount: number): string {
  if (identity && rowCount === 1) {
    const noun = identity.label.replace(/\s+(?:id|number|no|#)$/i, "").trim() || "Record";
    return compactText(`${noun}: ${identity.value}`, 100);
  }
  if (identity) {
    const noun = identity.label.replace(/\s+(?:id|number|no|#)$/i, "").trim() || "Record";
    return `${pluralize(noun)} spreadsheet`;
  }
  return "Spreadsheet records";
}

function safeSpreadsheetSourceTitle(value: string): string | null {
  const clean = cleanText(value);
  if (!clean || looksLikeRawStructuredTitle(value)) return null;
  return compactText(clean, 100);
}

function safeNormalizedTitle(value?: string | null): string | null {
  if (!value || looksLikeRawStructuredTitle(value)) return null;
  return compactText(value, 120);
}

function safeNarrativeTitle(value: string, kind: KnowledgePresentationKind, source: string, sourceUrl?: string): string {
  const clean = cleanText(value);
  if (clean && !looksLikeRawStructuredTitle(value)) return compactText(clean, 120);
  if (kind === "document") return `${cleanSourceName(source, "Google")} document`;
  if (kind === "article") return articleFallback(sourceUrl);
  if (kind === "conversation") return `${cleanSourceName(source, "Company")} company update`;
  return `${cleanSourceName(source, "Knowledge")} record`;
}

function presentationKind(input: KnowledgePresentationInput): KnowledgePresentationKind {
  const normalizedType = readHermesKnowledgeNormalization(input.metadata)?.type?.toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  const source = `${input.source} ${input.sourceUrl ?? ""}`.toLowerCase();
  if (["sheet", "sheet_row", "spreadsheet", "spreadsheet_row", "tabular_record", "order_record"].includes(normalizedType) || isSheetRow(input.metadata) || /google sheets|spreadsheet|\.csv\b/.test(source) || looksLikeCsvTable(input.body)) return "spreadsheet";
  if (/browser|article|web research/.test(source)) return "article";
  if (/google docs|document|notion/.test(source)) return "document";
  if (/slack|conversation|message/.test(source)) return "conversation";
  return "record";
}

function isSheetRow(metadata?: Record<string, unknown> | null): boolean {
  const normalizedType = readHermesKnowledgeNormalization(metadata)?.type;
  const recordType = readableValue(metadata?.record_kind ?? metadata?.recordKind ?? metadata?.record_type ?? metadata?.recordType ?? normalizedType).toLowerCase().replace(/[\s-]+/g, "_");
  return recordType === "sheet_row";
}

function looksLikeCsvTable(value: string): boolean {
  const rows = parseCsv(value, 4);
  return rows.length >= 2 && rows[0].length >= 2 && rows[1].length >= 2;
}

function looksLikeRawStructuredTitle(value: string): boolean {
  const clean = cleanText(value);
  if (!clean) return true;
  if (/\r|\n/.test(value) || clean.length > 140) return true;
  const commas = (value.match(/,/g) ?? []).length;
  return commas >= 2;
}

function isGenericSpreadsheetTitle(value: string): boolean {
  return /^(?:untitled(?: spreadsheet)?|sheet\s*\d*|spreadsheet|csv export|export|data|orders?|order data)$/i.test(value.trim());
}

function eyebrowFor(kind: KnowledgePresentationKind, normalizedType?: string | null): string {
  if (kind === "document") return "DOCUMENT EVIDENCE";
  if (kind === "article") return "CAPTURED RESEARCH";
  if (kind === "conversation") return "CONVERSATION EVIDENCE";
  return normalizedType?.toLowerCase() === "decision" ? "VERIFIED DECISION" : "SOURCE RECORD";
}

function articleFallback(sourceUrl?: string): string {
  try {
    const host = new URL(sourceUrl ?? "").hostname.replace(/^www\./, "");
    return host ? `Captured research from ${host}` : "Captured research";
  } catch {
    return "Captured research";
  }
}

function compactNarrative(value: string, max: number): string {
  const clean = cleanText(value);
  if (!clean) return "";
  const sentence = clean.match(/^.{30,}?[.!?](?:\s|$)/)?.[0]?.trim();
  return compactText(sentence && sentence.length <= max ? sentence : clean, max);
}

function humanLabel(value: string): string {
  return compactText(cleanText(value).replace(/[_-]+/g, " "), 40).replace(/\b\w/g, character => character.toUpperCase());
}

function normaliseFieldLabel(value: string): string {
  return cleanText(value).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function readableValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return compactText(String(value), 120);
  if (Array.isArray(value)) return compactText(value.map(readableValue).filter(Boolean).join(", "), 120);
  if (isPlainObject(value)) {
    try { return compactText(JSON.stringify(value), 120); } catch { return ""; }
  }
  return "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanSourceName(value: string, fallback: string): string {
  return compactText(cleanText(value).replace(/[^a-z0-9 ._-]+/gi, ""), 40) || fallback;
}

function cleanText(value: string): string {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function compactText(value: string, max: number): string {
  const clean = cleanText(value);
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}

function pluralize(value: string): string {
  if (/s$/i.test(value)) return value;
  if (/y$/i.test(value)) return `${value.slice(0, -1)}ies`;
  return `${value}s`;
}
