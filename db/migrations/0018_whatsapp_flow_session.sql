-- #514 follow-up / PR #527 review Finding 1: snapshot da sessão Flow por token.
-- Sobrevive a troca de isolate; o Map em memória deixa de ser fonte de verdade.

ALTER TABLE `whatsapp_flow_tokens` ADD COLUMN `session_json` text;
--> statement-breakpoint
UPDATE `admin_schema_state` SET `version` = 18, `applied_at` = 0 WHERE `id` = 1;
