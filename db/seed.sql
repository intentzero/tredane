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

-- Contas sintéticas com memberships distintos (DEC-038: D1 central).
-- user_synth_owner_a: owner só em A
-- user_synth_attendant_a: attendant só em A
-- user_synth_multi: owner em A e attendant em B (N:N)
-- user_synth_owner_b: owner só em B
INSERT OR IGNORE INTO tenant_memberships (tenant_id, clerk_user_id, role, status, created_at, revoked_at) VALUES
  ('clinic-demo-a', 'user_synth_owner_a', 'owner', 'active', 1792800000, NULL),
  ('clinic-demo-a', 'user_synth_attendant_a', 'attendant', 'active', 1792800000, NULL),
  ('clinic-demo-a', 'user_synth_multi', 'owner', 'active', 1792800000, NULL),
  ('clinic-demo-b', 'user_synth_multi', 'attendant', 'active', 1792800000, NULL),
  ('clinic-demo-b', 'user_synth_owner_b', 'owner', 'active', 1792800000, NULL);
