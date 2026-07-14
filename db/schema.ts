import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const organisations = sqliteTable("organisations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [uniqueIndex("organisations_slug_idx").on(table.slug)]);

export const memberships = sqliteTable("memberships", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role", { enum: ["owner", "admin", "member"] }).notNull().default("member"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("memberships_org_email_idx").on(table.organisationId, table.email),
  index("memberships_email_idx").on(table.email),
]);

export const integrationConnections = sqliteTable("integration_connections", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["slack", "jira", "google", "github", "read_ai"] }).notNull(),
  externalWorkspaceId: text("external_workspace_id"),
  externalWorkspaceName: text("external_workspace_name"),
  encryptedCredentialRef: text("encrypted_credential_ref"),
  grantedScopes: text("granted_scopes", { mode: "json" }).$type<string[]>().notNull().default([]),
  status: text("status", { enum: ["pending", "connected", "attention", "disconnected"] }).notNull().default("pending"),
  cursor: text("cursor"),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("integration_org_provider_workspace_idx").on(table.organisationId, table.provider, table.externalWorkspaceId),
  index("integration_org_status_idx").on(table.organisationId, table.status),
]);

export const syncRuns = sqliteTable("sync_runs", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
  mode: text("mode", { enum: ["backfill", "webhook", "scheduled"] }).notNull(),
  status: text("status", { enum: ["queued", "running", "succeeded", "failed"] }).notNull(),
  recordsSeen: integer("records_seen").notNull().default(0),
  recordsChanged: integer("records_changed").notNull().default(0),
  errorCode: text("error_code"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
}, (table) => [index("sync_runs_connection_started_idx").on(table.connectionId, table.startedAt)]);

export const knowledgeRecords = sqliteTable("knowledge_records", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  connectionId: text("connection_id").references(() => integrationConnections.id, { onDelete: "set null" }),
  source: text("source").notNull(),
  externalId: text("external_id").notNull(),
  parentExternalId: text("parent_external_id"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  authorExternalId: text("author_external_id"),
  authorName: text("author_name"),
  department: text("department"),
  sourceUrl: text("source_url").notNull(),
  visibility: text("visibility", { enum: ["workspace", "restricted", "private"] }).notNull().default("restricted"),
  allowedPrincipalIds: text("allowed_principal_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  sourceUpdatedAt: integer("source_updated_at", { mode: "timestamp_ms" }).notNull(),
  indexedAt: integer("indexed_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("knowledge_org_source_external_idx").on(table.organisationId, table.source, table.externalId),
  index("knowledge_org_department_idx").on(table.organisationId, table.department),
  index("knowledge_connection_idx").on(table.connectionId),
]);
