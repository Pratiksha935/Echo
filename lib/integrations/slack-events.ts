import { randomUUID } from "node:crypto";
import { loadConnectionCredential } from "./credentials";
import { serviceRest } from "./service-rest";

type SlackConnection = { id: string; organisation_id: string };
type SlackBackfillConnection = SlackConnection & { external_workspace_id: string };
type QueuedEvent = { id: string; attempts: number; external_workspace_id: string; payload: SlackEnvelope };
type SlackMessage = { bot_id?: string; channel?: string; channel_type?: string; reply_count?: number; subtype?: string; text?: string; thread_ts?: string; ts?: string; type?: string; user?: string };
type SlackChannel = { id?: string; is_archived?: boolean; is_member?: boolean; name?: string };
export type SlackEnvelope = {
  event?: SlackMessage & { deleted_ts?: string; message?: SlackMessage; previous_message?: SlackMessage };
  event_id?: string;
  team_id?: string;
  type?: string;
};

export type SlackMemoryMatch = { department: string; sourceRecordId: string; title: string };

const CLUSTERS: Array<SlackMemoryMatch & { terms: string[] }> = [
  { department:"Engineering",sourceRecordId:"ENG-PLAT-014",title:"Developer portal and service maturity scorecards",terms:["developer portal","service catalog","scorecard","backstage","golden path"] },
  { department:"Engineering",sourceRecordId:"LOOP-ENG-042",title:"Progressive delivery guardrails",terms:["progressive delivery","canary","feature flag","rollback","deployment verification"] },
  { department:"Sales",sourceRecordId:"SALES-MEASUREMENT-001",title:"Customer measurement and proof-of-value problem",terms:["proof of value","success metric","free pilot","prove roi","measurement problem"] },
  { department:"Product",sourceRecordId:"RLP-101",title:"Dynamic security deposits for trusted renters",terms:["security deposit","clean returns","trusted renter","smaller deposit","lower hold"] },
];

const CASUAL = /^(hi|hello|hey|thanks|thank you|ok|okay|done|sounds good|good morning|good night|let'?s (go|grab|have) (lunch|coffee)|anyone free for (lunch|coffee))[!.\s]*$/i;
const CATALOGUE = /\b(saree|dress|lehenga|kurta|under\s*₹?\d+|size\s+[xsml]+)\b/i;
const SLACK_REQUEST_TIMEOUT_MS = 7_000;
const SLACK_BACKFILL_BUDGET_MS = 18_000;

export function isMeaningfulSlackWork(text: string): boolean {
  const clean = text.trim();
  if (clean.length < 20 || CASUAL.test(clean) || CATALOGUE.test(clean)) return false;
  return Boolean(matchSlackMemory(clean)) || /\b(decid|propos|experiment|feature|campaign|customer|implement|launch|pilot|metric|build|rollback|deposit|portal)\w*\b/i.test(clean);
}

export function matchSlackMemory(text: string): SlackMemoryMatch | null {
  const normalised = text.toLowerCase();
  const ranked = CLUSTERS.map(cluster => ({ cluster, score: cluster.terms.filter(term => normalised.includes(term)).length })).sort((a,b)=>b.score-a.score);
  return ranked[0]?.score >= 2 ? ranked[0].cluster : null;
}

export async function enqueueSlackEvent(payload: SlackEnvelope): Promise<void> {
  if (!payload.event_id || !payload.team_id) return;
  await serviceRest("/ingestion_events?on_conflict=provider,external_event_id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ provider: "slack", external_event_id: payload.event_id, external_workspace_id: payload.team_id, event_type: payload.event?.subtype ?? payload.event?.type ?? "unknown", payload }),
  });
}

export async function drainSlackQueue(limit = 25): Promise<{ attempted: number; succeeded: number }> {
  const events = await serviceRest<QueuedEvent[]>(`/ingestion_events?select=id,attempts,external_workspace_id,payload&provider=eq.slack&status=in.(queued,failed)&available_at=lte.${encodeURIComponent(new Date().toISOString())}&order=created_at.asc&limit=${limit}`);
  let succeeded = 0;
  for (const event of events) {
    await serviceRest(`/ingestion_events?id=eq.${event.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "processing", attempts: event.attempts + 1 }) });
    try {
      const result = await processSlackEvent(event.payload);
      await finishEvent(event.id, result ? "succeeded" : "ignored");
      succeeded += 1;
    } catch {
      const attempts = event.attempts + 1;
      await serviceRest(`/ingestion_events?id=eq.${event.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "failed", error_code: "slack_ingestion_failed", available_at: new Date(Date.now() + Math.min(3600, 2 ** attempts * 30) * 1000).toISOString() }),
      });
      await recordSlackSyncFailure(event.external_workspace_id);
    }
  }
  return { attempted: events.length, succeeded };
}

export async function syncAllSlackConnections(limit = 1): Promise<{ attempted: number; succeeded: number }> {
  const connections = await serviceRest<SlackBackfillConnection[]>(
    `/integration_connections?select=id,organisation_id,external_workspace_id&provider=eq.slack&status=in.(connected,pending)&last_synced_at=is.null&order=created_at.asc&limit=${limit}`,
  );
  let succeeded = 0;
  for (const connection of connections) {
    try {
      const credential = await loadConnectionCredential(connection.id);
      await syncSlackHistory(connection, credential.accessToken);
      succeeded += 1;
    } catch {
      await markSlackConnectionAttention(connection.id);
    }
  }
  return { attempted: connections.length, succeeded };
}

async function syncSlackHistory(connection: SlackBackfillConnection, accessToken: string): Promise<void> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  let seen = 0;
  let written = 0;
  const deadline = Date.now() + SLACK_BACKFILL_BUDGET_MS;
  try {
    const channels = await listPublicChannels(accessToken);
    for (const channel of channels) {
      if (!channel.id || Date.now() >= deadline) break;
      const messages = await listChannelHistory(accessToken, channel.id);
      seen += messages.length;
      for (const message of messages) {
        if (Date.now() >= deadline) break;
        if (!message.text || !message.ts || !message.user || message.bot_id || !isMeaningfulSlackWork(message.text)) continue;
        const match = matchSlackMemory(message.text);
        if (!match) continue;
        await appendSlackMemory({
          channelId: channel.id,
          eventId: `backfill:${channel.id}:${message.ts}`,
          match,
          teamId: connection.external_workspace_id,
          text: message.text,
          timestamp: message.ts,
          userId: message.user,
        });
        written += 1;
      }
    }
    const finishedAt = new Date().toISOString();
    await serviceRest(`/integration_connections?id=eq.${encodeURIComponent(connection.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "connected", last_synced_at: finishedAt, updated_at: finishedAt }),
    });
    // Persist monitoring after the connection is usable. Telemetry must never
    // make a completed Slack backfill appear unfinished to the user.
    await serviceRest("/integration_sync_runs?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: runId,
        organisation_id: connection.organisation_id,
        connection_id: connection.id,
        status: "succeeded",
        records_seen: seen,
        records_written: written,
        started_at: startedAt,
        finished_at: finishedAt,
      }),
    }).catch(() => undefined);
  } catch {
    const finishedAt = new Date().toISOString();
    await Promise.allSettled([
      serviceRest("/integration_sync_runs?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ id: runId, organisation_id: connection.organisation_id, connection_id: connection.id, status: "failed", records_seen: seen, records_written: written, error_code: "slack_backfill_failed", started_at: startedAt, finished_at: finishedAt }),
      }),
      markSlackConnectionAttention(connection.id),
    ]);
    throw new Error("Slack history backfill failed.");
  }
}

async function listPublicChannels(accessToken: string): Promise<SlackChannel[]> {
  const query = new URLSearchParams({ exclude_archived: "true", limit: "50", types: "public_channel" });
  const payload = await slackApi<{ channels?: SlackChannel[] }>(`conversations.list?${query}`, accessToken);
  // Slack only permits history reads for channels the installed bot belongs to.
  // Skipping other public channels avoids turning one inaccessible channel into
  // a failed workspace import.
  return (payload.channels ?? []).filter(channel => channel.id && channel.is_member && !channel.is_archived).slice(0, 20);
}

async function listChannelHistory(accessToken: string, channelId: string): Promise<SlackMessage[]> {
  const query = new URLSearchParams({ channel: channelId, limit: "100" });
  const payload = await slackApi<{ messages?: SlackMessage[] }>(`conversations.history?${query}`, accessToken);
  const messages = (payload.messages ?? []).slice(0, 100);
  const threadRoots = messages.filter(message => (message.reply_count ?? 0) > 0 && message.ts).slice(0, 3);
  const replies = await Promise.allSettled(threadRoots.map(async root => {
    const replyQuery = new URLSearchParams({ channel: channelId, limit: "100", ts: root.ts ?? "" });
    const replyPayload = await slackApi<{ messages?: SlackMessage[] }>(`conversations.replies?${replyQuery}`, accessToken);
    return (replyPayload.messages ?? []).filter(message => message.ts !== root.ts);
  }));
  return messages.concat(...replies.flatMap(result => result.status === "fulfilled" ? result.value : []));
}

async function slackApi<T>(method: string, accessToken: string): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(SLACK_REQUEST_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => null) as (T & { error?: string; ok?: boolean }) | null;
  if (!response.ok || !payload?.ok) throw new Error(payload?.error ?? "Slack API request failed.");
  return payload;
}

async function markSlackConnectionAttention(connectionId: string): Promise<void> {
  await serviceRest(`/integration_connections?id=eq.${encodeURIComponent(connectionId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "attention", updated_at: new Date().toISOString() }),
  }).catch(() => undefined);
}

async function processSlackEvent(payload: SlackEnvelope): Promise<boolean> {
  const event = payload.event;
  if (!event?.channel || !payload.team_id) return false;
  if (event.subtype === "message_deleted" && event.deleted_ts) {
    await deleteSlackMemory(payload.team_id, event.channel, event.deleted_ts);
    return true;
  }
  const message = event.subtype === "message_changed" ? event.message : event;
  if (!message?.text || !message.ts || !message.user || message.bot_id || !isMeaningfulSlackWork(message.text)) return false;
  const match = matchSlackMemory(message.text);
  if (!match) return false;
  await appendSlackMemory({ channelId:event.channel,eventId:payload.event_id ?? randomUUID(),match,teamId:payload.team_id,text:message.text,timestamp:message.ts,userId:message.user });
  return true;
}

async function finishEvent(id: string, status: "succeeded" | "ignored"): Promise<void> {
  await serviceRest(`/ingestion_events?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status, processed_at: new Date().toISOString(), error_code: null }) });
}

async function deleteSlackMemory(teamId: string, channelId: string, timestamp: string): Promise<void> {
  const connections = await findConnection(teamId);
  const connection = connections[0];
  if (!connection) return;
  const externalId = `slack:${channelId}:${timestamp}`;
  await serviceRest(`/knowledge_records?organisation_id=eq.${connection.organisation_id}&source=eq.Slack&external_id=eq.${encodeURIComponent(externalId)}`, { method: "DELETE" });
}

export async function appendSlackMemory(input: { channelId: string; eventId: string; match: SlackMemoryMatch; teamId: string; text: string; timestamp: string; userId: string }): Promise<void> {
  const connections = await findConnection(input.teamId);
  const connection = connections[0];
  if (!connection) return;
  const messageId = input.timestamp.replace(".", "");
  const sourceUrl = `https://app.slack.com/client/${encodeURIComponent(input.teamId)}/${encodeURIComponent(input.channelId)}/p${encodeURIComponent(messageId)}`;
  const externalId = `slack:${input.channelId}:${input.timestamp}`;
  await serviceRest("/knowledge_records?on_conflict=organisation_id,source,external_id", {
    body: JSON.stringify({
      author_name: input.userId, body: input.text, connection_id: connection.id,
      department: input.match.department, external_id: externalId, indexed_at: new Date().toISOString(),
      metadata: {
        status: "Latest Slack update", event_id: input.eventId,
        workspace_id: input.teamId, channel_id: input.channelId,
        author_id: input.userId, message_timestamp: input.timestamp,
      },
      organisation_id: connection.organisation_id, source: "Slack",
      source_updated_at: new Date(Number(input.timestamp.split(".")[0]) * 1000).toISOString(),
      source_url: sourceUrl, title: input.match.title, visibility: "workspace",
    }),
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, method: "POST",
  });
  await serviceRest("/memory_updates?on_conflict=organisation_id,origin,external_event_id", {
    body: JSON.stringify({ current_title:input.match.title,external_event_id:input.eventId,organisation_id:connection.organisation_id,origin:"slack",original_source_url:sourceUrl,source_record_id:input.match.sourceRecordId,update_source_url:sourceUrl,update_text:input.text }),
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, method: "POST",
  });
}

async function findConnection(teamId: string): Promise<SlackConnection[]> {
  return serviceRest(`/integration_connections?select=id,organisation_id&provider=eq.slack&external_workspace_id=eq.${encodeURIComponent(teamId)}&limit=1`);
}

export async function recordSlackSyncFailure(teamId: string): Promise<void> {
  try {
    const connection = (await findConnection(teamId))[0];
    if (!connection) return;
    const finishedAt = new Date().toISOString();
    await Promise.allSettled([
      serviceRest(`/integration_connections?id=eq.${connection.id}`, { body:JSON.stringify({status: "attention",updated_at:finishedAt}),headers:{Prefer:"return=minimal"},method:"PATCH" }),
      serviceRest("/integration_sync_runs", { body:JSON.stringify({id:randomUUID(),organisation_id:connection.organisation_id,connection_id:connection.id,status: "failed",records_seen:1,records_written:0,error_code: "slack_event_ingestion_failed",started_at:finishedAt,finished_at:finishedAt}),headers:{Prefer:"return=minimal"},method:"POST" }),
    ]);
  } catch { /* Failure reporting must never escape to Slack. */ }
}
