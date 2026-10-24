-- Dados 100% fictícios para desenvolvimento. Nunca executar numa base remota real.
-- Fixtures F1 (#19): multi-owner, N:N, utilizador sem acesso, tenant suspenso, IDs conflitantes.

INSERT OR IGNORE INTO tenants (id, name, timezone, status, created_at, updated_at, suspended_at, pending_deletion_at) VALUES
  ('clinic-demo-a', 'Clínica Aurora (fictícia)', 'America/Sao_Paulo', 'active', 1792800000, 1792800000, NULL, NULL),
  ('clinic-demo-b', 'Estúdio Horizonte (fictício)', 'America/Sao_Paulo', 'active', 1792800000, 1792800000, NULL, NULL),
  ('clinic-demo-suspended', 'Clínica Suspensa (fictícia)', 'America/Sao_Paulo', 'suspended', 1792800000, 1792800100, 1792800100, NULL);

-- Legado F0: services/professionals sintéticos — NÃO são fonte operacional (DEC-038 / #20).
INSERT OR IGNORE INTO services (id, tenant_id, name, duration_minutes, active) VALUES
  ('facial', 'clinic-demo-a', 'Limpeza de pele (exemplo)', 60, 1),
  ('depilacao', 'clinic-demo-b', 'Depilação (exemplo)', 45, 1),
  ('facial', 'clinic-demo-suspended', 'Serviço legado suspenso', 30, 0);

INSERT OR IGNORE INTO professionals (id, tenant_id, display_name, active) VALUES
  ('prof-1', 'clinic-demo-a', 'Profissional fictícia A', 1),
  ('prof-1', 'clinic-demo-b', 'Profissional fictícia B', 1),
  ('prof-1', 'clinic-demo-suspended', 'Profissional fictícia suspensa', 0);

-- Contas sintéticas (Clerk user ids fictícios):
-- user_synth_owner_a: owner em A
-- user_synth_owner_a2: segundo owner em A (multi-owner)
-- user_synth_attendant_a: attendant só em A
-- user_synth_multi: owner em A e attendant em B (N:N)
-- user_synth_owner_b: owner só em B
-- user_synth_no_access: autenticável mas sem membership
-- user_synth_suspended_owner: owner do tenant suspenso
-- user_synth_superadmin: sem membership D1 — privateMetadata.superadmin só no Clerk
--   (fixtures sintéticas em src/auth/synthetic.ts, issue #21)
INSERT OR IGNORE INTO tenant_memberships (tenant_id, clerk_user_id, role, status, created_at, revoked_at) VALUES
  ('clinic-demo-a', 'user_synth_owner_a', 'owner', 'active', 1792800000, NULL),
  ('clinic-demo-a', 'user_synth_owner_a2', 'owner', 'active', 1792800000, NULL),
  ('clinic-demo-a', 'user_synth_attendant_a', 'attendant', 'active', 1792800000, NULL),
  ('clinic-demo-a', 'user_synth_multi', 'owner', 'active', 1792800000, NULL),
  ('clinic-demo-b', 'user_synth_multi', 'attendant', 'active', 1792800000, NULL),
  ('clinic-demo-b', 'user_synth_owner_b', 'owner', 'active', 1792800000, NULL),
  ('clinic-demo-suspended', 'user_synth_suspended_owner', 'owner', 'active', 1792800000, NULL);

INSERT OR IGNORE INTO admin_schema_state (id, version, applied_at) VALUES (1, 6, 1792800000);
-- Upgrade local: migrações sobem a versão administrativa (0006 = #26).
UPDATE admin_schema_state SET version = 6 WHERE id = 1 AND version < 6;
