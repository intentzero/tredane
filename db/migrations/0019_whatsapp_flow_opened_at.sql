-- DEC-143 (medida b): instante da primeira chamada da Meta ao endpoint para este flow_token
-- (INIT ou data_exchange), ou seja, a cliente abriu o Flow. `session_json` não serve para isto:
-- é gravado logo no envio.

ALTER TABLE `whatsapp_flow_tokens` ADD COLUMN `opened_at` integer;
--> statement-breakpoint
UPDATE `admin_schema_state` SET `version` = 19, `applied_at` = 0 WHERE `id` = 1;
