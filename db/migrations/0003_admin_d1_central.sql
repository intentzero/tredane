-- MVP-05 / F1 (#19): D1 administrativo — ciclo de tenants, convites, suporte e auditoria central.
-- Não recria 0001/0002. Tokens opacos só como hash. Sem conteúdo clínico.
-- services/professionals permanecem legado F0 (não fonte operacional; DEC-038).

CREATE TABLE `tenant_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`normalized_email` text NOT NULL,
	`role` text DEFAULT 'attendant' NOT NULL CHECK (`role` = 'attendant'),
	`issued_by_clerk_user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending', 'accepted', 'cancelled', 'expired')),
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_by_clerk_user_id` text,
	`cancelled_at` integer,
	`cancelled_by_clerk_user_id` text,
	`last_resent_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tenant_invitations_tenant_email_idx` ON `tenant_invitations` (`tenant_id`,`normalized_email`);
--> statement-breakpoint
CREATE INDEX `tenant_invitations_tenant_status_idx` ON `tenant_invitations` (`tenant_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_invitations_token_hash_uidx` ON `tenant_invitations` (`token_hash`);
--> statement-breakpoint
CREATE TABLE `tenant_invitation_resends` (
	`id` text PRIMARY KEY NOT NULL,
	`invitation_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`normalized_email` text NOT NULL,
	`resent_by_clerk_user_id` text NOT NULL,
	`resent_at` integer NOT NULL,
	FOREIGN KEY (`invitation_id`) REFERENCES `tenant_invitations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tenant_invitation_resends_quota_idx` ON `tenant_invitation_resends` (`tenant_id`,`normalized_email`,`resent_at`);
--> statement-breakpoint
CREATE TABLE `support_access_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`actor_clerk_user_id` text NOT NULL,
	`subject_clerk_user_id` text NOT NULL,
	`reason` text NOT NULL,
	`scope` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
	`decided_by_owner_clerk_user_id` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`cancelled_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `support_access_requests_tenant_status_idx` ON `support_access_requests` (`tenant_id`,`status`);
--> statement-breakpoint
CREATE INDEX `support_access_requests_actor_idx` ON `support_access_requests` (`actor_clerk_user_id`);
--> statement-breakpoint
CREATE TABLE `support_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`support_access_request_id` text NOT NULL,
	`approved_by_owner_clerk_user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`handoff_hash` text,
	`actor_clerk_user_id` text NOT NULL,
	`actor_clerk_session_id` text NOT NULL,
	`subject_clerk_user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`reason` text NOT NULL,
	`scope` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL CHECK (`status` IN ('active', 'expired', 'revoked', 'ended')),
	`created_at` integer NOT NULL,
	`activated_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_by_clerk_user_id` text,
	`ended_at` integer,
	`last_used_at` integer,
	FOREIGN KEY (`support_access_request_id`) REFERENCES `support_access_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `support_sessions_tenant_status_idx` ON `support_sessions` (`tenant_id`,`status`);
--> statement-breakpoint
CREATE INDEX `support_sessions_actor_idx` ON `support_sessions` (`actor_clerk_user_id`);
--> statement-breakpoint
CREATE INDEX `support_sessions_subject_idx` ON `support_sessions` (`subject_clerk_user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `support_sessions_token_hash_uidx` ON `support_sessions` (`token_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `support_sessions_request_uidx` ON `support_sessions` (`support_access_request_id`);
--> statement-breakpoint
CREATE TABLE `support_termination_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`support_session_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`requested_by_subject_clerk_user_id` text NOT NULL,
	`requested_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending', 'accepted', 'declined', 'closed_with_session')),
	`decided_by_owner_clerk_user_id` text,
	`decided_at` integer,
	FOREIGN KEY (`support_session_id`) REFERENCES `support_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `support_termination_session_status_idx` ON `support_termination_requests` (`support_session_id`,`status`);
--> statement-breakpoint
CREATE TABLE `central_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` integer NOT NULL,
	`actor_clerk_user_id` text NOT NULL,
	`subject_clerk_user_id` text,
	`tenant_id` text,
	`action` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text,
	`outcome` text NOT NULL,
	`support_session_id` text,
	`metadata_json` text
);
--> statement-breakpoint
CREATE INDEX `central_audit_tenant_occurred_idx` ON `central_audit_events` (`tenant_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `central_audit_actor_occurred_idx` ON `central_audit_events` (`actor_clerk_user_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX `central_audit_action_occurred_idx` ON `central_audit_events` (`action`,`occurred_at`);
--> statement-breakpoint
CREATE TABLE `admin_schema_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`applied_at` integer NOT NULL
);
--> statement-breakpoint
-- Colunas de ciclo de vida em tenants existentes (sem recriar 0001).
ALTER TABLE `tenants` ADD `status` text NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE `tenants` ADD `updated_at` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `tenants` SET `updated_at` = `created_at` WHERE `updated_at` = 0;
--> statement-breakpoint
ALTER TABLE `tenants` ADD `suspended_at` integer;
--> statement-breakpoint
ALTER TABLE `tenants` ADD `pending_deletion_at` integer;
--> statement-breakpoint
CREATE INDEX `tenants_status_idx` ON `tenants` (`status`);
--> statement-breakpoint
-- Marca versão administrativa exigida pelos repositórios (falha → schema parcial inutilizável).
INSERT INTO `admin_schema_state` (`id`, `version`, `applied_at`) VALUES (1, 3, 0);
