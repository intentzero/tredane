-- TEMPORÁRIO (sombra do interpretador LLM; ver docs/architecture/hipotese-compreensao-llm-primeiro.md §5.3d).
-- Um registo mínimo por turno de texto livre: ids e veredictos por campo, SEM texto da conversa.
-- TTL 7 dias. Remover com a ferramenta get_interpreter_shadow_report quando a hipótese H1 estiver decidida.

CREATE TABLE `interpreter_shadow_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`status` text NOT NULL,
	`main_model_called` integer NOT NULL DEFAULT 0,
	`reused_main_call` integer NOT NULL DEFAULT 0,
	`pending_slot` text,
	`rule_coverage` real,
	`diverged` integer NOT NULL DEFAULT 0,
	`fields_json` text,
	`llm_only_json` text,
	`differ_json` text,
	`strict_discarded_json` text,
	`relaxed_rejected_json` text,
	`rule_acts_json` text,
	`llm_acts_json` text,
	`model` text,
	`latency_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interpreter_shadow_events_turn_uidx`
	ON `interpreter_shadow_events` (`tenant_id`, `conversation_id`, `message_id`);
--> statement-breakpoint
CREATE INDEX `interpreter_shadow_events_occurred_idx`
	ON `interpreter_shadow_events` (`occurred_at` DESC);
--> statement-breakpoint
CREATE INDEX `interpreter_shadow_events_expires_idx`
	ON `interpreter_shadow_events` (`expires_at`);
