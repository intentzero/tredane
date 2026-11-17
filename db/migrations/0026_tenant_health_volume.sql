-- Volume por clínica no resumo de saúde (Q-PA-04, #881): só contagens, como o snapshot do DO já calcula.
-- Colunas nulas nas linhas antigas até à próxima leitura do cron.

ALTER TABLE `tenant_health_summary` ADD `contact_count` integer;--> statement-breakpoint
ALTER TABLE `tenant_health_summary` ADD `message_count` integer;--> statement-breakpoint
ALTER TABLE `tenant_health_summary` ADD `appointment_count` integer;--> statement-breakpoint
ALTER TABLE `tenant_health_summary` ADD `attachment_count` integer;
