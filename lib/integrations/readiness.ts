import type { IntegrationProvider } from "./catalog";

export type RuntimeReadiness = {
  hermes: boolean;
};

export function configuredIntegrationProviders(): IntegrationProvider[] {
  const core = has(
    "NEXT_PUBLIC_APP_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "INTEGRATION_ENCRYPTION_KEY",
  );
  if (!core) return [];
  const ready: IntegrationProvider[] = [];
  if (has("SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_SIGNING_SECRET")) ready.push("slack");
  if (has("NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET")) ready.push("notion");
  if (has("ATLASSIAN_CLIENT_ID", "ATLASSIAN_CLIENT_SECRET")) ready.push("jira");
  if (has("GOOGLE_WORKSPACE_CLIENT_ID", "GOOGLE_WORKSPACE_CLIENT_SECRET")) ready.push("google");
  if (has("GITHUB_APP_INSTALL_URL", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET")) ready.push("github");
  if (has("READ_AI_API_URL", "READ_AI_API_TOKEN")) ready.push("read_ai");
  return ready;
}

export function configuredRuntimeReadiness(): RuntimeReadiness {
  return {
    hermes: has("HERMES_API_URL", "HERMES_API_TOKEN"),
  };
}

function has(...names: string[]): boolean {
  return names.every(name => Boolean(process.env[name]?.trim()));
}
