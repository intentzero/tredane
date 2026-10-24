-- MVP-25 / F4-Pix (#39): recibos D1 de webhooks Pix/Woovi (antes da Queue).
-- Dedup por provider_event_key; associação tenant/conta após validação de assinatura.
-- Sem dados bancários, chave Pix da cliente ou App ID (REQ-070 / sinal.md).

CREATE TABLE `pix_webhook_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_event_key` text NOT NULL,
	`provider` text NOT NULL DEFAULT 'woovi',
	`tenant_id` text,
	`account_id` text,
	`provider_charge_id` text,
	`event_type` text NOT NULL CHECK (`event_type` IN (
		'charge.paid',
		'charge.expired',
		'charge.cancelled',
		'refund.updated',
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
	`amount_cents` integer,
	`detail_json` text,
	`enqueued_at` integer,
	`processed_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pix_webhook_receipt_key_uidx`
	ON `pix_webhook_receipts` (`provider_event_key`);
--> statement-breakpoint
CREATE INDEX `pix_webhook_receipts_tenant_idx`
	ON `pix_webhook_receipts` (`tenant_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `pix_webhook_receipts_state_idx`
	ON `pix_webhook_receipts` (`processing_state`, `created_at`);
--> statement-breakpoint
UPDATE `admin_schema_state` SET `version` = 11, `applied_at` = 0 WHERE `id` = 1;
