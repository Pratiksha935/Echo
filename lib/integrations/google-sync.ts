import { randomUUID } from "node:crypto";
import type { IntegrationCredential } from "./oauth";
import { loadConnectionCredential, refreshGoogleCredentialIfNeeded, type StoredConnection } from "./credentials";
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

type KnowledgeRecord = {
  author_name: string;
  body: string;
  connection_id: string;
  department: string;
  external_id: string;
  metadata: { status: string };
  organisation_id: string;
  source: string;
  source_updated_at: string;
  source_url: string;
  title: string;
  visibility: "workspace";
};

const GOOGLE_DOC = "application/vnd.google-apps.document";
const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
const APPROVED_DEPARTMENTS = new Set(["product", "gtm", "sales", "engineering", "research"]);

export async function syncAllGoogleConnections(limit = 10): Promise<{ attempted: number; succeeded: number }> {
  const connections = await serviceRest<StoredConnection[]>(
    `/integration_connections?select=id,organisation_id,provider,cursor&provider=eq.google&status=in.(connected,pending,attention)&order=last_synced_at.asc.nullsfirst&limit=${limit}`,
  );
  let succeeded = 0;
  for (const connection of connections) {
    try {
      const stored = await loadConnectionCredential(connection.id);
      const credential = await refreshGoogleCredentialIfNeeded(connection.id, stored);
      await syncGoogleWorkspace(connection.organisation_id, connection.id, credential, connection.cursor);
      succeeded += 1;
    } catch {
      await markConnectionAttention(connection.id);
    }
  }
  return { attempted: connections.length, succeeded };
}

export async function syncGoogleWorkspace(
  organisationId: string,
  connectionId: string,
  credential: IntegrationCredential,
  cursor: string | null = null,
): Promise<{ seen: number; written: number }> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  await serviceRest("/integration_sync_runs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ id: runId, organisation_id: organisationId, connection_id: connectionId, status: "running", started_at: startedAt }),
  });

  try {
    const delta = cursor
      ? await listChanges(credential.accessToken, cursor)
      : { files: await listFiles(credential.accessToken), removedIds: [] as string[], nextCursor: await getStartPageToken(credential.accessToken) };
    const files = delta.files.filter(isApprovedFile);
    const records = (await Promise.all(files.map(file => toKnowledgeRecord(file, organisationId, connectionId, credential.accessToken))))
      .filter((record): record is KnowledgeRecord => Boolean(record));

    if (records.length) {
      await serviceRest("/knowledge_records?on_conflict=organisation_id,source,external_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(records),
      });
    }
    if (delta.removedIds.length) {
      const ids = delta.removedIds.map(id => `"${id.replaceAll('"', '')}"`).join(",");
      await serviceRest(`/knowledge_records?organisation_id=eq.${encodeURIComponent(organisationId)}&connection_id=eq.${encodeURIComponent(connectionId)}&external_id=in.(${encodeURIComponent(ids)})`, { method: "DELETE" });
    }
    const finishedAt = new Date().toISOString();
    await serviceRest(`/integration_sync_runs?id=eq.${encodeURIComponent(runId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "succeeded", records_seen: files.length, records_written: records.length, finished_at: finishedAt }),
    });
    await serviceRest(`/integration_connections?id=eq.${encodeURIComponent(connectionId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ cursor: delta.nextCursor, last_synced_at: finishedAt, status: "connected", updated_at: finishedAt }),
    });
    return { seen: files.length, written: records.length };
  } catch {
    const finishedAt = new Date().toISOString();
    await recordGoogleSyncFailure(organisationId, connectionId, runId, finishedAt);
    throw new Error("Google Workspace sync failed.");
  }
}

async function recordGoogleSyncFailure(organisationId: string, connectionId: string, runId: string, finishedAt: string): Promise<void> {
  await Promise.allSettled([
    serviceRest(`/integration_sync_runs?id=eq.${encodeURIComponent(runId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "failed", error_code: "google_workspace_sync_failed", finished_at: finishedAt }),
    }),
    serviceRest(`/integration_connections?id=eq.${encodeURIComponent(connectionId)}&organisation_id=eq.${encodeURIComponent(organisationId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "attention", updated_at: finishedAt }),
    }),
  ]);
}

async function listFiles(accessToken: string): Promise<DriveFile[]> {
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
    const response = await googleFetch(`https://www.googleapis.com/drive/v3/files?${query}`, accessToken);
    const payload = await response.json() as { files?: DriveFile[]; nextPageToken?: string };
    files.push(...(payload.files ?? []));
    pageToken = payload.nextPageToken;
  } while (pageToken && files.length < 1000);
  return files;
}

function isApprovedFile(file: DriveFile): boolean {
  if (![GOOGLE_DOC, GOOGLE_SHEET].includes(file.mimeType)) return false;
  const department = file.name.match(/^\[([^\]]+)\]/)?.[1]?.toLowerCase();
  return Boolean(department && APPROVED_DEPARTMENTS.has(department));
}

async function getStartPageToken(accessToken: string): Promise<string> {
  const response = await googleFetch("https://www.googleapis.com/drive/v3/changes/startPageToken", accessToken);
  const payload = await response.json() as { startPageToken?: string };
  if (!payload.startPageToken) throw new Error("Google change cursor was unavailable.");
  return payload.startPageToken;
}

async function listChanges(accessToken: string, cursor: string): Promise<{ files: DriveFile[]; removedIds: string[]; nextCursor: string }> {
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
    const response = await googleFetch(`https://www.googleapis.com/drive/v3/changes?${query}`, accessToken);
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

async function toKnowledgeRecord(
  file: DriveFile,
  organisationId: string,
  connectionId: string,
  accessToken: string,
): Promise<KnowledgeRecord | null> {
  const text = file.mimeType === GOOGLE_DOC
    ? await readDocument(file.id, accessToken)
    : await exportSheet(file.id, accessToken);
  const cleaned = text.replace(/\r/g, "").trim();
  if (cleaned.length < 40) return null;

  const metadata = parseMetadata(cleaned, file.name);
  return {
    organisation_id: organisationId,
    connection_id: connectionId,
    source: file.mimeType === GOOGLE_DOC ? "Google Docs" : "Google Sheets",
    external_id: file.id,
    title: metadata.title,
    body: cleaned.slice(0, 40_000),
    author_name: metadata.owner,
    department: metadata.department,
    source_url: file.webViewLink ?? `https://drive.google.com/open?id=${encodeURIComponent(file.id)}`,
    visibility: "workspace",
    metadata: { status: metadata.status },
    source_updated_at: file.modifiedTime ?? new Date().toISOString(),
  };
}

async function readDocument(fileId: string, accessToken: string): Promise<string> {
  const response = await googleFetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(fileId)}`, accessToken);
  const document = await response.json() as GoogleDocument;
  return (document.body?.content ?? [])
    .flatMap(block => block.paragraph?.elements ?? [])
    .map(element => element.textRun?.content ?? "")
    .join("");
}

async function exportSheet(fileId: string, accessToken: string): Promise<string> {
  const query = new URLSearchParams({ mimeType: "text/csv" });
  const response = await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?${query}`, accessToken);
  return response.text();
}

function parseMetadata(text: string, fileName: string) {
  const firstLines = text.split("\n").slice(0, 12);
  const read = (label: string) => firstLines.find(line => line.toLowerCase().startsWith(`${label.toLowerCase()}:`))?.split(":").slice(1).join(":").trim();
  const taggedDepartment = fileName.match(/^\[([^\]]+)\]/)?.[1];
  return {
    department: read("Department") ?? taggedDepartment ?? "Company",
    owner: read("Owner") ?? "Workspace owner",
    status: read("Status") ?? "Indexed",
    title: (read("Title") ?? fileName.replace(/^\[[^\]]+\]\s*/, "")).trim(),
  };
}

async function googleFetch(url: string, accessToken: string): Promise<Response> {
  const response = await fetch(url, { cache: "no-store", headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("Google Workspace backfill failed.");
  return response;
}

async function markConnectionAttention(connectionId: string): Promise<void> {
  await serviceRest(`/integration_connections?id=eq.${encodeURIComponent(connectionId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "attention", updated_at: new Date().toISOString() }),
  }).catch(() => undefined);
}
