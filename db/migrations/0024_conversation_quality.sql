-- Métricas de qualidade conversacional (founder-approved): episódios de marcação no D1 central.
-- Sem texto de conversa; TTL 90 dias. Agregação cross-tenant para Review MCP e /api/f6/ops.

CREATE TABLE `conversation_quality_episodes` (
	`session_id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`last_message_at` integer NOT NULL,
	`outcome` text,
	`drop_step` text,
	`max_step` text,
	`inbound_turns` integer NOT NULL DEFAULT 0,
	`inbound_turns_to_confirm` integer,
	`confirmed_appointment_id` text,
	`booking_intent` integer NOT NULL DEFAULT 1,
	`misunderstanding_turns` integer NOT NULL DEFAULT 0,
	`attendant_spontaneous` integer NOT NULL DEFAULT 0,
	`attendant_offered_rule` integer NOT NULL DEFAULT 0,
	`attendant_recognized` integer NOT NULL DEFAULT 0,
	`attendant_registered` integer NOT NULL DEFAULT 0,
	`attendant_last_step` text,
	`handoff_unattended` integer NOT NULL DEFAULT 0,
	`false_confirmation` integer NOT NULL DEFAULT 0,
	`ai_appointment_fulfillment` text,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `conversation_quality_episodes_tenant_opened_idx`
	ON `conversation_quality_episodes` (`tenant_id`, `opened_at` DESC);
--> statement-breakpoint
CREATE INDEX `conversation_quality_episodes_expires_idx`
	ON `conversation_quality_episodes` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `conversation_false_confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`session_id` text,
	`message_id` text,
	`occurred_at` integer NOT NULL,
	`signal` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_false_confirmations_idempotency_uidx`
	ON `conversation_false_confirmations` (`tenant_id`, `conversation_id`, `message_id`, `signal`);
--> statement-breakpoint
CREATE INDEX `conversation_false_confirmations_occurred_idx`
	ON `conversation_false_confirmations` (`tenant_id`, `occurred_at` DESC);
--> statement-breakpoint
UPDATE `admin_schema_state` SET `version` = 23, `applied_at` = 0 WHERE `id` = 1;