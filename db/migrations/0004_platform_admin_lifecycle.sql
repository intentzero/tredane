-- MVP-10 / F1 (#24): comando durável de exclusão lógica + schema admin v4.
-- Não recria 0001–0003. Sem conteúdo clínico / PHI.

CREATE TABLE `tenant_deletion_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL CHECK (`status` IN ('queued', 'in_progress', 'completed', 'cancelled')),
	`requested_by_clerk_user_id` text NOT NULL,
	`requested_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`payload_json` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tenant_deletion_commands_tenant_idx` ON `tenant_deletion_commands` (`tenant_id`);
--> statement-breakpoint
CREATE INDEX `tenant_deletion_commands_status_idx` ON `tenant_deletion_commands` (`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_deletion_commands_one_open_uidx`
	ON `tenant_deletion_commands` (`tenant_id`)
	WHERE `status` IN ('queued', 'in_progress');
--> statement-breakpoint
UPDATE `admin_schema_state` SET `version` = 4, `applied_at` = 0 WHERE `id` = 1;
