import { randomUUID } from "node:crypto";
import { requireSupabaseServiceConfig } from "../auth/config";

type SlackConnection = { id: string; organisation_id: string };

export type SlackMemoryMatch = {
  department: string;
  sourceRecordId: string;
  title: string;
};

const CLUSTERS: Array<SlackMemoryMatch & { terms: string[] }> = [
  { department:"Engineering",sourceRecordId:"ENG-PLAT-014",title:"Developer portal and service maturity scorecards",terms:["developer portal","service catalog","scorecard","backstage","golden path"] },
  { department:"Engineering",sourceRecordId:"LOOP-ENG-042",title:"Progressive delivery guardrails",terms:["progressive delivery","canary","feature flag","rollback","deployment verification"] },
  { department:"Sales",sourceRecordId:"SALES-MEASUREMENT-001",title:"Customer measurement and proof-of-value problem",terms:["proof of value","success metric","free pilot","prove roi","measurement problem"] },
  { department:"Product",sourceRecordId:"RLP-101",title:"Dynamic security deposits for trusted renters",terms:["security deposit","clean returns","trusted renter","smaller deposit","lower hold"] },
];

export function matchSlackMemory(text: string): SlackMemoryMatch | null {
  const normalised = text.toLowerCase();
  const ranked = CLUSTERS.map(cluster => ({ cluster, score: cluster.terms.filter(term => normalised.includes(term)).length })).sort((a,b)=>b.score-a.score);
  return ranked[0]?.score >= 2 ? ranked[0].cluster : null;
}

export async function appendSlackMemory(input: {
  channelId: string;
  eventId: string;
  match: SlackMemoryMatch;
  teamId: string;
  text: string;
  timestamp: string;
  userId: string;
}): Promise<void> {
  const connections = await serviceRest<SlackConnection[]>(`/integration_connections?select=id,organisation_id&provider=eq.slack&external_workspace_id=eq.${encodeURIComponent(input.teamId)}&limit=1`);
  const connection = connections[0];
  if (!connection) return;
  const messageTimestamp = input.timestamp.replace(".", "");
  const sourceUrl = `https://app.slack.com/client/${encodeURIComponent(input.teamId)}/${encodeURIComponent(input.channelId)}/thread-${encodeURIComponent(input.channelId)}-${encodeURIComponent(messageTimestamp)}`;
  const externalId = `slack:${input.eventId}`;
  await serviceRest("/knowledge_records?on_conflict=organisation_id,source,external_id", {
    body: JSON.stringify({
      author_name: input.userId,
      body: input.text,
      connection_id: connection.id,
      department: input.match.department,
      external_id: externalId,
      indexed_at: new Date().toISOString(),
      metadata: {
        status: "Latest Slack update",
        event_id: input.eventId,
        workspace_id: input.teamId,
        channel_id: input.channelId,
        author_id: input.userId,
        message_timestamp: input.timestamp,
      },
      organisation_id: connection.organisation_id,
      source: "Slack",
      source_updated_at: new Date(Number(input.timestamp.split(".")[0]) * 1000).toISOString(),
      source_url: sourceUrl,
      title: input.match.title,
      visibility: "workspace",
    }),
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    method: "POST",
  });
  await serviceRest("/memory_updates?on_conflict=organisation_id,origin,external_event_id", {
    body: JSON.stringify({
      current_title: input.match.title,
      external_event_id: input.eventId,
      organisation_id: connection.organisation_id,
      origin: "slack",
      original_source_url: sourceUrl,
      source_record_id: input.match.sourceRecordId,
      update_source_url: sourceUrl,
      update_text: input.text,
    }),
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    method: "POST",
  });
}

export async function recordSlackSyncFailure(teamId: string): Promise<void> {
  try {
    const connections = await serviceRest<SlackConnection[]>(`/integration_connections?select=id,organisation_id&provider=eq.slack&external_workspace_id=eq.${encodeURIComponent(teamId)}&limit=1`);
    const connection = connections[0];
    if (!connection) return;
    const finishedAt = new Date().toISOString();
    await Promise.allSettled([
      serviceRest(`/integration_connections?id=eq.${encodeURIComponent(connection.id)}`, {
        body: JSON.stringify({ status: "attention", updated_at: finishedAt }),
        headers: { Prefer: "return=minimal" },
        method: "PATCH",
      }),
      serviceRest("/integration_sync_runs", {
        body: JSON.stringify({
          id: randomUUID(),
          organisation_id: connection.organisation_id,
          connection_id: connection.id,
          status: "failed",
          records_seen: 1,
          records_written: 0,
          error_code: "slack_event_ingestion_failed",
          started_at: finishedAt,
          finished_at: finishedAt,
        }),
        headers: { Prefer: "return=minimal" },
        method: "POST",
      }),
    ]);
  } catch {
    // Failure reporting is best-effort and must never escape to Slack.
  }
}

async function serviceRest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const config = requireSupabaseServiceConfig();
  const response = await fetch(`${config.url}/rest/v1${path}`, {
    ...init,
    cache: "no-store",
    headers: { apikey: config.serviceRoleKey, authorization: `Bearer ${config.serviceRoleKey}`, "content-type":"application/json", ...init.headers },
  });
  if (!response.ok) throw new Error("Slack memory persistence failed.");
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
