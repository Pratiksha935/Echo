CREATE TABLE `integration_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_workspace_id` text,
	`external_workspace_name` text,
	`encrypted_credential_ref` text,
	`granted_scopes` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`cursor` text,
	`last_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_org_provider_workspace_idx` ON `integration_connections` (`organisation_id`,`provider`,`external_workspace_id`);--> statement-breakpoint
CREATE INDEX `integration_org_status_idx` ON `integration_connections` (`organisation_id`,`status`);--> statement-breakpoint
CREATE TABLE `knowledge_records` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`connection_id` text,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`parent_external_id` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`author_external_id` text,
	`author_name` text,
	`department` text,
	`source_url` text NOT NULL,
	`visibility` text DEFAULT 'restricted' NOT NULL,
	`allowed_principal_ids` text DEFAULT '[]' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`source_updated_at` integer NOT NULL,
	`indexed_at` integer NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_org_source_external_idx` ON `knowledge_records` (`organisation_id`,`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `knowledge_org_department_idx` ON `knowledge_records` (`organisation_id`,`department`);--> statement-breakpoint
CREATE INDEX `knowledge_connection_idx` ON `knowledge_records` (`connection_id`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_org_email_idx` ON `memberships` (`organisation_id`,`email`);--> statement-breakpoint
CREATE INDEX `memberships_email_idx` ON `memberships` (`email`);--> statement-breakpoint
CREATE TABLE `organisations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organisations_slug_idx` ON `organisations` (`slug`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`records_seen` integer DEFAULT 0 NOT NULL,
	`records_changed` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`connection_id`) REFERENCES `integration_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sync_runs_connection_started_idx` ON `sync_runs` (`connection_id`,`started_at`);