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
    description: "Public-channel decisions are ingested silently. People can explicitly share a browser link to selected teammates or public channels.",
    ingests: ["Public messages", "Public threads", "Channels", "Users"], syncMode: "Signed Events API",
    scopes: ["channels:history", "channels:read", "users:read", "users:read.email", "im:write", "chat:write", "chat:write.public"],
  },
  {
    provider: "notion", name: "Notion", shortName: "NO", accent: "#f5f2e9", availability: "ready",
    description: "Pages, databases, decisions and linked documents from explicitly approved teamspaces.",
    ingests: ["Pages", "Databases", "Comments", "Users"], syncMode: "OAuth + incremental sync",
    scopes: ["Read content", "Read comments", "Read user information"],
  },
  {
    provider: "jira", name: "Jira Cloud", shortName: "JI", accent: "#7aa2ff", availability: "ready",
    description: "Issues, decisions, statuses, comments and ownership from selected projects.",
    ingests: ["Issues", "Comments", "Projects", "Statuses"], syncMode: "OAuth 3LO + webhooks",
    scopes: ["read:jira-work", "read:jira-user", "manage:jira-webhook", "offline_access"],
  },
  {
    provider: "google", name: "Google Workspace", shortName: "GW", accent: "#ffca66", availability: "ready",
    description: "Drive documents, meeting notes and files from explicitly selected folders.",
    ingests: ["Docs", "Drive files", "Sheets", "Calendar metadata"], syncMode: "OAuth + incremental sync",
    scopes: ["drive.readonly", "documents.readonly", "openid", "email"],
  },
  {
    provider: "github", name: "GitHub", shortName: "GH", accent: "#f3f3ef", availability: "ready",
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
