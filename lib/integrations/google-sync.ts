import { randomUUID } from "node:crypto";
import type { IntegrationCredential } from "./oauth";
import { loadConnectionCredential, refreshGoogleCredentialIfNeeded, type StoredConnection } from "./credentials";
import { buildGoogleSheetRows, type GoogleSheetGrid } from "./google-sheet-records";
import { serviceRest } from "./service-rest";

type DriveFile = {
  id: string;
  mimeType: string;
  modifiedTime?: string;
  name: string;
  webViewLink?: string;
};

type DriveChange = { file?: DriveFile; fileId: string; removed?: boolean };

type GoogleDocument = {
  body?: {
    content?: Array<{
      paragraph?: { elements?: Array<{ textRun?: { content?: string } }> };
    }>;
  };
};

type GoogleSpreadsheet = {
  sheets?: Array<{
    properties?: { index?: number; sheetId?: number; title?: string };
  }>;
};

type GoogleValueRange = { values?: unknown[][] };
type GoogleBatchValues = { valueRanges?: GoogleValueRange[] };

type KnowledgeRecord = {
  author_name: string | null;
  body: string;
  connection_id: string;
  department: string;
  external_id: string;
  metadata: Record<string, boolean | number | string | null | undefined> & { status: string };
  organisation_id: string;
  source: string;
  source_updated_at: string;
  source_url: string;
  title: string;
  visibility: "workspace";
};

type ImportedFile = {
  fileId: string;
  records: KnowledgeRecord[];
  sheetGeneration?: string;
};

const GOOGLE_DOC = "application/vnd.google-apps.document";
const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
const APPROVED_DEPARTMENTS = new Set(["product", "gtm", "sales", "engineering", "research", "browser", "company"]);
const GOOGLE_REQUEST_TIMEOUT_MS = 6_000;
const GOOGLE_SYNC_TIMEOUT_MS = 20_000;
const GOOGLE_FILE_CONCURRENCY = 4;
const KNOWLEDGE_WRITE_BATCH_SIZE = 200;
const SHEET_RANGE_BATCH_SIZE = 20;

class GoogleSyncError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "GoogleSyncError";
  }
}

export async function syncAllGoogleConnections(limit = 10): Promise<{ attempted: number; succeeded: number }> {
  await failInterruptedRuns();
  const connections = await serviceRest<StoredConnection[]>(
    `/integration_connections?select=id,organisation_id,provider,cursor,integration_secrets!inner(connection_id)&provider=eq.google&status=in.(connected,pending,attention)&order=last_synced_at.asc.nullsfirst&limit=${limit}`,
  );
  let succeeded = 0;
  for (const connection of connections) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GOOGLE_SYNC_TIMEOUT_MS);
    try {
      const stored = await loadConnectionCredential(connection.id);
      const credential = await refreshGoogleCredentialIfNeeded(connection.id, stored);
      await syncGoogleWorkspace(connection.organisation_id, connection.id, credential, connection.cursor, controller.signal);
      succeeded += 1;
    } catch {
      await markConnectionAttention(connection.id);
    } finally {
      clearTimeout(timeout);
    }
  }
  return { attempted: connections.length, succeeded };
}

export async function syncGoogleWorkspace(
  organisationId: string,
  connectionId: string,
  credential: IntegrationCredential,
  cursor: string | null = null,
  signal?: AbortSignal,
): Promise<{ seen: number; written: number }> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  try {
    const delta = cursor
      ? await listChanges(credential.accessToken, cursor, signal)
      : await listFilesFromStableCursor(credential.accessToken, signal);
    const files = delta.files.filter(isReadableWorkspaceFile);
    const noLongerReadableIds = delta.files.filter(file => !isReadableWorkspaceFile(file)).map(file => file.id);
    const fileResults = await mapSettledWithConcurrency(
      files,
      GOOGLE_FILE_CONCURRENCY,
      file => toKnowledgeRecords(file, organisationId, connectionId, credential.accessToken, signal),
    );
    const importedFiles = fileResults
      .filter((result): result is PromiseFulfilledResult<ImportedFile> => result.status === "fulfilled")
      .map(result => result.value);
    const records = importedFiles.flatMap(result => result.records);
    const unreadableFiles = fileResults.filter(result => result.status === "rejected").length;

    await upsertKnowledgeRecords(records);
    for (const imported of importedFiles) {
      if (imported.sheetGeneration) {
        await deleteStaleSheetRows(organisationId, connectionId, imported.fileId, imported.sheetGeneration);
      }
    }
    await deleteGoogleFiles(organisationId, connectionId, [...new Set([...delta.removedIds, ...noLongerReadableIds])]);
    const finishedAt = new Date().toISOString();
    // Mark a completed backfill independently of the incremental cursor. Some
    // providers can return a cursor value that PostgREST rejects; that must not
    // hide successfully indexed data or keep onboarding in an unfinished state.
    await serviceRest(`/integration_connections?id=eq.${encodeURIComponent(connectionId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ last_synced_at: finishedAt, status: "connected", updated_at: finishedAt }),
    });
    await serviceRest(`/integration_connections?id=eq.${encodeURIComponent(connectionId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ cursor: delta.nextCursor }),
    }).catch(() => undefined);
    await serviceRest("/integration_sync_runs?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: runId,
        organisation_id: organisationId,
        connection_id: connectionId,
        status: unreadableFiles ? "partial" : "succeeded",
        records_seen: files.length,
        records_written: records.length,
        error_code: unreadableFiles ? "google_files_unreadable" : null,
        started_at: startedAt,
        finished_at: finishedAt,
      }),
    }).catch(() => undefined);
    return { seen: files.length, written: records.length };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const errorCode = error instanceof GoogleSyncError ? error.code : "google_workspace_sync_failed";
    // Keep provider diagnostics in server logs only. The UI receives the
    // sanitised error code stored on the sync run, never token or file data.
    console.error("[google-sync] failed", { connectionId, errorCode });
    await recordGoogleSyncFailure(organisationId, connectionId, runId, startedAt, finishedAt, errorCode);
    throw new Error("Google Workspace sync failed.");
  }
}

async function listFilesFromStableCursor(accessToken: string, signal?: AbortSignal): Promise<{ files: DriveFile[]; removedIds: string[]; nextCursor: string }> {
  // Capture the cursor before the backfill so changes made while files are being
  // listed are picked up by the next incremental run rather than being skipped.
  const nextCursor = await getStartPageToken(accessToken, signal);
  const files = await listFiles(accessToken, signal);
  return { files, removedIds: [], nextCursor };
}

async function upsertKnowledgeRecords(records: KnowledgeRecord[]): Promise<void> {
  for (let offset = 0; offset < records.length; offset += KNOWLEDGE_WRITE_BATCH_SIZE) {
    await serviceRest("/knowledge_records?on_conflict=organisation_id,source,external_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(records.slice(offset, offset + KNOWLEDGE_WRITE_BATCH_SIZE)),
    });
  }
}

async function mapSettledWithConcurrency<Input, Output>(
  values: Input[],
  limit: number,
  operation: (value: Input) => Promise<Output>,
): Promise<Array<PromiseSettledResult<Output>>> {
  const results = new Array<PromiseSettledResult<Output>>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: "fulfilled", value: await operation(values[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function deleteStaleSheetRows(organisationId: string, connectionId: string, fileId: string, generation: string): Promise<void> {
  const query = new URLSearchParams({
    organisation_id: `eq.${organisationId}`,
    connection_id: `eq.${connectionId}`,
    source: "eq.Google Sheets",
    "metadata->>google_file_id": `eq.${fileId}`,
    "metadata->>record_kind": "eq.sheet_row",
    "metadata->>google_sync_generation": `neq.${generation}`,
  });
  await serviceRest(`/knowledge_records?${query}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
}

async function deleteGoogleFiles(organisationId: string, connectionId: string, fileIds: string[]): Promise<void> {
  if (!fileIds.length) return;
  const inList = `in.(${fileIds.map(quotePostgrestValue).join(",")})`;
  const base = { organisation_id: `eq.${organisationId}`, connection_id: `eq.${connectionId}` };
  const fileQuery = new URLSearchParams({ ...base, external_id: inList });
  const rowsQuery = new URLSearchParams({ ...base, "metadata->>google_file_id": inList });
  await Promise.all([
    serviceRest(`/knowledge_records?${fileQuery}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }),
    serviceRest(`/knowledge_records?${rowsQuery}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }),
  ]);
}

function quotePostgrestValue(value: string): string {
  return `"${value.replaceAll("\\", "").replaceAll('"', "")}"`;
}

async function recordGoogleSyncFailure(
  organisationId: string,
  connectionId: string,
  runId: string,
  startedAt: string,
  finishedAt: string,
  errorCode: string,
): Promise<void> {
  // Write a single terminal record at completion. Netlify requests are short,
  // so an intermediate "running" row adds no user value and can be stranded
  // if a fresh PostgREST row is not immediately updateable.
  await serviceRest("/integration_sync_runs?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id: runId,
      organisation_id: organisationId,
      connection_id: connectionId,
      status: "failed",
      error_code: errorCode,
      started_at: startedAt,
      finished_at: finishedAt,
    }),
  }).catch(() => undefined);
  await serviceRest(`/integration_connections?id=eq.${encodeURIComponent(connectionId)}&organisation_id=eq.${encodeURIComponent(organisationId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "attention", updated_at: finishedAt }),
    }).catch(() => undefined);
}

async function listFiles(accessToken: string, signal?: AbortSignal): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink)",
      orderBy: "modifiedTime desc",
      pageSize: "100",
      q: `trashed = false and (mimeType = '${GOOGLE_DOC}' or mimeType = '${GOOGLE_SHEET}')`,
    });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await googleFetch(`https://www.googleapis.com/drive/v3/files?${query}`, accessToken, signal);
    const payload = await response.json() as { files?: DriveFile[]; nextPageToken?: string };
    files.push(...(payload.files ?? []));
    pageToken = payload.nextPageToken;
  } while (pageToken && files.length < 1000);
  return files;
}

function isReadableWorkspaceFile(file: DriveFile): boolean {
  return [GOOGLE_DOC, GOOGLE_SHEET].includes(file.mimeType);
}

async function getStartPageToken(accessToken: string, signal?: AbortSignal): Promise<string> {
  const response = await googleFetch("https://www.googleapis.com/drive/v3/changes/startPageToken", accessToken, signal);
  const payload = await response.json() as { startPageToken?: string };
  if (!payload.startPageToken) throw new Error("Google change cursor was unavailable.");
  return payload.startPageToken;
}

async function listChanges(accessToken: string, cursor: string, signal?: AbortSignal): Promise<{ files: DriveFile[]; removedIds: string[]; nextCursor: string }> {
  const files: DriveFile[] = [];
  const removedIds: string[] = [];
  let pageToken = cursor;
  let nextCursor = cursor;
  do {
    const query = new URLSearchParams({
      pageToken,
      pageSize: "100",
      spaces: "drive",
      fields: "nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,modifiedTime,webViewLink))",
    });
    const response = await googleFetch(`https://www.googleapis.com/drive/v3/changes?${query}`, accessToken, signal);
    const payload = await response.json() as { changes?: DriveChange[]; nextPageToken?: string; newStartPageToken?: string };
    for (const change of payload.changes ?? []) {
      if (change.removed || !change.file) removedIds.push(change.fileId);
      else files.push(change.file);
    }
    if (payload.newStartPageToken) nextCursor = payload.newStartPageToken;
    pageToken = payload.nextPageToken ?? "";
  } while (pageToken);
  return { files, removedIds, nextCursor };
}

async function toKnowledgeRecords(
  file: DriveFile,
  organisationId: string,
  connectionId: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<ImportedFile> {
  const sourceUrl = file.webViewLink ?? `https://drive.google.com/open?id=${encodeURIComponent(file.id)}`;
  const sourceUpdatedAt = file.modifiedTime ?? new Date().toISOString();
  if (file.mimeType === GOOGLE_DOC) {
    const text = (await readDocument(file.id, accessToken, signal)).replace(/\r/g, "").trim();
    if (text.length < 40) return { fileId: file.id, records: [] };
    const metadata = parseMetadata(text, file.name);
    return {
      fileId: file.id,
      records: [{
        organisation_id: organisationId,
        connection_id: connectionId,
        source: "Google Docs",
        external_id: file.id,
        title: metadata.title,
        body: text.slice(0, 40_000),
        author_name: metadata.owner,
        department: metadata.department,
        source_url: sourceUrl,
        visibility: "workspace",
        metadata: { status: metadata.status },
        source_updated_at: sourceUpdatedAt,
      }],
    };
  }

  const generation = randomUUID();
  const grids = await readSpreadsheet(file.id, accessToken, signal);
  const preview = grids.flatMap(grid => grid.values.slice(0, 12)).map(row => row.join(" ")).join("\n");
  const fileMetadata = parseMetadata(preview, file.name);
  const indexed = buildGoogleSheetRows({
    fileId: file.id,
    fileName: fileMetadata.title,
    generation,
    grids,
    sourceUrl,
  });
  const fileStatus = indexed.manifest.rowCount
    ? `${indexed.manifest.rowCount} row${indexed.manifest.rowCount === 1 ? "" : "s"} indexed`
    : "No tabular rows indexed";
  const fileRecord: KnowledgeRecord = {
    organisation_id: organisationId,
    connection_id: connectionId,
    source: "Google Sheets",
    external_id: file.id,
    title: fileMetadata.title,
    body: indexed.manifest.body,
    author_name: fileMetadata.owner,
    department: fileMetadata.department,
    source_url: sourceUrl,
    visibility: "workspace",
    metadata: {
      google_file_id: file.id,
      record_kind: "sheet_file",
      row_count: indexed.manifest.rowCount,
      status: fileStatus,
      worksheet_count: indexed.manifest.worksheetCount,
    },
    source_updated_at: sourceUpdatedAt,
  };
  const rowRecords = indexed.rows.map(row => ({
    organisation_id: organisationId,
    connection_id: connectionId,
    source: "Google Sheets",
    external_id: row.externalId,
    title: row.title,
    body: row.body,
    author_name: row.authorName,
    department: inferDepartment(`${file.name}\n${row.body}`),
    source_url: row.sourceUrl,
    visibility: "workspace" as const,
    metadata: row.metadata,
    source_updated_at: sourceUpdatedAt,
  }));
  return { fileId: file.id, records: [fileRecord, ...rowRecords], sheetGeneration: generation };
}

async function readDocument(fileId: string, accessToken: string, signal?: AbortSignal): Promise<string> {
  const response = await googleFetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(fileId)}`, accessToken, signal);
  const document = await response.json() as GoogleDocument;
  return (document.body?.content ?? [])
    .flatMap(block => block.paragraph?.elements ?? [])
    .map(element => element.textRun?.content ?? "")
    .join("");
}

async function readSpreadsheet(fileId: string, accessToken: string, signal?: AbortSignal): Promise<GoogleSheetGrid[]> {
  const metadataQuery = new URLSearchParams({ fields: "sheets(properties(sheetId,title,index))" });
  const metadataResponse = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}?${metadataQuery}`, accessToken, signal);
  const spreadsheet = await metadataResponse.json() as GoogleSpreadsheet;
  const sheets = (spreadsheet.sheets ?? [])
    .map(sheet => sheet.properties)
    .filter((properties): properties is { index?: number; sheetId: number; title: string } => typeof properties?.sheetId === "number" && typeof properties.title === "string")
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
  const grids: GoogleSheetGrid[] = [];

  for (let offset = 0; offset < sheets.length; offset += SHEET_RANGE_BATCH_SIZE) {
    const batch = sheets.slice(offset, offset + SHEET_RANGE_BATCH_SIZE);
    const query = new URLSearchParams({ majorDimension: "ROWS", valueRenderOption: "FORMATTED_VALUE" });
    for (const sheet of batch) query.append("ranges", quoteSheetTitle(sheet.title));
    const response = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}/values:batchGet?${query}`, accessToken, signal);
    const payload = await response.json() as GoogleBatchValues;
    for (const [index, sheet] of batch.entries()) {
      grids.push({ sheetId: sheet.sheetId, title: sheet.title, values: payload.valueRanges?.[index]?.values ?? [] });
    }
  }
  return grids;
}

function quoteSheetTitle(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function parseMetadata(text: string, fileName: string) {
  const firstLines = text.split("\n").slice(0, 12);
  const read = (label: string) => firstLines.find(line => line.toLowerCase().startsWith(`${label.toLowerCase()}:`))?.split(":").slice(1).join(":").trim();
  const taggedDepartment = fileName.match(/^\[([^\]]+)\]/)?.[1];
  const inferredDepartment = inferDepartment(`${fileName}\n${firstLines.join("\n")}`);
  const department = read("Department") ?? taggedDepartment ?? inferredDepartment;
  return {
    department: APPROVED_DEPARTMENTS.has(department.toLowerCase()) ? department : inferredDepartment,
    owner: read("Owner") ?? "Workspace owner",
    status: read("Status") ?? "Indexed",
    title: (read("Title") ?? fileName.replace(/^\[[^\]]+\]\s*/, "")).trim(),
  };
}

function inferDepartment(value: string): string {
  const text = value.toLowerCase();
  if (/\b(engineering|developer|code|deployment|incident|platform|api|service|harness)\b/.test(text)) return "Engineering";
  if (/\b(gtm|campaign|launch|marketing|positioning|activation|growth)\b/.test(text)) return "GTM";
  if (/\b(sales|customer|account|abm|pipeline|call center|contact center|proof of value|roi)\b/.test(text)) return "Sales";
  if (/\b(research|article|market|competitor|analysis)\b/.test(text)) return "Research";
  if (/\b(product|feature|renter|rental|deposit|checkout|inventory|workflow|voice agent|human in the loop)\b/.test(text)) return "Product";
  return "Company";
}

async function googleFetch(url: string, accessToken: string, parentSignal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, GOOGLE_REQUEST_TIMEOUT_MS);
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as {
        error?: { errors?: Array<{ reason?: string }>; status?: string };
      } | null;
      const reason = payload?.error?.errors?.[0]?.reason ?? payload?.error?.status;
      throw new GoogleSyncError(classifyGoogleFailure(response.status, reason));
    }
    return response;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abort);
  }
}

function classifyGoogleFailure(status: number, reason?: string): string {
  if (reason === "accessNotConfigured") return "google_api_not_enabled";
  if (reason === "insufficientPermissions" || reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT") return "google_scope_missing";
  if (status === 401) return "google_authorisation_expired";
  if (status === 403) return "google_access_forbidden";
  if (status === 429) return "google_rate_limited";
  return `google_http_${status}`;
}

async function failInterruptedRuns(): Promise<void> {
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const finishedAt = new Date().toISOString();
  await serviceRest(`/integration_sync_runs?status=eq.running&started_at=lt.${encodeURIComponent(cutoff)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "failed", error_code: "worker_interrupted", finished_at: finishedAt }),
  }).catch(() => undefined);
}

async function markConnectionAttention(connectionId: string): Promise<void> {
  await serviceRest(`/integration_connections?id=eq.${encodeURIComponent(connectionId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "attention", updated_at: new Date().toISOString() }),
  }).catch(() => undefined);
}
