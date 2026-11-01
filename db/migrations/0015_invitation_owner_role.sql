-- DEC-103: convite pode ser role=owner | attendant (CHECK antigo só permitia attendant).
-- SQLite não altera CHECK — rebuild da tabela preservando dados.

PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `tenant_invitations_v15` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`normalized_email` text NOT NULL,
	`role` text DEFAULT 'attendant' NOT NULL CHECK (`role` IN ('owner', 'attendant')),
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
INSERT INTO `tenant_invitations_v15` (
	`id`, `tenant_id`, `normalized_email`, `role`, `issued_by_clerk_user_id`, `token_hash`,
	`status`, `issued_at`, `expires_at`, `accepted_at`, `accepted_by_clerk_user_id`,
	`cancelled_at`, `cancelled_by_clerk_user_id`, `last_resent_at`
)
SELECT
	`id`, `tenant_id`, `normalized_email`, `role`, `issued_by_clerk_user_id`, `token_hash`,
	`status`, `issued_at`, `expires_at`, `accepted_at`, `accepted_by_clerk_user_id`,
	`cancelled_at`, `cancelled_by_clerk_user_id`, `last_resent_at`
FROM `tenant_invitations`;
--> statement-breakpoint
DROP TABLE `tenant_invitations`;
--> statement-breakpoint
ALTER TABLE `tenant_invitations_v15` RENAME TO `tenant_invitations`;
--> statement-breakpoint
CREATE INDEX `tenant_invitations_tenant_email_idx` ON `tenant_invitations` (`tenant_id`,`normalized_email`);
--> statement-breakpoint
CREATE INDEX `tenant_invitations_tenant_status_idx` ON `tenant_invitations` (`tenant_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_invitations_token_hash_uidx` ON `tenant_invitations` (`token_hash`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
UPDATE `admin_schema_state` SET `version` = 15, `applied_at` = 0 WHERE `id` = 1;
