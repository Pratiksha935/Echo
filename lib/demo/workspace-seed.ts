import type { SupabaseServiceConfig } from "../auth/config";

type MembershipRow = { organisation_id: string };
type ConnectionRow = { id: string; provider: "google" | "slack" };

const APP_URL = "https://sage-profiterole-3b1c22.netlify.app";

const records = [
  { source: "Slack", external_id: "demo-product-deposit", department: "Product", author_name: "Rohan Desai", title: "Trusted renters can unlock a 50% lower deposit after five clean returns", body: "Experiment approved. Keep the benefit conditional on verified, on-time and damage-free returns; a failed return restores the standard hold.", source_url: "https://app.notion.com/p/39b630edf61f811fb5c2fb52bd1b2507", metadata: { status: "Experiment approved" } },
  { source: "Slack", external_id: "demo-product-sizing", department: "Product", author_name: "Ananya Sharma", title: "Reserve one adjacent size only when fit confidence is low", body: "Discovery complete. A universal two-size order was rejected because it harms contribution margin.", source_url: "https://app.notion.com/p/39b630edf61f81428907d392653ae37f", metadata: { status: "Discovery complete" } },
  { source: "Google Sheets", external_id: "demo-gtm-return-earn", department: "GTM", author_name: "Aarav Shah", title: "Return & Earn produced the strongest campaign efficiency at 33.6× ROAS", body: "The campaign should be the baseline for retention-led creative and lifecycle targeting.", source_url: `${APP_URL}/demo-data/gtm-campaign-performance.csv`, metadata: { status: "Top performer" } },
  { source: "Google Sheets", external_id: "demo-gtm-wedding", department: "GTM", author_name: "Aarav Shah", title: "Wedding Wardrobe Week reached 13.9× ROAS through event-itinerary positioning", body: "Haldi, mehendi, sangeet and reception journeys outperformed generic bundle-discount messaging.", source_url: `${APP_URL}/demo-data/gtm-campaign-performance.csv`, metadata: { status: "Scale" } },
  { source: "Google Sheets", external_id: "demo-gtm-office", department: "GTM", author_name: "Nisha Kapoor", title: "Office Edit Trial underperformed at 1.3× ROAS", body: "Do not scale the current creative. The campaign lacked an event deadline and a clear rental-use case.", source_url: `${APP_URL}/demo-data/gtm-campaign-performance.csv`, metadata: { status: "Paused" } },
  { source: "Slack", external_id: "demo-sales-measurement", department: "Sales", author_name: "Rhea Bose", title: "Customers need a written success metric to prove value during pilots", body: "Evidence confirmed. Use a paid 30-day proof of value with an agreed success metric instead of a default free pilot.", source_url: "https://newworkspace-2bk3073.slack.com/archives/C0BGVQC999S/p1783839807897629", metadata: { status: "Evidence confirmed" } },
  { source: "Slack", external_id: "demo-eng-portal", department: "Engineering", author_name: "Vikram Rao", title: "Developer portal and service maturity scorecards pilot is already running", body: "Continue the Backstage-based pilot and evaluate Harness scorecard patterns before considering a vendor change.", source_url: "https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX", metadata: { status: "Pilot running · ENG-214" } },
  { source: "Slack", external_id: "demo-eng-release", department: "Engineering", author_name: "Leena Rao", title: "Progressive delivery guardrails should reuse the existing release package", body: "Implementation approved. Extend createCanaryPlan and verifyDeploymentHealth instead of building another flag wrapper.", source_url: "https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX", metadata: { status: "Approved · LOOP-42" } },
];

export async function seedDemoWorkspace(config: SupabaseServiceConfig, userId: string): Promise<void> {
  const memberships = await rest<MembershipRow[]>(config, `/memberships?select=organisation_id&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  const organisationId = memberships[0]?.organisation_id;
  if (!organisationId) throw new Error("Demo workspace membership is unavailable.");

  const connections = await rest<ConnectionRow[]>(config, "/integration_connections?on_conflict=organisation_id,provider,external_workspace_id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([
      { organisation_id: organisationId, provider: "slack", external_workspace_id: "found-demo-slack", external_workspace_name: "ReLoop Demo Slack", granted_scopes: ["channels:history", "groups:history", "channels:read", "users:read"], status: "connected" },
      { organisation_id: organisationId, provider: "google", external_workspace_id: "found-demo-google", external_workspace_name: "ReLoop Demo Google Workspace", granted_scopes: ["drive.readonly", "documents.readonly"], status: "connected" },
    ]),
  });
  const connectionByProvider = new Map(connections.map(connection => [connection.provider, connection.id]));

  await rest(config, "/knowledge_records?on_conflict=organisation_id,source,external_id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(records.map(record => ({ ...record, organisation_id: organisationId, connection_id: connectionByProvider.get(record.source === "Slack" ? "slack" : "google"), visibility: "workspace", source_updated_at: "2026-07-12T12:00:00+05:30" }))),
  });
}

async function rest<T = unknown>(config: SupabaseServiceConfig, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${config.url}/rest/v1${path}`, { ...init, cache: "no-store", headers: { apikey: config.serviceRoleKey, authorization: `Bearer ${config.serviceRoleKey}`, "content-type": "application/json", ...init.headers } });
  if (!response.ok) throw new Error("Demo workspace provisioning failed.");
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
