/**
 * Migração 42 — salas do serviço (DEC-082).
 * «Sem sala» passa a «Sem espaço definido» (mode none).
 * «Qualquer sala livre» vira a lista das salas ativas nesse momento.
 * A categoria vira a lista das salas ativas dessa categoria.
 * Uma sala já escolhida mantém-se, mesmo inativa.
 * Equipamento exigido fica à parte (mode equipment).
 * Uma sala criada depois não entra sozinha: a lista é a cópia deste instante.
 */
export const MIGRATION_ID = 42
export const MIGRATION_NAME = '0042_service_room_list'

export const STATEMENTS: readonly string[] = [
  `CREATE TABLE service_room_requirements__m42 (
    tenant_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('none', 'rooms', 'room', 'equipment')),
    resource_id TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (tenant_id, service_id, mode, resource_id)
  )`,

  `INSERT INTO service_room_requirements__m42 (tenant_id, service_id, mode, resource_id)
   SELECT tenant_id, service_id, 'none', ''
   FROM service_room_requirements
   WHERE mode = 'none'`,

  `INSERT INTO service_room_requirements__m42 (tenant_id, service_id, mode, resource_id)
   SELECT q.tenant_id, q.service_id, 'rooms', ''
   FROM service_room_requirements q
   JOIN resources r
     ON r.tenant_id = q.tenant_id AND r.id = q.resource_id AND r.kind = 'room'
   WHERE q.mode = 'resource'`,

  `INSERT INTO service_room_requirements__m42 (tenant_id, service_id, mode, resource_id)
   SELECT q.tenant_id, q.service_id, 'room', q.resource_id
   FROM service_room_requirements q
   JOIN resources r
     ON r.tenant_id = q.tenant_id AND r.id = q.resource_id AND r.kind = 'room'
   WHERE q.mode = 'resource' AND q.resource_id IS NOT NULL`,

  `INSERT INTO service_room_requirements__m42 (tenant_id, service_id, mode, resource_id)
   SELECT q.tenant_id, q.service_id, 'equipment', q.resource_id
   FROM service_room_requirements q
   JOIN resources r
     ON r.tenant_id = q.tenant_id AND r.id = q.resource_id AND r.kind = 'equipment'
   WHERE q.mode = 'resource' AND q.resource_id IS NOT NULL`,

  `INSERT INTO service_room_requirements__m42 (tenant_id, service_id, mode, resource_id)
   SELECT q.tenant_id, q.service_id, 'rooms', ''
   FROM service_room_requirements q
   WHERE q.mode = 'resource'
     AND q.resource_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM service_room_requirements__m42 m
       WHERE m.tenant_id = q.tenant_id AND m.service_id = q.service_id AND m.mode = 'rooms'
     )
     AND EXISTS (
       SELECT 1 FROM service_room_requirements__m42 m
       WHERE m.tenant_id = q.tenant_id AND m.service_id = q.service_id AND m.mode = 'equipment'
     )`,

  `INSERT INTO service_room_requirements__m42 (tenant_id, service_id, mode, resource_id)
   SELECT tenant_id, service_id, 'rooms', ''
   FROM service_room_requirements
   WHERE mode = 'any'`,

  `INSERT INTO service_room_requirements__m42 (tenant_id, service_id, mode, resource_id)
   SELECT q.tenant_id, q.service_id, 'room', r.id
   FROM service_room_requirements q
   JOIN resources r
     ON r.tenant_id = q.tenant_id AND r.kind = 'room' AND r.active = 1
   WHERE q.mode = 'any'`,

  `INSERT INTO service_room_requirements__m42 (tenant_id, service_id, mode, resource_id)
   SELECT tenant_id, service_id, 'rooms', ''
   FROM service_room_requirements
   WHERE mode = 'category'`,

  `INSERT INTO service_room_requirements__m42 (tenant_id, service_id, mode, resource_id)
   SELECT q.tenant_id, q.service_id, 'room', r.id
   FROM service_room_requirements q
   JOIN resources r
     ON r.tenant_id = q.tenant_id AND r.kind = 'room' AND r.active = 1
    AND q.category IS NOT NULL AND r.category = q.category
   WHERE q.mode = 'category'`,

  `INSERT INTO service_room_requirements__m42 (tenant_id, service_id, mode, resource_id)
   SELECT s.tenant_id, s.id, 'none', ''
   FROM services s
   WHERE NOT EXISTS (
     SELECT 1 FROM service_room_requirements__m42 m
     WHERE m.tenant_id = s.tenant_id AND m.service_id = s.id
   )`,

  `DROP TABLE service_room_requirements`,
  `ALTER TABLE service_room_requirements__m42 RENAME TO service_room_requirements`,
]
