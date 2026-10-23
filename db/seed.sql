-- Dados 100% fictícios para desenvolvimento. Nunca executar numa base remota real.
INSERT OR IGNORE INTO tenants (id, name, timezone, created_at) VALUES
  ('clinic-demo-a', 'Clínica Aurora (fictícia)', 'America/Sao_Paulo', 1792800000),
  ('clinic-demo-b', 'Estúdio Horizonte (fictício)', 'America/Sao_Paulo', 1792800000);

INSERT OR IGNORE INTO services (id, tenant_id, name, duration_minutes, active) VALUES
  ('facial', 'clinic-demo-a', 'Limpeza de pele (exemplo)', 60, 1),
  ('depilacao', 'clinic-demo-b', 'Depilação (exemplo)', 45, 1);

INSERT OR IGNORE INTO professionals (id, tenant_id, display_name, active) VALUES
  ('prof-1', 'clinic-demo-a', 'Profissional fictícia A', 1),
  ('prof-1', 'clinic-demo-b', 'Profissional fictícia B', 1);
