export const SLACK_REQUIRED_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "channels:read",
  "chat:write",
  "chat:write.public",
  "commands",
  "im:history",
  "im:write",
  "users:read",
  "users:read.email",
] as const;

export const SLACK_PRIVATE_DM_SCOPES = ["chat:write", "im:write", "users:read"] as const;

export function missingSlackScopes(granted: readonly string[] | null | undefined, required: readonly string[] = SLACK_REQUIRED_SCOPES): string[] {
  const available = new Set(granted ?? []);
  return required.filter(scope => !available.has(scope));
}
