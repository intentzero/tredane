-- DEC-167 — todos os comentários Avaliar/feedback na amostra central (append em re-flag).

ALTER TABLE `review_samples` ADD COLUMN `client_comments` text;
--> statement-breakpoint
UPDATE `review_samples`
SET `client_comments` = CASE
  WHEN `client_comment` IS NOT NULL AND trim(`client_comment`) != ''
    THEN json_array(`client_comment`)
  ELSE '[]'
END
WHERE `client_comments` IS NULL;
--> statement-breakpoint
UPDATE `admin_schema_state` SET `version` = 22, `applied_at` = 0 WHERE `id` = 1;
