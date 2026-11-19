-- DEC-202: o link pode abrir já com data e período ditos no chat (amanhã, manhã/tarde/noite).
ALTER TABLE `client_web_links` ADD COLUMN `preferred_date` text;
ALTER TABLE `client_web_links` ADD COLUMN `day_part` text CHECK (`day_part` IS NULL OR `day_part` IN ('manha', 'tarde', 'noite'));