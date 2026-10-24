-- MVP-11 / F1 (#25): fila durável de entrega de e-mail (convites).
-- Nunca persiste token em claro — só metadados de entrega + idempotência.
-- Provedor real ainda Em aberto; o adaptador simulado cobre desenvolvimento/testes.

CREATE TABLE `email_delivery_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`template` text NOT NULL CHECK (`template` IN ('tenant_invitation')),
	`to_email` text NOT NULL,
	`tenant_id` text NOT NULL,
	`invitation_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending', 'sent', 'failed', 'abandoned')),
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invitation_id`) REFERENCES `tenant_invitations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_delivery_jobs_idempotency_uidx` ON `email_delivery_jobs` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `email_delivery_jobs_status_next_idx` ON `email_delivery_jobs` (`status`,`next_attempt_at`);
--> statement-breakpoint
CREATE INDEX `email_delivery_jobs_invitation_idx` ON `email_delivery_jobs` (`invitation_id`);
--> statement-breakpoint
UPDATE `admin_schema_state` SET `version` = 5, `applied_at` = 0 WHERE `id` = 1;
