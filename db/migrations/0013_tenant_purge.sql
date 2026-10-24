-- MVP-29 / F6 (#43): progresso do expurgo físico + tombstone de tenant purgado.
-- Sem PHI. deadline_at = pending_deletion_at + 30 dias (REQ-071 / DEC-011).

ALTER TABLE `tenant_deletion_commands` ADD COLUMN `deadline_at` integer;
--> statement-breakpoint
ALTER TABLE `tenant_deletion_commands` ADD COLUMN `started_at` integer;
--> statement-breakpoint
ALTER TABLE `tenant_deletion_commands` ADD COLUMN `completed_at` integer;
--> statement-breakpoint
ALTER TABLE `tenant_deletion_commands` ADD COLUMN `last_step` text;
--> statement-breakpoint
ALTER TABLE `tenant_deletion_commands` ADD COLUMN `last_error` text;
--> statement-breakpoint
ALTER TABLE `tenant_deletion_commands` ADD COLUMN `alert_sent_at` integer;
--> statement-breakpoint

CREATE TABLE `purged_tenants` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`purged_at` integer NOT NULL,
	`deletion_command_id` text NOT NULL,
	`pending_deletion_at` integer,
	`deadline_at` integer
);
--> statement-breakpoint
CREATE INDEX `purged_tenants_purged_at_idx` ON `purged_tenants` (`purged_at`);
--> statement-breakpoint

UPDATE `admin_schema_state` SET `version` = 13, `applied_at` = 0 WHERE `id` = 1;
