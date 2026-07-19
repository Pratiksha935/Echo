import { createHash } from "node:crypto";

export type GoogleSheetGrid = {
  sheetId: number;
  title: string;
  values: unknown[][];
};

export type GoogleSheetRowRecord = {
  authorName: string | null;
  body: string;
  externalId: string;
  metadata: {
    blocker?: string;
    google_file_id: string;
    google_sync_generation: string;
    next_action?: string;
    owner?: string;
    ready_for_dispatch?: string;
    record_kind: "sheet_row";
    row_key?: string;
    row_key_header?: string;
    row_key_normalized?: string;
    row_number: number;
    sheet_id: number;
    sheet_title: string;
    status: string;
  };
  sourceUrl: string;
  status: string;
  title: string;
};

export type GoogleSheetManifest = {
  body: string;
  rowCount: number;
  worksheetCount: number;
};

type ColumnRole = "blocker" | "identity" | "next_action" | "owner" | "ready" | "status";
type Column = { header: string; index: number; normalised: string; role?: ColumnRole };
type DataRow = { rowNumber: number; values: string[] };

const MAX_CELL_LENGTH = 1_000;
const MAX_ROW_BODY_LENGTH = 10_000;
const MAX_TITLE_KEY_LENGTH = 90;

export function buildGoogleSheetRows(input: {
  fileId: string;
  fileName: string;
  generation: string;
  grids: GoogleSheetGrid[];
  sourceUrl: string;
}): { manifest: GoogleSheetManifest; rows: GoogleSheetRowRecord[] } {
  const rows: GoogleSheetRowRecord[] = [];
  const manifestLines = [`Google Sheet: ${input.fileName}`];

  for (const grid of input.grids) {
    const table = toTable(grid.values);
    if (!table) {
      manifestLines.push(`Worksheet: ${grid.title} · no tabular rows indexed`);
      continue;
    }

    const keyColumn = chooseKeyColumn(table.columns, table.rows);
    const keyCounts = countColumnValues(table.rows, keyColumn?.index);
    manifestLines.push(
      `Worksheet: ${grid.title} · ${table.rows.length} row${table.rows.length === 1 ? "" : "s"} · columns: ${table.columns.map(column => column.header).join(", ")}`,
    );

    for (const row of table.rows) {
      const keyValue = keyColumn ? cleanCell(row.values[keyColumn.index]) : "";
      const normalisedKey = normaliseKey(keyValue);
      const hasStableKey = Boolean(normalisedKey && keyCounts.get(normalisedKey) === 1);
      const field = (role: ColumnRole) => valueForRole(table.columns, row.values, role);
      const owner = field("owner");
      const readyForDispatch = field("ready");
      const status = field("status") || (readyForDispatch ? `Ready for dispatch: ${readyForDispatch}` : "Indexed row");
      const blocker = field("blocker");
      const nextAction = field("next_action");
      const displayKey = hasStableKey ? keyValue : `${grid.title} row ${row.rowNumber}`;
      const rowUrl = googleSheetRowUrl(input.sourceUrl, grid.sheetId, row.rowNumber);
      const body = formatRowBody({
        columns: table.columns,
        fileName: input.fileName,
        grid,
        identity: hasStableKey && keyColumn ? { header: keyColumn.header, value: keyValue } : undefined,
        row,
      });

      rows.push({
        authorName: owner || null,
        body,
        externalId: stableRowExternalId({
          fileId: input.fileId,
          key: hasStableKey ? normalisedKey : undefined,
          rowNumber: row.rowNumber,
          sheetId: grid.sheetId,
        }),
        metadata: compactObject({
          blocker: blocker || undefined,
          google_file_id: input.fileId,
          google_sync_generation: input.generation,
          next_action: nextAction || undefined,
          owner: owner || undefined,
          ready_for_dispatch: readyForDispatch || undefined,
          record_kind: "sheet_row" as const,
          row_key: hasStableKey ? keyValue.slice(0, 240) : undefined,
          row_key_header: hasStableKey ? keyColumn?.header.slice(0, 120) : undefined,
          row_key_normalized: hasStableKey ? normalisedKey : undefined,
          row_number: row.rowNumber,
          sheet_id: grid.sheetId,
          sheet_title: grid.title.slice(0, 200),
          status,
        }),
        sourceUrl: rowUrl,
        status,
        title: `${displayKey.slice(0, MAX_TITLE_KEY_LENGTH)} · ${input.fileName}`,
      });
    }
  }

  manifestLines.push(`Rows indexed: ${rows.length}`);
  return {
    manifest: {
      body: manifestLines.join("\n").slice(0, 40_000),
      rowCount: rows.length,
      worksheetCount: input.grids.length,
    },
    rows,
  };
}

export function extractStructuredIdentifiers(value: string): string[] {
  const matches = value.match(/\b[A-Za-z][A-Za-z0-9]{1,15}[-_/][A-Za-z0-9][A-Za-z0-9/_-]{1,39}\b/g) ?? [];
  return [...new Set(matches.map(normaliseKey).filter(Boolean))].slice(0, 4);
}

export function stableRowExternalId(input: { fileId: string; key?: string; rowNumber: number; sheetId: number }): string {
  if (!input.key) return `${input.fileId}:sheet:${input.sheetId}:row:${input.rowNumber}`;
  const digest = createHash("sha256").update(input.key).digest("hex").slice(0, 24);
  return `${input.fileId}:sheet:${input.sheetId}:key:${digest}`;
}

function toTable(values: unknown[][]): { columns: Column[]; rows: DataRow[] } | null {
  const stringRows = values.map(row => row.map(cleanCell));
  const headerIndex = findHeaderIndex(stringRows);
  if (headerIndex < 0) return null;
  const width = Math.max(...stringRows.slice(headerIndex).map(row => row.length), 0);
  const seenHeaders = new Map<string, number>();
  const columns: Column[] = [];

  for (let index = 0; index < width; index += 1) {
    const raw = stringRows[headerIndex]?.[index] || `Column ${index + 1}`;
    const count = (seenHeaders.get(raw) ?? 0) + 1;
    seenHeaders.set(raw, count);
    const header = count === 1 ? raw : `${raw} (${count})`;
    const normalised = normaliseHeader(raw);
    columns.push({ header, index, normalised, role: classifyColumn(normalised) });
  }

  const rows = stringRows
    .slice(headerIndex + 1)
    .map((row, offset) => ({ rowNumber: headerIndex + offset + 2, values: pad(row, width) }))
    .filter(row => row.values.some(Boolean));
  return columns.length && rows.length ? { columns, rows } : null;
}

function findHeaderIndex(rows: string[][]): number {
  let best = { index: -1, score: 0 };
  for (let index = 0; index < Math.min(rows.length, 25); index += 1) {
    const nonEmpty = rows[index].filter(Boolean);
    if (nonEmpty.length < 2) continue;
    const semantic = nonEmpty.reduce((score, value) => score + (classifyColumn(normaliseHeader(value)) ? 4 : 0), 0);
    const unique = new Set(nonEmpty.map(normaliseHeader)).size;
    const score = semantic + unique;
    if (score > best.score) best = { index, score };
  }
  return best.index;
}

function chooseKeyColumn(columns: Column[], rows: DataRow[]): Column | undefined {
  const candidates = columns
    .filter(column => column.role === "identity")
    .sort((left, right) => identityPriority(left.normalised) - identityPriority(right.normalised));
  return candidates.find(column => rows.some(row => cleanCell(row.values[column.index])));
}

function countColumnValues(rows: DataRow[], index?: number): Map<string, number> {
  const counts = new Map<string, number>();
  if (index === undefined) return counts;
  for (const row of rows) {
    const value = normaliseKey(row.values[index]);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function classifyColumn(header: string): ColumnRole | undefined {
  if (!header) return undefined;
  if (/\b(next action owner|action owner|owner|assignee|assigned to|responsible|resolver)\b/.test(header)) return "owner";
  if (/\b(blocker|blocking|blocked by|hold reason|exception reason|dependency|issue)\b/.test(header)) return "blocker";
  if (/\b(ready for dispatch|dispatch ready|ready to dispatch|dispatch readiness)\b/.test(header)) return "ready";
  if (/\b(next action|next step|action required|required action|follow up)\b/.test(header)) return "next_action";
  if (/^(status|order status|dispatch status|shipment status|fulfilment status|fulfillment status|readiness)$/.test(header)) return "status";
  if (/^(id|key|order|order id|order number|order no|order code|record id|ticket id|ticket key|jira key|shipment id|request id|case id|sku)$/.test(header)) return "identity";
  if (/\b(id|key|number|no|code)$/.test(header)) return "identity";
  return undefined;
}

function identityPriority(header: string): number {
  const preferred = ["order id", "order number", "order no", "order code", "id", "record id", "ticket key", "ticket id", "shipment id", "request id", "case id", "key"];
  const index = preferred.indexOf(header);
  return index < 0 ? preferred.length : index;
}

function valueForRole(columns: Column[], values: string[], role: ColumnRole): string {
  const column = columns.find(candidate => candidate.role === role);
  return column ? cleanCell(values[column.index]).slice(0, MAX_CELL_LENGTH) : "";
}

function formatRowBody(input: {
  columns: Column[];
  fileName: string;
  grid: Pick<GoogleSheetGrid, "sheetId" | "title">;
  identity?: { header: string; value: string };
  row: DataRow;
}): string {
  const lines: string[] = [];
  const used = new Set<number>();
  if (input.identity) {
    const identityColumn = input.columns.find(column => column.header === input.identity?.header);
    if (identityColumn) used.add(identityColumn.index);
    lines.push(`${input.identity.header}: ${input.identity.value.slice(0, MAX_CELL_LENGTH)}`);
  }
  for (const role of ["status", "ready", "blocker", "next_action", "owner"] as const) {
    for (const column of input.columns.filter(candidate => candidate.role === role && !used.has(candidate.index))) {
      const value = cleanCell(input.row.values[column.index]);
      if (!value) continue;
      lines.push(`${column.header}: ${value.slice(0, MAX_CELL_LENGTH)}`);
      used.add(column.index);
    }
  }
  for (const column of input.columns) {
    if (used.has(column.index)) continue;
    const value = cleanCell(input.row.values[column.index]);
    if (value) lines.push(`${column.header}: ${value.slice(0, MAX_CELL_LENGTH)}`);
  }
  lines.push(`Source spreadsheet: ${input.fileName}`, `Worksheet: ${input.grid.title}`, `Row: ${input.row.rowNumber}`);
  return lines.join("\n").slice(0, MAX_ROW_BODY_LENGTH);
}

function googleSheetRowUrl(value: string, sheetId: number, rowNumber: number): string {
  try {
    const url = new URL(value);
    url.hash = `gid=${sheetId}&range=${encodeURIComponent(`${rowNumber}:${rowNumber}`)}`;
    return url.toString();
  } catch {
    return value;
  }
}

function normaliseHeader(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function normaliseKey(value: string): string {
  return cleanCell(value).toUpperCase().replace(/\s+/g, " ").slice(0, 240);
}

function cleanCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function pad(values: string[], width: number): string[] {
  return Array.from({ length: width }, (_, index) => values[index] ?? "");
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "")) as T;
}
