-- S4 (#175): kind `button_reply` nos recibos de webhook (proposta WhatsApp).
-- SQLite não altera CHECK — rebuild da tabela preservando dados.

CREATE TABLE `whatsapp_webhook_receipts_v14` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_event_key` text NOT NULL,
	`phone_number_id` text,
	`tenant_id` text,
	`binding_id` text,
	`kind` text NOT NULL CHECK (`kind` IN (
		'message',
		'media',
		'unsupported',
		'status',
		'account_interrupt',
		'button_reply',
		'discarded'
	)),
	`processing_state` text NOT NULL CHECK (`processing_state` IN (
		'received',
		'enqueued',
		'processed',
		'duplicate',
		'discarded',
		'failed'
	)),
	`provider_timestamp` integer,
	`detail_json` text,
	`enqueued_at` integer,
	`processed_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `whatsapp_webhook_receipts_v14` (
	`id`, `provider_event_key`, `phone_number_id`, `tenant_id`, `binding_id`,
	`kind`, `processing_state`, `provider_timestamp`, `detail_json`,
	`enqueued_at`, `processed_at`, `last_error`, `created_at`
)
SELECT
	`id`, `provider_event_key`, `phone_number_id`, `tenant_id`, `binding_id`,
	`kind`, `processing_state`, `provider_timestamp`, `detail_json`,
	`enqueued_at`, `processed_at`, `last_error`, `created_at`
FROM `whatsapp_webhook_receipts`;
--> statement-breakpoint
DROP TABLE `whatsapp_webhook_receipts`;
--> statement-breakpoint
ALTER TABLE `whatsapp_webhook_receipts_v14` RENAME TO `whatsapp_webhook_receipts`;
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_webhook_receipt_key_uidx`
	ON `whatsapp_webhook_receipts` (`provider_event_key`);
--> statement-breakpoint
CREATE INDEX `whatsapp_webhook_receipts_tenant_idx`
	ON `whatsapp_webhook_receipts` (`tenant_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `whatsapp_webhook_receipts_state_idx`
	ON `whatsapp_webhook_receipts` (`processing_state`, `created_at`);
--> statement-breakpoint
UPDATE `admin_schema_state` SET `version` = 14, `applied_at` = 0 WHERE `id` = 1;
