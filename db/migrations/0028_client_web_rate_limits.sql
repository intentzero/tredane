-- Limite de pedidos das rotas públicas da página da cliente (ADR-0018 §7a).
-- A chave é um hash (nunca o IP nem a sessão em claro); janela fixa por bucket.

CREATE TABLE IF NOT EXISTS `client_web_rate_limits` (
	`bucket` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY (`bucket`, `window_start`)
);
