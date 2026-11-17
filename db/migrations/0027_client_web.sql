-- Página web da cliente (DEC-196 a DEC-199, ADR-0018 Proposto).
-- Só se guarda o hash SHA-256 do token e da sessão; nunca o valor em claro.
-- A clínica sai da linha do token/sessão, nunca do pedido.

CREATE TABLE IF NOT EXISTS `client_web_links` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`binding_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`purpose` text NOT NULL CHECK (`purpose` IN ('home', 'agendar', 'remarcar', 'cancelar')),
	`appointment_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`replaced_at` integer
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `client_web_links_conversation_idx`
	ON `client_web_links` (`tenant_id`, `conversation_id`, `created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `client_web_sessions` (
	`session_hash` text PRIMARY KEY NOT NULL,
	`link_hash` text NOT NULL,
	`tenant_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `client_web_sessions_conversation_idx`
	ON `client_web_sessions` (`tenant_id`, `conversation_id`, `created_at`);
