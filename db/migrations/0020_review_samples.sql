-- DEC-159 — amostras de revisão cross-tenant no D1 central (snapshot no flag; TTL 30 dias).

CREATE TABLE `review_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tenant_name` text,
	`conversation_id` text NOT NULL,
	`contact_id` text,
	`contact_wa_id` text,
	`contact_display_name` text,
	`flag_source` text NOT NULL,
	`flag_reason` text,
	`flagged_at` integer NOT NULL,
	`copied_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`message_count` integer NOT NULL DEFAULT 0,
	`last_message_at` integer,
	`last_message_preview` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_samples_tenant_conversation_uidx`
	ON `review_samples` (`tenant_id`, `conversation_id`);
--> statement-breakpoint
CREATE INDEX `review_samples_flagged_at_idx`
	ON `review_samples` (`flagged_at` DESC);
--> statement-breakpoint
CREATE INDEX `review_samples_tenant_flagged_idx`
	ON `review_samples` (`tenant_id`, `flagged_at` DESC);
--> statement-breakpoint
CREATE INDEX `review_samples_expires_at_idx`
	ON `review_samples` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `review_samples_source_flagged_idx`
	ON `review_samples` (`flag_source`, `flagged_at` DESC);
--> statement-breakpoint
CREATE TABLE `review_sample_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`sample_id` text NOT NULL,
	`message_id` text NOT NULL,
	`seq` integer NOT NULL,
	`direction` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`delivery_state` text,
	`author_clerk_user_id` text,
	`author_display_name` text,
	FOREIGN KEY (`sample_id`) REFERENCES `review_samples`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `review_sample_messages_sample_seq_idx`
	ON `review_sample_messages` (`sample_id`, `seq`);
--> statement-breakpoint
UPDATE `admin_schema_state` SET `version` = 20, `applied_at` = 0 WHERE `id` = 1;
