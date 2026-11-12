-- DEC-166 — comentário livre opcional da cliente no snapshot de revisão (1.º flag).

ALTER TABLE `review_samples` ADD COLUMN `client_comment` text;
--> statement-breakpoint
UPDATE `admin_schema_state` SET `version` = 21, `applied_at` = 0 WHERE `id` = 1;
