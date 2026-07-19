import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = path => readFile(new URL(path, root), "utf8");

test("Slack OAuth permits silent ingestion plus explicit user-initiated sharing", async () => {
  const [route, scopes, catalog] = await Promise.all([
    source("app/auth/slack/route.ts"),
    source("lib/integrations/slack-scopes.ts"),
    source("lib/integrations/catalog.ts"),
  ]);
  for (const text of [route, scopes, catalog]) {
    assert.doesNotMatch(text, /groups:(?:history|read)/);
  }
  assert.match(route, /SLACK_REQUIRED_SCOPES/);
  assert.match(scopes, /"channels:history"/);
  assert.match(scopes, /"channels:read"/);
  assert.match(scopes, /"users:read"/);
  assert.match(scopes, /"users:read.email"/);
  assert.match(scopes, /"im:write"/);
  assert.match(scopes, /"chat:write"/);
  assert.match(scopes, /"chat:write.public"/);
});

test("Slack signed ingestion remains bound while private delivery fails closed and retries", async () => {
  const [callback, slack] = await Promise.all([
    source("app/auth/slack/callback/route.ts"),
    source("lib/integrations/slack-events.ts"),
  ]);
  assert.match(callback, /missingSlackScopes/);
  assert.match(callback, /status: missingScopes\.length \? "attention" : "connected"/);
  assert.match(slack, /function findWorkspaceBinding/);
  assert.match(slack, /status=in\.\(connected,attention\)/);
  assert.match(slack, /appendSlackMemory[\s\S]*findWorkspaceBinding/);
  assert.match(slack, /missingSlackScopes\(connection\.granted_scopes, SLACK_PRIVATE_DM_SCOPES\)/);
  assert.match(slack, /slack_workspace_requires_reauthorisation/);
  assert.match(slack, /status: "failed", error_code: "slack_event_processing_failed"/);
  assert.doesNotMatch(slack, /HermesUnavailableError \|\| error instanceof SyntaxError\) return null/);
});

test("Slack Ask Found retrieves exact structured IDs beyond the recent-record window", async () => {
  const slack = await source("lib/integrations/slack-events.ts");
  assert.match(slack, /extractStructuredIdentifiers/);
  assert.match(slack, /loadStructuredSlackAskRecords\(connection\.organisation_id, retrievalText\)/);
  assert.match(slack, /loadLegacyExactIdentifierRecords\(connection\.organisation_id, retrievalText\)/);
  assert.match(slack, /uniqueSlackAskRecords\(\[\.\.\.structuredRecords, \.\.\.legacyExactRecords, \.\.\.recentRecords\]\)/);
  assert.match(slack, /selectEvidenceExcerpt\(record\.body, input\.question, 1200\)/);
});

test("the production Slack manifest wires web and desktop native surfaces", async () => {
  const manifest = await source("public/found-slack-app-manifest.yaml");
  assert.match(manifest, /name: Found Memory/);
  assert.match(manifest, /display_name: found-memory/);
  assert.match(manifest, /name: Ask company memory/);
  for (const scope of ["app_mentions:read", "channels:history", "channels:read", "chat:write", "commands", "im:history", "im:write", "users:read", "users:read.email"]) {
    assert.match(manifest, new RegExp(`- ${scope.replace(".", "\\.")}`));
  }
  assert.match(manifest, /callback_id: found_ask/);
  assert.match(manifest, /callback_id: found_check_prior_work/);
  assert.match(manifest, /command: \/found/);
  assert.match(manifest, /messages_tab_enabled: true/);
  assert.match(manifest, /bot_events:[\s\S]*- app_home_opened[\s\S]*- app_mention[\s\S]*- message\.channels[\s\S]*- message\.im/);
  assert.match(manifest, /request_url: https:\/\/sage-profiterole-3b1c22\.netlify\.app\/api\/slack\/interactions/);
  assert.match(manifest, /token_rotation_enabled: true/);
});

test("Slack OAuth persists rotating credentials and refreshes them safely", async () => {
  const [callback, credentials, ingestion] = await Promise.all([
    source("app/auth/slack/callback/route.ts"),
    source("lib/integrations/credentials.ts"),
    source("lib/integrations/slack-events.ts"),
  ]);
  assert.match(callback, /refresh_token\?: string/);
  assert.match(callback, /expires_in\?: number/);
  assert.match(callback, /encryptIntegrationSecret\(JSON\.stringify\(\{/);
  assert.match(callback, /refreshToken: installation\.refresh_token/);
  assert.match(callback, /expiresAt: installation\.expires_in/);
  assert.match(callback, /!installation\.refresh_token \|\| !installation\.expires_in/);
  assert.match(credentials, /export async function loadSlackConnectionCredential/);
  assert.match(credentials, /https:\/\/slack\.com\/api\/oauth\.v2\.access/);
  assert.match(credentials, /authorization: `Basic \$\{Buffer\.from/);
  assert.match(credentials, /grant_type: "refresh_token"/);
  assert.match(credentials, /payload\.refresh_token/);
  assert.match(credentials, /Another serverless invocation may have rotated the one-time refresh token/);
  assert.match(credentials, /encryptIntegrationSecret\(JSON\.stringify\(credential\)\)/);
  assert.match(ingestion, /loadSlackConnectionCredential/);
  assert.doesNotMatch(ingestion, /loadConnectionCredential/);
});

test("continuous ingestion is durable, silent, and authenticated", async () => {
  const route = await source("app/api/slack/events/route.ts");
  const worker = await source("app/api/internal/ingestion/run/route.ts");
  const migration = await source("supabase/migrations/0004_continuous_ingestion.sql");
  const google = await source("lib/integrations/google-sync.ts");
  const slack = await source("lib/integrations/slack-events.ts");
  assert.match(route, /enqueueSlackEvent/);
  assert.doesNotMatch(route, /chat\.postMessage/);
  assert.match(worker, /INGESTION_CRON_SECRET/);
  assert.match(worker, /timingSafeEqual/);
  assert.match(migration, /unique \(provider, external_event_id\)/);
  assert.match(google, /changes\/startPageToken/);
  assert.match(google, /newStartPageToken/);
  assert.match(google, /GOOGLE_SYNC_TIMEOUT_MS = 20_000/);
  assert.match(google, /const controller = new AbortController\(\)/);
  assert.match(google, /parentSignal\?\.addEventListener\("abort", abort/);
  assert.match(slack, /integration_sync_runs\?on_conflict=id/);
  assert.match(slack, /status: "succeeded"/);
  assert.match(slack, /status: "failed"[\s\S]*error_code: "slack_backfill_failed"/);
  assert.doesNotMatch(slack, /status: "running"/);
  assert.doesNotMatch(slack, /status=in\.\(connected,pending,attention\)/);
});

test("browser battle cards use authenticated tenant memory", async () => {
  const [route, session, token, extension, background] = await Promise.all([
    source("app/api/browser/match/route.ts"),
    source("app/api/browser/session/route.ts"),
    source("lib/auth/browser-token.ts"),
    source("extension/content.js"),
    source("extension/background.js"),
  ]);
  assert.match(session, /getFoundUser/);
  assert.match(session, /getFoundWorkspace/);
  assert.match(token, /createHmac/);
  assert.match(token, /timingSafeEqual/);
  assert.match(route, /verifyBrowserToken/);
  assert.match(route, /organisation_id=eq/);
  assert.match(route, /chrome-extension/);
  assert.match(route, /authorization, content-type/);
  assert.doesNotMatch(route, /integration_secrets/);
  assert.match(extension, /type: "found:match-page"/);
  assert.doesNotMatch(extension, /Bearer \$\{token\}|\/api\/browser\/match/);
  assert.match(background, /Bearer \$\{token\}/);
  assert.match(background, /\/api\/browser\/match/);
  assert.match(extension, /google.*search/);
  assert.doesNotMatch(extension, /credentials:\s*"include"/);
});

test("browser Ask Found stays tenant-scoped and closed-world", async () => {
  const [askRoute, content, background] = await Promise.all([
    source("app/api/browser/ask/route.ts"),
    source("extension/content.js"),
    source("extension/background.js"),
  ]);
  assert.match(askRoute, /verifyBrowserToken/);
  assert.match(askRoute, /\/memberships\?select=id&organisation_id=eq/);
  assert.match(askRoute, /\/knowledge_records\?select=/);
  assert.match(askRoute, /organisation_id=eq\.\$\{encodeURIComponent\(token\.organisationId\)\}/);
  assert.match(askRoute, /\/memory_updates\?select=/);
  assert.match(askRoute, /queryHermes/);
  assert.match(askRoute, /I couldn’t find enough evidence in company knowledge to answer this/);
  assert.doesNotMatch(askRoute, /getFoundUser|integration_secrets|PATCH|PUT|DELETE/);
  assert.match(content, /type: "found:ask-hermes"/);
  assert.match(content, /Ask Found is checking indexed source receipts and memory updates/);
  assert.match(content, /Ask Found is temporarily unavailable/);
  assert.doesNotMatch(content, /Hermes is checking indexed source receipts|Hermes could not answer/);
  assert.doesNotMatch(content, /\/api\/browser\/ask|authorization: `Bearer/);
  assert.match(background, /\/api\/browser\/ask/);
  assert.match(background, /hermes_unavailable/);
});

test("browser matching uses Hermes as the final non-exact battlecard decision layer", async () => {
  const route = await source("app/api/browser/match/route.ts");
  assert.match(route, /reviewBrowserMatchWithHermes/);
  assert.match(route, /queryHermes/);
  assert.match(route, /show=true only when the open page is the same concrete work/);
  assert.match(route, /show=false for merely same industry, same vendor, broad AI\/research overlap/);
  assert.match(route, /If unsure, show=false/);
  assert.match(route, /parsed\.confidence/);
  assert.match(route, /hermes_unavailable/);
  assert.match(route, /exactOpenCompanySource/);
  assert.match(route, /return NextResponse\.json\(\{ match: null, reason: hermesVerdict\.reason \}/);
});

test("workspace Ask Found uses indexed memory and stays closed-world", async () => {
  const [route, dashboard] = await Promise.all([
    source("app/api/knowledge/query/route.ts"),
    source("app/workspace/workspace-dashboard.tsx"),
  ]);
  assert.match(route, /getFoundUser/);
  assert.match(route, /getFoundWorkspace/);
  assert.match(route, /listWorkspaceKnowledgeRecords\(workspace\.organisationId,\s*80\)/);
  assert.match(route, /listMemoryUpdates\(workspace\.organisationId\)/);
  assert.match(route, /queryHermes\(evidencePrompt,\s*workspace\.organisationId\)/);
  assert.match(route, /I couldn’t find enough evidence in company knowledge to answer this/);
  assert.match(route, /Do not add external knowledge, generic frameworks, assumptions, or advice/);
  assert.doesNotMatch(route, /internet|web search|fetch\(["']https?:\/\//i);
  assert.match(dashboard, /\/api\/knowledge\/query/);
  assert.match(dashboard, /ASK FOUND/);
  assert.match(dashboard, /Closed-world/);
  assert.match(dashboard, /Powered by Hermes|POWERED BY HERMES|underlying engine/);
});

test("decision timelines include a private Ask Found entry point", async () => {
  const decision = await source("app/workspace/decision/[recordId]/page.tsx");
  assert.match(decision, /const askFoundHref=`\/workspace\?ask=/);
  assert.match(decision, /ASK FOUND ABOUT THIS RECORD/);
  assert.match(decision, /Hermes answers only from indexed company memory/);
  assert.doesNotMatch(decision, /Ask Hermes/);
});

test("Google ingestion isolates unreadable files and always records a terminal run", async () => {
  const google = await source("lib/integrations/google-sync.ts");
  assert.match(google, /mapSettledWithConcurrency\([\s\S]*toKnowledgeRecords/);
  assert.match(google, /status: unreadableFiles \? "partial" : "succeeded"/);
  assert.match(google, /error_code: unreadableFiles \? "google_files_unreadable" : null/);
  assert.match(google, /status: "failed",[\s\S]*error_code: errorCode/);
  assert.match(google, /integration_sync_runs\?on_conflict=id/);
  assert.match(google, /resolution=merge-duplicates,return=minimal/);
  assert.doesNotMatch(google, /error_code:\s*(?:error\b|reason\b|result\.reason)/);
});

test("Google ingestion skips uncredentialed seeds and preserves incremental cursors", async () => {
  const google = await source("lib/integrations/google-sync.ts");
  assert.match(google, /integration_secrets!inner\(connection_id\)/);
  assert.match(google, /const nextCursor = await getStartPageToken\(accessToken, signal\);[\s\S]*const files = await listFiles\(accessToken, signal\)/);
  assert.match(google, /let nextCursor = cursor/);
  assert.match(google, /if \(payload\.newStartPageToken\) nextCursor = payload\.newStartPageToken/);
  assert.match(google, /cursor: delta\.nextCursor/);
});

test("Google ingestion is not limited to bracket-prefixed demo document names", async () => {
  const google = await source("lib/integrations/google-sync.ts");
  assert.match(google, /function isReadableWorkspaceFile/);
  assert.doesNotMatch(google, /name contains '\['/);
  assert.match(google, /function inferDepartment/);
  assert.match(google, /call center/);
  assert.match(google, /human in the loop/);
});

test("Google Sheets are indexed as stable searchable rows and stale rows are removed", async () => {
  const [google, rows, slack, workspace, workspaceAsk, browserAsk, migration] = await Promise.all([
    source("lib/integrations/google-sync.ts"),
    source("lib/integrations/google-sheet-records.ts"),
    source("lib/integrations/slack-events.ts"),
    source("lib/auth/workspace.ts"),
    source("app/api/knowledge/query/route.ts"),
    source("app/api/browser/ask/route.ts"),
    source("supabase/migrations/0006_google_sheet_rows.sql"),
  ]);
  assert.match(google, /sheets\.googleapis\.com/);
  assert.match(google, /values:batchGet/);
  assert.match(google, /KNOWLEDGE_WRITE_BATCH_SIZE/);
  assert.match(google, /GOOGLE_FILE_CONCURRENCY/);
  assert.match(google, /mapSettledWithConcurrency/);
  assert.match(google, /deleteStaleSheetRows/);
  assert.match(google, /metadata->>google_sync_generation/);
  assert.match(google, /deleteGoogleFiles/);
  assert.match(rows, /record_kind: "sheet_row"/);
  assert.match(rows, /row_key_normalized/);
  assert.match(rows, /next_action/);
  assert.match(rows, /ready_for_dispatch/);
  assert.match(slack, /loadStructuredSlackAskRecords/);
  assert.match(slack, /metadata->>record_kind/);
  assert.match(slack, /metadata->>row_key_normalized/);
  assert.match(workspace, /findWorkspaceGoogleSheetRows/);
  assert.match(workspace, /metadata->>row_key_normalized/);
  assert.match(workspaceAsk, /extractStructuredIdentifiers/);
  assert.match(workspaceAsk, /findWorkspaceGoogleSheetRows/);
  assert.match(browserAsk, /loadStructuredGoogleSheetRows/);
  assert.match(browserAsk, /metadata->>row_key_normalized/);
  assert.match(migration, /knowledge_records_google_sheet_row_key_idx/);
  assert.match(migration, /knowledge_records_google_sheet_file_generation_idx/);
});

test("Slack event ingestion enforces signatures, a five-minute timestamp window, and message permalinks", async () => {
  const [route, ingestion] = await Promise.all([
    source("app/api/slack/events/route.ts"),
    source("lib/integrations/slack-events.ts"),
  ]);
  assert.match(route, /x-slack-request-timestamp/);
  assert.match(route, /x-slack-signature/);
  assert.match(route, /\^\\d\{10\}\$/);
  assert.match(route, /> 300/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /invalid_request/);
  assert.match(ingestion, /\/p\$\{encodeURIComponent\(messageId\)\}/);
});

test("Slack event ingestion stores broader work intent beyond hardcoded demo clusters", async () => {
  const slack = await source("lib/integrations/slack-events.ts");
  assert.match(slack, /function inferSlackDepartment/);
  assert.match(slack, /function inferSlackTitle/);
  assert.match(slack, /inferSlackMemory\(message\.text\)/);
  assert.match(slack, /voice agent/);
  assert.match(slack, /call center/);
  assert.match(slack, /const sourceRecordId = input\.match\.sourceRecordId \?\? externalId/);
});

test("Slack desktop users get a private native battlecard surface, not public bot noise", async () => {
  const [route, slack] = await Promise.all([
    source("app/api/slack/interactions/route.ts"),
    source("lib/integrations/slack-events.ts"),
  ]);
  assert.match(route, /x-slack-request-timestamp/);
  assert.match(route, /x-slack-signature/);
  assert.match(route, /message_action/);
  assert.match(route, /openSlackBattlecard/);
  assert.match(slack, /views\.open/);
  assert.match(slack, /type: "modal"/);
  assert.match(slack, /Private to you/);
  assert.doesNotMatch(route, /chat\.postMessage/);
  assert.match(slack, /shareBrowserPageToSlack/);
  assert.match(slack, /conversations\.open/);
  assert.match(slack, /chat\.postMessage/);
  assert.match(slack, /There are deliberately no call sites from Slack event ingestion/);
});

test("Slack native Ask Found is signed, private, and source-grounded", async () => {
  const [commands, interactions, slack, hermesContract] = await Promise.all([
    source("app/api/slack/commands/route.ts"),
    source("app/api/slack/interactions/route.ts"),
    source("lib/integrations/slack-events.ts"),
    source("lib/integrations/slack-hermes-contract.mjs"),
  ]);
  assert.match(commands, /x-slack-request-timestamp/);
  assert.match(commands, /x-slack-signature/);
  assert.match(commands, /response_type: "ephemeral"/);
  assert.match(commands, /after\(\(\) => postSlackAskResponse/);
  assert.match(commands, /\/found ask/);
  assert.doesNotMatch(commands, /chat\.postMessage/);
  assert.match(interactions, /view_submission/);
  assert.match(interactions, /after\(\(\) => updateSlackAskModalWithAnswer\(\{ question, teamId:/);
  assert.match(interactions, /response_action: "update"/);
  assert.doesNotMatch(slack, /hash: input\.hash|\.\.\.\(input\.hash/);
  assert.match(slack, /answerSlackQuestion/);
  assert.match(slack, /postSlackAskResponse/);
  assert.match(slack, /reviewSlackPriorWorkWithHermes/);
  assert.match(slack, /parseHermesPriorWorkDecision/);
  assert.match(hermesContract, /confidence < 85/);
  assert.match(hermesContract, /\["exact", "same_idea", "conflict"\]/);
  assert.match(slack, /False positives are more damaging than missed weak matches/);
  assert.match(slack, /queryHermes\(prompt, input\.organisationId\)/);
  assert.match(slack, /buildSlackAskPrompt/);
  assert.match(slack, /queryHermes/);
  assert.match(slack, /I couldn’t find enough evidence in company knowledge to answer this/);
  assert.match(slack, /Do not add generic advice, outside knowledge, or assumptions/);
  assert.match(slack, /Found could not answer from company memory right now/);
  assert.doesNotMatch(slack, /Hermes is temporarily unavailable, so Found is staying silent/);
  assert.doesNotMatch(slack, /Hermes is checking indexed company evidence/);
});

test("Slack public work intent DMs only strong Hermes matches and DM follow-ups answer privately", async () => {
  const [route, slack, oauth, scopes, catalog, deliveryMigration] = await Promise.all([
    source("app/api/slack/events/route.ts"),
    source("lib/integrations/slack-events.ts"),
    source("app/auth/slack/route.ts"),
    source("lib/integrations/slack-scopes.ts"),
    source("lib/integrations/catalog.ts"),
    source("supabase/migrations/0005_slack_dm_deliveries.sql"),
  ]);
  assert.match(route, /\["channel", "im"\]\.includes\(event\.channel_type\)/);
  assert.match(route, /await enqueueSlackEvent\(payload\)/);
  assert.match(route, /processQueuedSlackEvent\(payload\.event_id!/);
  assert.match(route, /payload\.is_ext_shared_channel/);
  assert.match(route, /event\.bot_id \|\| event\.bot_profile \|\| event\.app_id/);
  assert.doesNotMatch(route, /chat\.postMessage|chat\.postEphemeral/);
  assert.match(slack, /export async function notifySlackAuthorAboutPriorWork/);
  assert.match(slack, /classifySlackMessage\(text\)/);
  assert.match(slack, /reviewSlackPriorWorkWithHermes/);
  assert.match(slack, /parseHermesPriorWorkDecision/);
  assert.match(slack, /visibility=eq\.workspace/);
  assert.match(slack, /record\.external_id !== currentExternalId/);
  assert.match(slack, /slack_dm_deliveries/);
  assert.match(slack, /event\.channel_type === "im"/);
  assert.match(slack, /respondToSlackDirectMessage/);
  assert.match(slack, /notifySlackAuthorAboutPriorWork/);
  assert.match(slack, /payload\.is_ext_shared_channel/);
  assert.match(slack, /memberTeamId === expectedTeamId/);
  assert.match(slack, /respondToSlackMention/);
  assert.match(slack, /conversations\.open/);
  assert.match(slack, /Private to you · Found did not post in the public channel/);
  assert.match(slack, /export async function respondToSlackDirectMessage/);
  assert.match(slack, /isSlackDmKnowledgeQuestion\(question\)/);
  assert.match(slack, /loadSlackDirectMessageContext/);
  assert.match(slack, /shouldDeliverSlackAnswer/);
  assert.match(slack, /parseHermesSlackAnswer/);
  assert.match(slack, /excludeExternalId: currentExternalId/);
  assert.match(slack, /record\.external_id !== input\.excludeExternalId/);
  assert.match(slack, /visibleExternalIds\.has\(update\.source_record_id\)/);
  assert.match(slack, /input\.records\.length \+ index \+ 1/);
  assert.match(slack, /Untrusted user input and evidence \(JSON\)/);
  assert.match(slack, /Untrusted Slack message and indexed evidence \(JSON\)/);
  assert.match(slack, /answerSlackQuestion/);
  assert.match(slack, /chat\.postMessage/);
  assert.match(slack, /throw new Error\("slack_workspace_requires_reauthorisation"\)/);
  assert.match(oauth, /SLACK_REQUIRED_SCOPES/);
  assert.match(scopes, /"im:history"/);
  assert.match(catalog, /"im:history"/);
  assert.match(deliveryMigration, /unique \(organisation_id, external_event_id\)/);
  assert.match(deliveryMigration, /claim_slack_dm_delivery/);
  assert.match(deliveryMigration, /claim_slack_ingestion_event/);
  assert.match(deliveryMigration, /enforce_single_slack_workspace_binding/);
  assert.doesNotMatch(deliveryMigration, /create policy/);
});

test("browser Slack sharing is tenant-authenticated and recipient constrained", async () => {
  const [targets, share, slack, background] = await Promise.all([
    source("app/api/browser/slack-targets/route.ts"),
    source("app/api/browser/slack-share/route.ts"),
    source("lib/integrations/slack-events.ts"),
    source("extension/background.js"),
  ]);
  for (const route of [targets, share]) {
    assert.match(route, /verifyBrowserToken/);
    assert.match(route, /organisation_id=eq/);
    assert.match(route, /chrome-extension/);
    assert.match(route, /workspace_access_revoked/);
    assert.doesNotMatch(route, /integration_secrets/);
  }
  assert.match(targets, /listSlackBrowserShareTargets/);
  assert.match(share, /normaliseRecipients/);
  assert.match(share, /shareBrowserPageToSlack/);
  assert.match(slack, /hasSlackScope\(connection, "chat:write.public"\)/);
  assert.match(slack, /allowPublicPost \|\| channel\.is_member/);
  assert.match(slack, /Promise\.allSettled/);
  assert.match(slack, /validUsers/);
  assert.match(slack, /validChannels/);
  assert.match(background, /slack_reconnect_required/);
});

test("exact Google source lookups are not limited to the recent-memory window", async () => {
  const route = await source("app/api/browser/match/route.ts");
  assert.match(route, /loadExactSourceRows/);
  assert.match(route, /external_id=eq/);
  assert.match(route, /source_url=ilike/);
  assert.match(route, /\[\.\.\.exactRows, \.\.\.rows\]/);
});

test("provider credentials are encrypted server-side before service-role persistence", async () => {
  const [callback, slackCallback, secrets, store, deliveryMigration] = await Promise.all([
    source("app/auth/integrations/[provider]/callback/route.ts"),
    source("app/auth/slack/callback/route.ts"),
    source("lib/integrations/secrets.ts"),
    source("lib/integrations/store.ts"),
    source("supabase/migrations/0005_slack_dm_deliveries.sql"),
  ]);
  assert.match(callback, /encryptIntegrationSecret/);
  assert.match(slackCallback, /encryptIntegrationSecret/);
  assert.match(slackCallback, /slack_workspace_already_connected/);
  assert.match(store, /IntegrationWorkspaceConflictError/);
  assert.match(deliveryMigration, /enforce_single_slack_workspace_binding/);
  assert.match(secrets, /AES-GCM/);
  assert.match(secrets, /key\.byteLength !== 32/);
  assert.match(store, /integration_secrets/);
  assert.doesNotMatch(store, /accessToken|refreshToken/);
});

test("live authentication callback does not seed fictional demo knowledge", async () => {
  const callback = await source("app/auth/callback/route.ts");
  assert.doesNotMatch(callback, /seedDemoWorkspace|DEMO_ACCESS_EMAIL/);
});

test("password login uses the server-side Supabase grant and HttpOnly session cookies", async () => {
  const [route, session] = await Promise.all([
    source("app/auth/password/route.ts"),
    source("lib/auth/session.ts"),
  ]);
  assert.match(session, /\/auth\/v1\/token\?grant_type=password/);
  assert.match(route, /signInWithPassword\(email, password\)/);
  assert.match(route, /hasSamePublicOrigin\(request\)/);
  assert.match(route, /safeReturnPath[\s\S]*"\/workspace"/);
  assert.doesNotMatch(route, /access_token|refresh_token/);
  assert.match(session, /ACCESS_COOKIE[\s\S]*httpOnly: true/);
  assert.match(session, /REFRESH_COOKIE[\s\S]*httpOnly: true/);
  assert.match(session, /secure/);
});

test("password failures are generic and secrets are not hardcoded", async () => {
  const [route, login] = await Promise.all([
    source("app/auth/password/route.ts"),
    source("app/login/page.tsx"),
  ]);
  assert.match(route, /invalid_credentials/);
  assert.doesNotMatch(route + login, /anuj\.modi@nurix\.ai/i);
  assert.doesNotMatch(login, /user not found|wrong password|password is invalid/i);
  assert.match(login, /email or password is incorrect/i);
  assert.match(login, /action="\/auth\/email"/);
  assert.match(login, /action="\/auth\/password"/);
  assert.match(login, /NEXT_PUBLIC_DEMO_ACCESS_VISIBLE === "true"/);
});

test("magic-link recovery uses PKCE and never exposes session tokens to browser code", async () => {
  const [emailRoute, callback, clientFiles] = await Promise.all([
    source("app/auth/email/route.ts"),
    source("app/auth/callback/route.ts"),
    Promise.all([source("app/login/page.tsx"), source("app/auth.ts")]).then(files => files.join("\n")),
  ]);
  assert.match(emailRoute, /code_challenge/);
  assert.match(emailRoute, /code_challenge_method: "s256"/);
  assert.match(emailRoute, /PKCE_COOKIE/);
  assert.match(emailRoute, /hasSamePublicOrigin\(request\)/);
  assert.match(callback, /exchangePkceCode/);
  assert.doesNotMatch(clientFiles, /access_token|refresh_token/);
});

test("Google PKCE callback follows Supabase's code-and-verifier contract", async () => {
  const [start, callback] = await Promise.all([source("app/auth/google/route.ts"), source("app/auth/callback/route.ts")]);
  assert.doesNotMatch(start, /url\.searchParams\.set\("state"/);
  assert.match(callback, /!code \|\| !verifier/);
  assert.match(callback, /exchangePkceCode\(code, verifier\)/);
});

test("login preserves return_to when starting Google identity sign-in", async () => {
  const login = await source("app/login/page.tsx");
  assert.match(login, /\/auth\/google\?return_to=\$\{encodeURIComponent\(returnTo\)\}/);
  assert.match(login, /Continue with Google/);
});

test("onboarding keeps source consent explicit and browser state honest", async () => {
  const onboarding = await source("app/integrations/integration-setup.tsx");
  assert.match(onboarding, /REVIEW GOOGLE WORKSPACE CONSENT/);
  assert.match(onboarding, /REVIEW SLACK CONSENT/);
  assert.match(onboarding, /It does not approve Google Workspace or Slack access/);
  assert.match(onboarding, /this page never pretends to detect it/);
  assert.match(onboarding, /Chrome Web Store publishing is still pending/);
  assert.match(onboarding, /\/found-extension-v0\.5\.9\.zip/);
  assert.match(onboarding, /remove older Found versions/i);
});

test("Google connector requests only read-only content scopes", async () => {
  const oauth = await source("lib/integrations/oauth.ts");
  assert.match(oauth, /drive\.readonly/);
  assert.match(oauth, /documents\.readonly/);
  assert.doesNotMatch(oauth, /auth\/drive(?:["'])/);
  assert.doesNotMatch(oauth, /auth\/documents(?:["'])/);
});

test("tenant-facing queries require a user token and organisation filter", async () => {
  const workspace = await source("lib/auth/workspace.ts");
  assert.match(workspace, /authorization: `Bearer \$\{accessToken\}`/);
  assert.match(workspace, /organisation_id: `eq\.\$\{organisationId\}`/);
  assert.match(workspace, /getFoundWorkspace\(requestedOrganisationId/);
});

test("team input remains separate from verified company knowledge", async () => {
  const [intelligence, decisionPage] = await Promise.all([
    source("lib/workspace/intelligence.ts"),
    source("app/workspace/decision/[recordId]/page.tsx"),
  ]);
  assert.match(intelligence, /verifiedText: presentation\.summary/);
  assert.match(intelligence, /presentKnowledgeRecord\(latest\)/);
  assert.match(intelligence, /latestInput: latestUpdate\?\.updateText \?\? null/);
  assert.match(decisionPage, /decision\.presentation\.eyebrow/);
  assert.match(decisionPage, /LATEST TEAM INPUT/);
  assert.match(decisionPage, /separate from user input/i);
});

test("decision detail pages render exact browser and Slack records instead of falling back to overview", async () => {
  const decisionPage = await source("app/workspace/decision/[recordId]/page.tsx");
  assert.match(decisionPage, /decodeRecordId/);
  assert.match(decisionPage, /getWorkspaceKnowledgeRecord\(workspace\.organisationId,recordId\)/);
  assert.match(decisionPage, /exactRecordDecision\(exactRecord,updates\)/);
  assert.match(decisionPage, /sourceRecordId===record\.externalId/);
});

test("decision detail pages summarize captured articles instead of dumping full page text", async () => {
  const [decisionPage, presentation] = await Promise.all([
    source("app/workspace/decision/[recordId]/page.tsx"),
    source("lib/workspace/presentation.ts"),
  ]);
  assert.match(decisionPage, /decision\.presentation\.summary/);
  assert.match(decisionPage, /summarizeKnowledgeText\(event\.body\)/);
  assert.match(presentation, /Captured page context:/);
  assert.match(presentation, /Captured page:/);
  assert.match(presentation, /compactNarrative\(capturedContext/);
  assert.match(decisionPage, /StructuredEvidence/);
  assert.match(decisionPage, /SPREADSHEET|presentation\.kind!=="spreadsheet"/);
});

test("connector readiness requires the complete auth and webhook boundary", async () => {
  const readiness = await source("lib/integrations/readiness.ts");
  for (const name of [
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "INTEGRATION_ENCRYPTION_KEY",
    "SLACK_SIGNING_SECRET",
    "HERMES_API_URL",
    "HERMES_API_TOKEN",
  ]) assert.match(readiness, new RegExp(`"${name}"`));
  assert.match(readiness, /configuredRuntimeReadiness/);
});
