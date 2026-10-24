-- MVP-13 / F1 (#27): e-mail informativo de início de sessão de suporte (DEC-035).
-- Sem token/handoff/PHI. Idempotência por sessão/destinatário.
-- SQLite: recria a tabela para alargar CHECK e coluna support_session_id.

CREATE TABLE `email_delivery_jobs_new` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`template` text NOT NULL CHECK (`template` IN ('tenant_invitation', 'support_access_request', 'support_session_started')),
	`to_email` text NOT NULL,
	`tenant_id` text NOT NULL,
	`invitation_id` text,
	`support_request_id` text,
	`support_session_id` text,
	`status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending', 'sent', 'failed', 'abandoned')),
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invitation_id`) REFERENCES `tenant_invitations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`support_request_id`) REFERENCES `support_access_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`support_session_id`) REFERENCES `support_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `email_delivery_jobs_new` (
	`id`, `idempotency_key`, `template`, `to_email`, `tenant_id`, `invitation_id`,
	`support_request_id`, `support_session_id`, `status`, `attempt_count`, `max_attempts`,
	`next_attempt_at`, `last_error`, `created_at`, `updated_at`, `sent_at`
)
SELECT
	`id`, `idempotency_key`, `template`, `to_email`, `tenant_id`, `invitation_id`,
	`support_request_id`, NULL, `status`, `attempt_count`, `max_attempts`,
	`next_attempt_at`, `last_error`, `created_at`, `updated_at`, `sent_at`
FROM `email_delivery_jobs`;
--> statement-breakpoint
DROP TABLE `email_delivery_jobs`;
--> statement-breakpoint
ALTER TABLE `email_delivery_jobs_new` RENAME TO `email_delivery_jobs`;
--> statement-breakpoint
CREATE UNIQUE INDEX `email_delivery_jobs_idempotency_uidx` ON `email_delivery_jobs` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `email_delivery_jobs_status_next_idx` ON `email_delivery_jobs` (`status`,`next_attempt_at`);
--> statement-breakpoint
CREATE INDEX `email_delivery_jobs_invitation_idx` ON `email_delivery_jobs` (`invitation_id`);
--> statement-breakpoint
CREATE INDEX `email_delivery_jobs_support_request_idx` ON `email_delivery_jobs` (`support_request_id`);
--> statement-breakpoint
CREATE INDEX `email_delivery_jobs_support_session_idx` ON `email_delivery_jobs` (`support_session_id`);
--> statement-breakpoint
UPDATE `admin_schema_state` SET `version` = 7, `applied_at` = 0 WHERE `id` = 1;
