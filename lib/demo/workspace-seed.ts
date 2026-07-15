import type { SupabaseServiceConfig } from "../auth/config";

type MembershipRow = { organisation_id: string };
type ConnectionRow = { id: string; provider: "slack" };

const records = [
  { source: "Slack", external_id: "demo-product-deposit", department: "Product", author_name: "Rohan Desai", title: "Trusted renters can unlock a 50% lower deposit after five clean returns", body: "Experiment approved. Keep the benefit conditional on verified, on-time and damage-free returns; a failed return restores the standard hold.", source_url: "https://app.notion.com/p/39b630edf61f811fb5c2fb52bd1b2507", metadata: { status: "Experiment approved" } },
  { source: "Slack", external_id: "demo-product-sizing", department: "Product", author_name: "Ananya Sharma", title: "Reserve one adjacent size only when fit confidence is low", body: "Discovery complete. A universal two-size order was rejected because it harms contribution margin.", source_url: "https://app.notion.com/p/39b630edf61f81428907d392653ae37f", metadata: { status: "Discovery complete" } },
  { source: "Slack", external_id: "demo-product-availability", department: "Product", author_name: "Ananya Sharma", title: "Rank rental availability above catalogue popularity for event searches", body: "Backlog. Hide inventory that cannot clear cleaning, inspection and delivery before the customer's event date.", source_url: "https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX", metadata: { status: "Backlog · RLP-105" } },
  { source: "Slack", external_id: "demo-product-reminders", department: "Product", author_name: "Kabir Malhotra", title: "Use event-aware return reminders with courier rescheduling", body: "Experiment designed. Reminders should reflect the event date and offer courier rescheduling before a return becomes late.", source_url: "https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX", metadata: { status: "Selected · RLP-104" } },
  { source: "Slack", external_id: "demo-gtm-event-positioning", department: "GTM", author_name: "Aarav Shah", title: "Event-itinerary creative outperformed generic rental discount messaging", body: "Wedding Wardrobe Week worked because the creative followed haldi, mehendi, sangeet and reception needs rather than leading with a blanket discount.", source_url: "https://newworkspace-2bk3073.slack.com/archives/C0BGVQAPU0L", metadata: { status: "Validated pattern" } },
  { source: "Slack", external_id: "demo-sales-measurement", department: "Sales", author_name: "Rhea Bose", title: "Customers need a written success metric to prove value during pilots", body: "Evidence confirmed. Use a paid 30-day proof of value with an agreed success metric instead of a default free pilot.", source_url: "https://newworkspace-2bk3073.slack.com/archives/C0BGVQC999S/p1783839807897629", metadata: { status: "Evidence confirmed" } },
  { source: "Slack", external_id: "demo-sales-pilot", department: "Sales", author_name: "Rhea Bose", title: "Paid 30-day proof of value replaces the default free pilot", body: "Decision recorded. Every proof of value needs a written success metric agreed with the customer before the pilot begins.", source_url: "https://newworkspace-2bk3073.slack.com/archives/C0BGVQC999S/p1783839807897629", metadata: { status: "Pipeline standard" } },
  { source: "Slack", external_id: "demo-eng-portal", department: "Engineering", author_name: "Vikram Rao", title: "Developer portal and service maturity scorecards pilot is already running", body: "Continue the Backstage-based pilot and evaluate Harness scorecard patterns before considering a vendor change.", source_url: "https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX", metadata: { status: "Pilot running · ENG-214" } },
  { source: "Slack", external_id: "demo-eng-release", department: "Engineering", author_name: "Leena Rao", title: "Progressive delivery guardrails should reuse the existing release package", body: "Implementation approved. Extend createCanaryPlan and verifyDeploymentHealth instead of building another flag wrapper.", source_url: "https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX", metadata: { status: "Approved · LOOP-42" } },
  { source: "Slack", external_id: "demo-eng-effectiveness", department: "Engineering", author_name: "Maya Singh", title: "DORA baseline is for service health, not individual scoring", body: "Baseline complete. Track deployment frequency, lead time, change failure rate and recovery time by service tier without ranking engineers.", source_url: "https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX", metadata: { status: "Baseline complete · LOOP-57" } },
  { source: "Slack", external_id: "demo-eng-incidents", department: "Engineering", author_name: "Kabir Malhotra", title: "Link postmortems to services, runbooks and repeated failure modes", body: "Pilot running. Reuse the existing incident taxonomy extractor before building another postmortem parser.", source_url: "https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX", metadata: { status: "Pilot running · LOOP-63" } },
];

export async function seedDemoWorkspace(config: SupabaseServiceConfig, userId: string): Promise<void> {
  const memberships = await rest<MembershipRow[]>(config, `/memberships?select=organisation_id&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  const organisationId = memberships[0]?.organisation_id;
  if (!organisationId) throw new Error("Demo workspace membership is unavailable.");

  const connections = await rest<ConnectionRow[]>(config, "/integration_connections?on_conflict=organisation_id,provider,external_workspace_id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([
      { organisation_id: organisationId, provider: "slack", external_workspace_id: "found-demo-slack", external_workspace_name: "ReLoop Demo Slack", granted_scopes: ["channels:history", "groups:history", "channels:read", "users:read"], status: "connected" },
    ]),
  });
  const connectionByProvider = new Map(connections.map(connection => [connection.provider, connection.id]));

  await rest(config, "/knowledge_records?on_conflict=organisation_id,source,external_id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(records.map(record => ({ ...record, organisation_id: organisationId, connection_id: connectionByProvider.get("slack"), visibility: "workspace", source_updated_at: "2026-07-12T12:00:00+05:30" }))),
  });
}

async function rest<T = unknown>(config: SupabaseServiceConfig, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${config.url}/rest/v1${path}`, { ...init, cache: "no-store", headers: { apikey: config.serviceRoleKey, authorization: `Bearer ${config.serviceRoleKey}`, "content-type": "application/json", ...init.headers } });
  if (!response.ok) throw new Error("Demo workspace provisioning failed.");
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
