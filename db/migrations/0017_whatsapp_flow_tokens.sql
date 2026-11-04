-- ADR-0016 / #514: tokens de sessão do WhatsApp Flow + kind `nfm_reply` nos recibos.
-- SQLite não altera CHECK — rebuild da tabela de recibos preservando dados.

CREATE TABLE IF NOT EXISTS `whatsapp_flow_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`binding_id` text NOT NULL,
	`phone_number_id` text NOT NULL,
	`waba_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`catalog_version` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`replaced_by` text,
	`consumed_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `whatsapp_flow_tokens_tenant_idx`
	ON `whatsapp_flow_tokens` (`tenant_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `whatsapp_flow_tokens_conversation_idx`
	ON `whatsapp_flow_tokens` (`conversation_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `whatsapp_webhook_receipts_v17` (
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
		'list_reply',
		'nfm_reply',
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
INSERT INTO `whatsapp_webhook_receipts_v17` (
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
ALTER TABLE `whatsapp_webhook_receipts_v17` RENAME TO `whatsapp_webhook_receipts`;
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
UPDATE `admin_schema_state` SET `version` = 17, `applied_at` = 0 WHERE `id` = 1;
