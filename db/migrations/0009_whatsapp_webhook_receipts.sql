-- MVP-18 / F3 (#32): recibos de webhook WhatsApp no D1 (antes da Queue).
-- Dedup por provider_event_key; tenant só após resolução do índice phone→clínica.
-- Sem corpo de mensagem, telefone do contacto ou credenciais (REQ-070).

CREATE TABLE `whatsapp_webhook_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_event_key` text NOT NULL,
	`phone_number_id` text,
	`tenant_id` text,
	`binding_id` text,
	`kind` text NOT NULL CHECK (`kind` IN (
		'message',
		'unsupported',
		'status',
		'account_interrupt',
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
CREATE UNIQUE INDEX `whatsapp_webhook_receipt_key_uidx`
	ON `whatsapp_webhook_receipts` (`provider_event_key`);
--> statement-breakpoint
CREATE INDEX `whatsapp_webhook_receipts_tenant_idx`
	ON `whatsapp_webhook_receipts` (`tenant_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `whatsapp_webhook_receipts_state_idx`
	ON `whatsapp_webhook_receipts` (`processing_state`, `created_at`);
--> statement-breakpoint
UPDATE `admin_schema_state` SET `version` = 9, `applied_at` = 0 WHERE `id` = 1;
