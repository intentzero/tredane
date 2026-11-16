-- Resumo periódico de saúde por clínica (DEC-193): o cron lê o snapshot operacional de cada
-- Durable Object e grava aqui só contagens e estados. A Platform Admin lê desta tabela;
-- nunca consulta o DO a cada visita. Sem conteúdo de conversa nem dados de clientes.

CREATE TABLE `tenant_health_summary` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`read_at` integer NOT NULL,
	`last_ok_at` integer,
	`status` text NOT NULL CHECK (`status` IN ('ok', 'unreachable')),
	`schema_version` integer,
	`schema_ready` integer,
	`pending_outbox` integer,
	`failed_outbox` integer,
	`uncertain_outbound` integer,
	`llm_jobs_open` integer,
	`llm_jobs_failed_1h` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
