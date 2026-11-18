-- DEC-202 (D-20261118-084800-CUR): o link pode abrir já com linha e zonas ditas no chat.
ALTER TABLE `client_web_links` ADD COLUMN `audience_line` text CHECK (`audience_line` IS NULL OR `audience_line` IN ('feminino', 'masculino'));
ALTER TABLE `client_web_links` ADD COLUMN `variant_ids` text;