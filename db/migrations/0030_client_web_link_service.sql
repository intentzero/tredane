-- DEC-202: o link pode abrir a página já num serviço reconhecido no texto da cliente.
ALTER TABLE `client_web_links` ADD COLUMN `service_id` text;
