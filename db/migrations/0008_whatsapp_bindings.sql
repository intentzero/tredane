-- MVP-17 / F3 (#31): índice global número→tenant + sessões Embedded Signup + credenciais.
-- Unicidade de phone_number_id activo; tokens só no backend (nunca na API/UI).
-- DEC-009 / REQ-051 / ADR-0012. Sem webhooks (#32) nem envio (#33).

CREATE TABLE `whatsapp_phone_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`phone_number_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`waba_id` text NOT NULL,
	`display_phone` text NOT NULL,
	`display_name` text,
	`status` text NOT NULL CHECK (`status` IN ('active', 'interrupted', 'released')),
	`connected_at` integer NOT NULL,
	`connected_by_clerk_user_id` text NOT NULL,
	`interrupted_at` integer,
	`interrupt_reason` text,
	`released_at` integer,
	`released_by_clerk_user_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_phone_active_uidx`
	ON `whatsapp_phone_bindings` (`phone_number_id`)
	WHERE `status` IN ('active', 'interrupted');
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_tenant_active_uidx`
	ON `whatsapp_phone_bindings` (`tenant_id`)
	WHERE `status` IN ('active', 'interrupted');
--> statement-breakpoint
CREATE INDEX `whatsapp_bindings_tenant_idx`
	ON `whatsapp_phone_bindings` (`tenant_id`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `whatsapp_credentials` (
	`binding_id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`phone_number_id` text NOT NULL,
	`access_token_cipher` text NOT NULL,
	`token_type` text,
	`expires_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`binding_id`) REFERENCES `whatsapp_phone_bindings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `whatsapp_signup_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`state` text NOT NULL,
	`purpose` text NOT NULL CHECK (`purpose` IN ('connect', 'reconnect', 'replace')),
	`created_by_clerk_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`status` text NOT NULL CHECK (`status` IN ('pending', 'consumed', 'expired', 'cancelled')),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_signup_state_uidx` ON `whatsapp_signup_sessions` (`state`);
--> statement-breakpoint
CREATE INDEX `whatsapp_signup_tenant_status_idx`
	ON `whatsapp_signup_sessions` (`tenant_id`, `status`);
--> statement-breakpoint
CREATE TABLE `whatsapp_binding_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`binding_id` text,
	`phone_number_id` text,
	`action` text NOT NULL,
	`actor_clerk_user_id` text,
	`detail_json` text,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `whatsapp_binding_events_tenant_idx`
	ON `whatsapp_binding_events` (`tenant_id`, `occurred_at`);
--> statement-breakpoint
UPDATE `admin_schema_state` SET `version` = 8, `applied_at` = 0 WHERE `id` = 1;
