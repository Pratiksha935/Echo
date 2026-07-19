import { randomUUID } from "node:crypto";
import { HermesUnavailableError, queryHermes } from "../hermes/client";
import { loadConnectionCredential } from "./credentials";
import { serviceRest } from "./service-rest";

type SlackConnection = { granted_scopes?: string[] | null; id: string; organisation_id: string };
type SlackBackfillConnection = SlackConnection & { external_workspace_id: string };
type QueuedEvent = { id: string; attempts: number; external_workspace_id: string; payload: SlackEnvelope };
type SlackMessage = { bot_id?: string; channel?: string; channel_type?: string; reply_count?: number; subtype?: string; text?: string; thread_ts?: string; ts?: string; type?: string; user?: string };
type SlackChannel = { id?: string; is_archived?: boolean; is_member?: boolean; name?: string };
type SlackUser = {
  deleted?: boolean;
  id?: string;
  is_bot?: boolean;
  name?: string;
  profile?: { display_name?: string; email?: string; image_48?: string; real_name?: string };
  real_name?: string;
};
export type SlackEnvelope = {
  event?: SlackMessage & { deleted_ts?: string; message?: SlackMessage; previous_message?: SlackMessage };
  event_id?: string;
  team_id?: string;
  type?: string;
};

export type SlackMemoryMatch = { department: string; sourceRecordId?: string; title: string };
export type SlackBattlecardRequest = {
  messageText?: string;
  responseUrl?: string;
  teamId?: string;
  triggerId?: string;
  userId?: string;
};
export type SlackShareTarget = { avatar?: string; displayName: string; email?: string; id: string; name?: string; type: "channel" | "user" };
export type SlackShareRecipient = { id: string; type: "channel" | "user" };
export type SlackBrowserShare = {
  department: string;
  note?: string;
  organisationId: string;
  pageTitle: string;
  pageUrl: string;
  recipients: SlackShareRecipient[];
  senderEmail: string;
};
export type SlackQuestionAnswer = { answer: string; sources: Array<{ title: string; url: string }> };
type SlackPriorWorkMatch = {
  classification: "conflict" | "exact" | "same_idea";
  confidence: number;
  reason: string;
  record: SlackAskRecord;
};

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
  return Boolean(matchSlackMemory(clean)) || /\b(decid|propos|experiment|feature|campaign|customer|implement|launch|pilot|metric|build|rollback|deposit|portal|workflow|handoff|escalat|voice agent|call center|contact center|support|operations|process|automation|human in (?:the )?loop)\w*\b/i.test(clean);
}

export function matchSlackMemory(text: string): SlackMemoryMatch | null {
  const normalised = text.toLowerCase();
  const ranked = CLUSTERS.map(cluster => ({ cluster, score: cluster.terms.filter(term => normalised.includes(term)).length })).sort((a,b)=>b.score-a.score);
  return ranked[0]?.score >= 2 ? ranked[0].cluster : null;
}

export function inferSlackMemory(text: string): SlackMemoryMatch | null {
  const known = matchSlackMemory(text);
  if (known) return known;
  if (!isMeaningfulSlackWork(text)) return null;
  return {
    department: inferSlackDepartment(text),
    title: inferSlackTitle(text),
  };
}

export async function openSlackBattlecard(input: SlackBattlecardRequest): Promise<{ opened: boolean; reason?: string }> {
  if (!input.teamId || !input.triggerId) return { opened: false, reason: "invalid_request" };
  const text = input.messageText?.trim() ?? "";
  const connection = (await findConnection(input.teamId))[0];
  if (!connection) return { opened: false, reason: "workspace_not_connected" };
  const credential = await loadConnectionCredential(connection.id);
  const opened = await slackApi<{ view?: { id?: string } }>("views.open", credential.accessToken, {
    trigger_id: input.triggerId,
    view: buildSlackBattlecardLoadingModal(text),
  });
  const viewId = opened.view?.id;
  if (!viewId) return { opened: false, reason: "modal_not_opened" };
  if (!isMeaningfulSlackWork(text)) {
    await slackApi("views.update", credential.accessToken, { view_id: viewId, view: buildSlackNoMatchModal(text) });
    return { opened: false, reason: "no_match" };
  }
  const records = await serviceRest<SlackAskRecord[]>(
    `/knowledge_records?select=source,external_id,title,body,author_name,department,source_url,metadata&organisation_id=eq.${encodeURIComponent(connection.organisation_id)}&order=source_updated_at.desc&limit=120`,
  );
  const candidates = rankSlackAskRecords(records, text).slice(0, 24);
  const match = await reviewSlackPriorWorkWithHermes({
    candidates,
    messageText: text,
    organisationId: connection.organisation_id,
  });
  if (!match) {
    await slackApi("views.update", credential.accessToken, { view_id: viewId, view: buildSlackNoMatchModal(text) });
    return { opened: false, reason: "no_match" };
  }
  await slackApi("views.update", credential.accessToken, {
    view_id: viewId,
    view: buildBattlecardModal(match, text),
  });
  return { opened: true };
}

async function reviewSlackPriorWorkWithHermes(input: { candidates: SlackAskRecord[]; messageText: string; organisationId: string }): Promise<SlackPriorWorkMatch | null> {
  if (!input.candidates.length) return null;
  const prompt = `You are Hermes, Found's closed-world prior-work decision layer for Slack.
Decide whether the selected Slack message has an exact, same-idea, or conflicting match in the indexed company evidence below.
Return only compact JSON with this schema:
{"show":true|false,"confidence":0-100,"classification":"exact|same_idea|conflict|tangential|no_match","candidate":1,"reason":"one evidence-grounded sentence"}

Rules:
- show=true only for the same concrete intervention and outcome, the same underlying intervention expressed differently, or a direct conflict with a recorded decision.
- show=false for merely related domains, shared vendors, broad industry overlap, generic work language, casual text, catalogue queries, or uncertain evidence.
- candidate is the one-based evidence number. Never invent a candidate.
- If unsure, show=false. False positives are more damaging than missed weak matches.

Selected Slack message:
${input.messageText.slice(0, 1600)}

Indexed company evidence:
${input.candidates.map((record, index) => `${index + 1}. ${record.source} · ${record.title}
Owner: ${record.author_name ?? "Owner not indexed"}
Department: ${record.department ?? "Unknown"}
Status: ${record.metadata?.status ?? "Indexed"}
Source: ${record.source_url}
Evidence: ${record.body.replace(/\s+/g, " ").trim().slice(0, 850)}`).join("\n\n")}`;
  try {
    const response = await queryHermes(prompt, input.organisationId);
    const json = response.match(/\{[\s\S]*\}/)?.[0] ?? response;
    const parsed = JSON.parse(json) as { candidate?: unknown; classification?: unknown; confidence?: unknown; reason?: unknown; show?: unknown };
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    const classification = typeof parsed.classification === "string" ? parsed.classification : "";
    const candidateIndex = typeof parsed.candidate === "number" ? Math.trunc(parsed.candidate) - 1 : -1;
    if (parsed.show !== true || confidence < 85 || !["exact", "same_idea", "conflict"].includes(classification) || !input.candidates[candidateIndex]) return null;
    return {
      classification: classification as SlackPriorWorkMatch["classification"],
      confidence: Math.min(100, Math.max(85, Math.round(confidence))),
      reason: typeof parsed.reason === "string" ? parsed.reason.trim().slice(0, 300) : "The message matches the same recorded intervention and outcome.",
      record: input.candidates[candidateIndex],
    };
  } catch (error) {
    if (error instanceof HermesUnavailableError || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function openSlackAskModal(input: { initialQuestion?: string; teamId?: string; triggerId?: string }): Promise<{ opened: boolean; reason?: string }> {
  if (!input.teamId || !input.triggerId) return { opened: false, reason: "invalid_request" };
  const connection = (await findConnection(input.teamId))[0];
  if (!connection) return { opened: false, reason: "workspace_not_connected" };
  const credential = await loadConnectionCredential(connection.id);
  await slackApi("views.open", credential.accessToken, {
    trigger_id: input.triggerId,
    view: buildSlackAskInputModal(input.initialQuestion ?? ""),
  });
  return { opened: true };
}

export async function publishSlackHome(input: { teamId: string; userId: string }): Promise<void> {
  const connection = (await findConnection(input.teamId))[0];
  if (!connection) return;
  const credential = await loadConnectionCredential(connection.id);
  await slackApi("views.publish", credential.accessToken, {
    user_id: input.userId,
    view: {
      type: "home",
      blocks: [
        { type: "header", text: { type: "plain_text", text: "Found memory" } },
        { type: "section", text: { type: "mrkdwn", text: "Found stays silent in public channels unless you explicitly ask. Use *Ask Found* for private company-memory answers, or the *Check with Found* message shortcut for prior-work battlecards in Slack web or desktop." } },
        { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Ask Found" }, action_id: "found_open_ask", style: "primary" }] },
        { type: "context", elements: [{ type: "mrkdwn", text: "Private to you · answers are grounded in indexed company memory and source receipts." }] },
      ],
    },
  });
}

export async function respondToSlackMention(input: { channelId: string; teamId: string; text: string; threadTs?: string; userId: string }): Promise<void> {
  const question = input.text.replace(/<@[^>]+>/g, " ").replace(/^ask\b[:\s-]*/i, "").trim();
  if (!isExplicitSlackAskFoundQuestion(question)) return;
  const connection = (await findConnection(input.teamId))[0];
  if (!connection) return;
  const credential = await loadConnectionCredential(connection.id);
  const result = await answerSlackQuestion({ question, teamId: input.teamId });
  await slackApi("chat.postEphemeral", credential.accessToken, {
    channel: input.channelId,
    user: input.userId,
    thread_ts: input.threadTs,
    text: formatSlackAnswerText(result.answer, result.sources),
    unfurl_links: false,
    unfurl_media: false,
  });
}

function isExplicitSlackAskFoundQuestion(question: string): boolean {
  const clean = question.trim();
  if (clean.length < 4 || CASUAL.test(clean) || CATALOGUE.test(clean)) return false;
  return /\b(?:ask found|found\s+(?:ask|check)|company knowledge|prior work|duplicate|already\s+(?:decided|discussed|tried|built|measured|recorded)|has this been discussed|have we\s+(?:decided|discussed|tried|built|measured|recorded)|did we\s+(?:decide|discuss|try|build|measure|record)|what\s+(?:did|do|does|have|has|was|were)\s+(?:we|the company|customers?|team)|who\s+(?:owns|owned)|source receipt|what source|status|decision|decided|measurement problem|prove roi)\b/i.test(clean);
}

export async function postSlackAskResponse(input: { question: string; responseUrl: string; teamId?: string }): Promise<void> {
  const result = await answerSlackQuestion({ question: input.question, teamId: input.teamId }).catch(() => ({
    answer: "Found could not answer from company memory right now.",
    sources: [],
  }));
  await fetch(input.responseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      response_type: "ephemeral",
      text: formatSlackAnswerText(result.answer, result.sources),
      unfurl_links: false,
      unfurl_media: false,
    }),
    signal: AbortSignal.timeout(SLACK_REQUEST_TIMEOUT_MS),
  }).catch(() => undefined);
}

export async function answerSlackQuestion(input: { question: string; teamId?: string }): Promise<SlackQuestionAnswer> {
  const question = input.question.trim().slice(0, 700);
  if (!input.teamId || question.length < 4) {
    return { answer: "Ask Found a company-knowledge question with at least four characters.", sources: [] };
  }
  const connection = (await findConnection(input.teamId))[0];
  if (!connection) {
    return { answer: "Found is not connected to this Slack workspace yet. Connect Slack from Found integrations first.", sources: [] };
  }
  const [records, updates] = await Promise.all([
    serviceRest<SlackAskRecord[]>(`/knowledge_records?select=source,external_id,title,body,author_name,department,source_url,metadata&organisation_id=eq.${encodeURIComponent(connection.organisation_id)}&order=source_updated_at.desc&limit=80`),
    serviceRest<SlackAskUpdate[]>(`/memory_updates?select=current_title,update_text,origin,original_source_url,created_at&organisation_id=eq.${encodeURIComponent(connection.organisation_id)}&order=created_at.desc&limit=20`).catch(() => []),
  ]);
  const prompt = buildSlackAskPrompt({ question, records: rankSlackAskRecords(records, question).slice(0, 10), updates: updates.slice(0, 8) });
  try {
    const answer = await queryHermes(prompt, connection.organisation_id);
    return {
      answer,
      sources: rankSlackAskRecords(records, question).slice(0, 3).map(record => ({ title: record.title, url: record.source_url })),
    };
  } catch (error) {
    if (error instanceof HermesUnavailableError) {
      return { answer: "Hermes is temporarily unavailable, so Found is staying silent instead of guessing.", sources: [] };
    }
    throw error;
  }
}

/**
 * Returns only human users and public channels that the installed app can
 * actually reach. This is called from an explicitly opened browser share
 * surface; Slack ingestion never invokes it and never posts messages.
 */
export async function listSlackBrowserShareTargets(organisationId: string): Promise<{ channels: SlackShareTarget[]; users: SlackShareTarget[] }> {
  const connection = (await findOrganisationConnection(organisationId))[0];
  if (!connection) throw new Error("slack_not_connected");
  const credential = await loadConnectionCredential(connection.id);
  const [userResult, channelResult] = await Promise.allSettled([
    slackApi<{ members?: SlackUser[] }>("users.list?limit=200", credential.accessToken),
    listShareableChannels(credential.accessToken, hasSlackScope(connection, "chat:write.public")),
  ]);
  if (userResult.status === "rejected" && channelResult.status === "rejected") {
    throw userResult.reason instanceof Error ? userResult.reason : new Error("slack_targets_unavailable");
  }
  const userPayload = userResult.status === "fulfilled" ? userResult.value : { members: [] };
  const channels = channelResult.status === "fulfilled" ? channelResult.value : [];
  const users = (userPayload.members ?? [])
    .filter(user => user.id && !user.deleted && !user.is_bot && user.id !== "USLACKBOT")
    .map(user => ({
      id: user.id!,
      displayName: user.profile?.display_name || user.profile?.real_name || user.real_name || user.name || "Slack teammate",
      type: "user" as const,
      ...(user.profile?.email ? { email: user.profile.email } : {}),
      ...(user.profile?.image_48 ? { avatar: user.profile.image_48 } : {}),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { channels, users };
}

/**
 * Shares a browser page only after a user selects recipients in the extension.
 * There are deliberately no call sites from Slack event ingestion.
 */
export async function shareBrowserPageToSlack(input: SlackBrowserShare): Promise<{ sent: number }> {
  const recipients = dedupeRecipients(input.recipients).slice(0, 20);
  if (!recipients.length) return { sent: 0 };
  const connection = (await findOrganisationConnection(input.organisationId))[0];
  if (!connection) throw new Error("slack_not_connected");
  const credential = await loadConnectionCredential(connection.id);
  const [userPayload, channels] = await Promise.all([
    slackApi<{ members?: SlackUser[] }>("users.list?limit=200", credential.accessToken),
    listShareableChannels(credential.accessToken, hasSlackScope(connection, "chat:write.public")),
  ]);
  const validUsers = new Set((userPayload.members ?? []).filter(user => user.id && !user.deleted && !user.is_bot && user.id !== "USLACKBOT").map(user => user.id!));
  const validChannels = new Set(channels.map(channel => channel.id));
  const message = buildBrowserShareMessage(input);
  let sent = 0;
  for (const recipient of recipients) {
    if (recipient.type === "user") {
      if (!validUsers.has(recipient.id)) continue;
      const opened = await slackApi<{ channel?: { id?: string } }>("conversations.open", credential.accessToken, { users: recipient.id });
      if (!opened.channel?.id) continue;
      await slackApi("chat.postMessage", credential.accessToken, { channel: opened.channel.id, text: message, unfurl_links: true, unfurl_media: true });
      sent += 1;
      continue;
    }
    if (!validChannels.has(recipient.id)) continue;
    await slackApi("chat.postMessage", credential.accessToken, { channel: recipient.id, text: message, unfurl_links: true, unfurl_media: true });
    sent += 1;
  }
  return { sent };
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
        const match = inferSlackMemory(message.text);
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

async function listShareableChannels(accessToken: string, allowPublicPost = false): Promise<SlackShareTarget[]> {
  const query = new URLSearchParams({ exclude_archived: "true", limit: "200", types: "public_channel" });
  const payload = await slackApi<{ channels?: SlackChannel[] }>(`conversations.list?${query}`, accessToken);
  return (payload.channels ?? [])
    .filter(channel => channel.id && channel.name && !channel.is_archived && (allowPublicPost || channel.is_member))
    .map(channel => ({ displayName: `#${channel.name!}`, id: channel.id!, name: channel.name!, type: "channel" as const }))
    .sort((a, b) => a.name.localeCompare(b.name));
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

async function slackApi<T>(method: string, accessToken: string, body?: unknown): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: { authorization: `Bearer ${accessToken}`, ...(body ? { "content-type": "application/json; charset=utf-8" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(SLACK_REQUEST_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => null) as (T & { error?: string; ok?: boolean }) | null;
  if (!response.ok || !payload?.ok) throw new Error(payload?.error ?? "Slack API request failed.");
  return payload;
}

function buildBattlecardModal(match: SlackPriorWorkMatch, sourceText: string) {
  const record = match.record;
  const sourceLink = safeSlackSourceUrl(record.source_url);
  return {
    type: "modal",
    callback_id: "found_slack_battlecard",
    title: { type: "plain_text", text: "Found" },
    close: { type: "plain_text", text: "Close" },
    submit: { type: "plain_text", text: "Ask Found" },
    private_metadata: JSON.stringify({ sourceText: sourceText.slice(0, 900), title: record.title }),
    blocks: [
      { type: "header", text: { type: "plain_text", text: "Prior work found" } },
      { type: "section", text: { type: "mrkdwn", text: `*${escapeSlackText(record.title)}*\n${match.confidence}% · ${match.classification.replace("_", " ")}\nOwner: ${escapeSlackText(record.author_name ?? "Owner not indexed")}\nDepartment: ${escapeSlackText(record.department ?? "Unknown")}\nStatus: ${escapeSlackText(record.metadata?.status ?? "Indexed")}` } },
      { type: "section", text: { type: "mrkdwn", text: `*Why it matched*\n${escapeSlackText(match.reason)}` } },
      { type: "section", text: { type: "mrkdwn", text: `*Selected message*\n>${escapeSlackText(sourceText).slice(0, 900).replace(/\n/g, "\n>")}` } },
      ...(sourceLink ? [{ type: "section", text: { type: "mrkdwn", text: `*Source receipt*\n<${sourceLink}|Open ${escapeSlackText(record.source)} evidence>` } }] : []),
      { type: "input", block_id: "found_ask", optional: false, label: { type: "plain_text", text: "Ask Found" }, element: { type: "plain_text_input", action_id: "question", max_length: 700, placeholder: { type: "plain_text", text: "Ask who owns this, what changed, or what source says…" } } },
      { type: "context", elements: [{ type: "mrkdwn", text: "Private to you · no public channel reply was posted." }] },
    ],
  };
}

function buildSlackBattlecardLoadingModal(sourceText: string) {
  return {
    type: "modal",
    callback_id: "found_slack_battlecard_loading",
    title: { type: "plain_text", text: "Found" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      { type: "header", text: { type: "plain_text", text: "Checking prior work" } },
      { type: "section", text: { type: "mrkdwn", text: `*Selected message*\n>${escapeSlackText(sourceText).slice(0, 900).replace(/\n/g, "\n>")}` } },
      { type: "context", elements: [{ type: "mrkdwn", text: "Private to you · Hermes is checking indexed company evidence." }] },
    ],
  };
}

function buildSlackNoMatchModal(sourceText: string) {
  return {
    type: "modal",
    title: { type: "plain_text", text: "Found" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      { type: "header", text: { type: "plain_text", text: "No strong prior-work match" } },
      { type: "section", text: { type: "mrkdwn", text: "Found did not find exact, same-idea, or conflicting prior work in indexed company evidence." } },
      { type: "section", text: { type: "mrkdwn", text: `*Selected message*\n>${escapeSlackText(sourceText).slice(0, 900).replace(/\n/g, "\n>")}` } },
      { type: "context", elements: [{ type: "mrkdwn", text: "Private to you · related but materially different work is not shown as a duplicate." }] },
    ],
  };
}

function buildSlackAskInputModal(initialQuestion: string) {
  return {
    type: "modal",
    callback_id: "found_ask_modal",
    title: { type: "plain_text", text: "Ask Found" },
    close: { type: "plain_text", text: "Close" },
    submit: { type: "plain_text", text: "Ask" },
    blocks: [
      { type: "input", block_id: "found_ask", optional: false, label: { type: "plain_text", text: "Company-memory question" }, element: { type: "plain_text_input", action_id: "question", initial_value: initialQuestion.slice(0, 700) || undefined, max_length: 700, multiline: true, placeholder: { type: "plain_text", text: "Example: Do our customers have a measurement problem?" } } },
      { type: "context", elements: [{ type: "mrkdwn", text: "Found answers privately and only from indexed company memory." }] },
    ],
  };
}

export function buildSlackAskAnswerModal(input: { answer: string; question: string; sources: Array<{ title: string; url: string }> }) {
  const sourceLines = input.sources.length
    ? input.sources.map(source => `• <${source.url}|${escapeSlackText(source.title).slice(0, 90)}>`).join("\n")
    : "No source receipts available.";
  return {
    type: "modal",
    title: { type: "plain_text", text: "Found" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      { type: "header", text: { type: "plain_text", text: "Ask Found" } },
      { type: "section", text: { type: "mrkdwn", text: `*Question*\n${escapeSlackText(input.question).slice(0, 700)}` } },
      { type: "section", text: { type: "mrkdwn", text: `*Answer from company memory*\n${escapeSlackText(input.answer).slice(0, 2600)}` } },
      { type: "section", text: { type: "mrkdwn", text: `*Source receipts*\n${sourceLines}` } },
      { type: "context", elements: [{ type: "mrkdwn", text: "Private to you · Found answers only from indexed company memory." }] },
    ],
  };
}

export function buildSlackAskLoadingModal(question: string) {
  return {
    type: "modal",
    callback_id: "found_ask_loading",
    title: { type: "plain_text", text: "Ask Found" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      { type: "header", text: { type: "plain_text", text: "Checking company memory" } },
      { type: "section", text: { type: "mrkdwn", text: `*Question*\n${escapeSlackText(question).slice(0, 700)}` } },
      { type: "context", elements: [{ type: "mrkdwn", text: "Found is searching indexed source receipts. This modal will update privately." }] },
    ],
  };
}

export async function updateSlackAskModalWithAnswer(input: { question: string; teamId: string; viewId: string }): Promise<void> {
  const connection = (await findConnection(input.teamId))[0];
  if (!connection) return;
  const [credential, result] = await Promise.all([
    loadConnectionCredential(connection.id),
    answerSlackQuestion({ question: input.question, teamId: input.teamId }).catch(() => ({ answer: "Found could not answer from company memory right now.", sources: [] })),
  ]);
  await slackApi("views.update", credential.accessToken, {
    view_id: input.viewId,
    view: buildSlackAskAnswerModal({ answer: result.answer, question: input.question, sources: result.sources }),
  });
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
  const match = inferSlackMemory(message.text);
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
  const sourceRecordId = input.match.sourceRecordId ?? externalId;
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
    body: JSON.stringify({ current_title:input.match.title,external_event_id:input.eventId,organisation_id:connection.organisation_id,origin:"slack",original_source_url:sourceUrl,source_record_id:sourceRecordId,update_source_url:sourceUrl,update_text:input.text }),
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, method: "POST",
  });
}

function inferSlackDepartment(text: string): string {
  const normalised = text.toLowerCase();
  if (/\b(deploy|developer|code|incident|api|service|platform|harness)\b/.test(normalised)) return "Engineering";
  if (/\b(campaign|gtm|marketing|launch|activation|growth)\b/.test(normalised)) return "GTM";
  if (/\b(sales|account|abm|pipeline|call center|contact center|support|customer|proof of value|roi)\b/.test(normalised)) return "Sales";
  if (/\b(research|competitor|market|article)\b/.test(normalised)) return "Research";
  return "Product";
}

function inferSlackTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const labelled = cleaned.match(/\b(?:title|proposal|decision|idea|initiative)\s*:\s*([^.!?\n]{8,120})/i)?.[1];
  const firstSentence = cleaned.match(/^.{20,120}?(?:[.!?]|$)/)?.[0];
  const title = (labelled || firstSentence || cleaned).replace(/[.!?]+$/, "").trim();
  return title.length > 90 ? `${title.slice(0, 89).trim()}…` : title;
}

async function findConnection(teamId: string): Promise<SlackConnection[]> {
  return serviceRest(`/integration_connections?select=id,organisation_id,granted_scopes&provider=eq.slack&external_workspace_id=eq.${encodeURIComponent(teamId)}&status=in.(connected,pending)&order=updated_at.desc&limit=1`);
}

async function findOrganisationConnection(organisationId: string): Promise<SlackConnection[]> {
  return serviceRest(`/integration_connections?select=id,organisation_id,granted_scopes&provider=eq.slack&organisation_id=eq.${encodeURIComponent(organisationId)}&status=in.(connected,pending)&order=updated_at.desc&limit=1`);
}

function hasSlackScope(connection: SlackConnection, scope: string): boolean {
  return Array.isArray(connection.granted_scopes) && connection.granted_scopes.includes(scope);
}

function dedupeRecipients(recipients: SlackShareRecipient[]): SlackShareRecipient[] {
  const seen = new Set<string>();
  return recipients.filter(recipient => {
    if (!recipient?.id || !["channel", "user"].includes(recipient.type)) return false;
    const key = `${recipient.type}:${recipient.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildBrowserShareMessage(input: SlackBrowserShare): string {
  const title = escapeSlackText(input.pageTitle).slice(0, 220);
  const note = input.note?.trim() ? `\n${escapeSlackText(input.note.trim()).slice(0, 1200)}` : "";
  const department = escapeSlackText(input.department).slice(0, 40);
  const sender = escapeSlackText(input.senderEmail).slice(0, 200);
  return `*${title}*\n${input.pageUrl}${note}\n_Shared from Found by ${sender} · ${department}_`;
}

function formatSlackAnswerText(answer: string, sources: Array<{ title: string; url: string }>): string {
  const sourceText = sources.length
    ? `\n\n*Sources*\n${sources.map(source => `• <${source.url}|${escapeSlackText(source.title).slice(0, 90)}>`).join("\n")}`
    : "";
  return `*Ask Found*\n${escapeSlackText(answer).slice(0, 2800)}${sourceText}`;
}

function escapeSlackText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type SlackAskRecord = { author_name: string | null; body: string; department: string | null; external_id: string; metadata: { status?: string } | null; source: string; source_url: string; title: string };
type SlackAskUpdate = { created_at: string; current_title: string; origin: string; original_source_url: string; update_text: string };

function buildSlackAskPrompt(input: { question: string; records: SlackAskRecord[]; updates: SlackAskUpdate[] }): string {
  return `You are Hermes, Found's Slack-native company memory layer.
Answer this Slack user only from the source receipts and append-only memory updates below.
If evidence is insufficient, reply exactly: I couldn’t find enough evidence in company knowledge to answer this.
Do not add generic advice, outside knowledge, or assumptions.
Keep the answer concise and cite source names/links inline.

Question:
${input.question}

Source receipts:
${input.records.map((record, index) => `${index + 1}. ${record.source} · ${record.title}
Owner: ${record.author_name ?? "Owner not indexed"}
Department: ${record.department ?? "Unknown"}
Status: ${record.metadata?.status ?? "Indexed"}
Link: ${record.source_url}
Evidence: ${record.body.slice(0, 1200)}`).join("\n\n") || "None indexed."}

Memory updates:
${input.updates.map((update, index) => `${index + 1}. ${update.origin} · ${update.created_at}
Title: ${update.current_title}
Link: ${update.original_source_url}
Update: ${update.update_text.slice(0, 700)}`).join("\n\n") || "None indexed."}`;
}

function rankSlackAskRecords(records: SlackAskRecord[], question: string): SlackAskRecord[] {
  const terms = new Set(question.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
  if (!terms.size) return records;
  return records
    .map(record => {
      const haystack = `${record.title} ${record.department ?? ""} ${record.body}`.toLowerCase();
      let score = 0;
      for (const term of terms) if (haystack.includes(term)) score += 1;
      return { record, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(item => item.record);
}

function safeSlackSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
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
