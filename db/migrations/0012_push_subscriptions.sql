-- MVP-28 / F5 (#42): assinaturas Web Push por utilizador × dispositivo × tenant.
-- Payload de notificação nunca inclui corpo de mensagem (DEC-040).
-- Remoção em revoke/leave; endpoints 404/410 limpos no envio.

CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`clerk_user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`expiration_time` integer,
	`user_agent` text,
	`notify_new_conversation` integer NOT NULL DEFAULT 1,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_uidx`
	ON `push_subscriptions` (`endpoint`);
--> statement-breakpoint
CREATE INDEX `push_subscriptions_tenant_user_idx`
	ON `push_subscriptions` (`tenant_id`, `clerk_user_id`);
--> statement-breakpoint
CREATE INDEX `push_subscriptions_tenant_notify_idx`
	ON `push_subscriptions` (`tenant_id`, `notify_new_conversation`);
--> statement-breakpoint
UPDATE `admin_schema_state` SET `version` = 12, `applied_at` = 0 WHERE `id` = 1;
