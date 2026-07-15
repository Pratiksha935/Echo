export type IntegrationProvider = "slack" | "notion" | "jira" | "google" | "github" | "read_ai";

export type IntegrationDefinition = {
  provider: IntegrationProvider;
  name: string;
  shortName: string;
  description: string;
  ingests: string[];
  scopes: string[];
  syncMode: string;
  accent: string;
  availability: "ready" | "next" | "planned";
};

export const integrationCatalog: IntegrationDefinition[] = [
  {
    provider: "slack", name: "Slack", shortName: "SL", accent: "#d7ff3f", availability: "ready",
    description: "Threads, decisions and work intent with source links and channel permissions intact.",
    ingests: ["Messages", "Threads", "Channels", "Users"], syncMode: "Events API + backfill",
    scopes: ["channels:history", "groups:history", "channels:read", "users:read", "chat:write"],
  },
  {
    provider: "notion", name: "Notion", shortName: "NO", accent: "#f5f2e9", availability: "next",
    description: "Pages, databases, decisions and linked documents from explicitly approved teamspaces.",
    ingests: ["Pages", "Databases", "Comments", "Users"], syncMode: "OAuth + incremental sync",
    scopes: ["Read content", "Read comments", "Read user information"],
  },
  {
    provider: "jira", name: "Jira Cloud", shortName: "JI", accent: "#7aa2ff", availability: "next",
    description: "Issues, decisions, statuses, comments and ownership from selected projects.",
    ingests: ["Issues", "Comments", "Projects", "Statuses"], syncMode: "OAuth 3LO + webhooks",
    scopes: ["read:jira-work", "read:jira-user", "manage:jira-webhook", "offline_access"],
  },
  {
    provider: "google", name: "Google Workspace", shortName: "GW", accent: "#ffca66", availability: "next",
    description: "Drive documents, meeting notes and files from explicitly selected folders.",
    ingests: ["Docs", "Drive files", "Sheets", "Calendar metadata"], syncMode: "OAuth + incremental sync",
    scopes: ["drive.metadata.readonly", "drive.file", "documents.readonly"],
  },
  {
    provider: "github", name: "GitHub", shortName: "GH", accent: "#f3f3ef", availability: "next",
    description: "Repositories, pull requests, code symbols and review history for duplicate-code checks.",
    ingests: ["Repositories", "Pull requests", "Issues", "Code metadata"], syncMode: "GitHub App + webhooks",
    scopes: ["Metadata: read", "Contents: read", "Pull requests: read", "Issues: read"],
  },
  {
    provider: "read_ai", name: "Read AI", shortName: "RA", accent: "#d9a8ff", availability: "planned",
    description: "Meeting summaries, action items and decisions delivered through approved exports or APIs.",
    ingests: ["Summaries", "Action items", "Topics", "Meeting links"], syncMode: "API/export adapter",
    scopes: ["Meeting artifacts selected by workspace admin"],
  },
];
