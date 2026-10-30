/**
 * Migração 37 — sala da profissional e modo de atendimento (DEC-075 / S3).
 * home_room_id: várias profissionais podem partilhar a mesma sala.
 * attendance_mode: padrão cada_profissional (comportamento actual).
 * Backfill: sala única inequívoca nos serviços activos em modo resource.
 */
export const MIGRATION_ID = 37
export const MIGRATION_NAME = '0037_professional_home_room'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE resources ADD COLUMN home_room_id TEXT`,
  `ALTER TABLE resources
    ADD COLUMN attendance_mode TEXT NOT NULL DEFAULT 'cada_profissional'
    CHECK (attendance_mode IN ('cada_profissional', 'uma_para_todas'))`,
  // Só profissionais com exactamente uma sala (modo resource) nos serviços activos.
  `UPDATE resources
    SET home_room_id = (
      SELECT q.resource_id
      FROM service_professionals sp
      JOIN services s
        ON s.tenant_id = sp.tenant_id AND s.id = sp.service_id AND s.active = 1
      JOIN service_room_requirements q
        ON q.tenant_id = sp.tenant_id AND q.service_id = sp.service_id
       AND q.mode = 'resource' AND q.resource_id IS NOT NULL
      JOIN resources room
        ON room.tenant_id = q.tenant_id AND room.id = q.resource_id AND room.kind = 'room'
      WHERE sp.tenant_id = resources.tenant_id
        AND sp.professional_id = resources.id
      GROUP BY sp.professional_id
      HAVING COUNT(DISTINCT q.resource_id) = 1
    )
    WHERE kind = 'professional'
      AND home_room_id IS NULL
      AND (
        SELECT COUNT(DISTINCT q.resource_id)
        FROM service_professionals sp
        JOIN services s
          ON s.tenant_id = sp.tenant_id AND s.id = sp.service_id AND s.active = 1
        JOIN service_room_requirements q
          ON q.tenant_id = sp.tenant_id AND q.service_id = sp.service_id
         AND q.mode = 'resource' AND q.resource_id IS NOT NULL
        JOIN resources room
          ON room.tenant_id = q.tenant_id AND room.id = q.resource_id AND room.kind = 'room'
        WHERE sp.tenant_id = resources.tenant_id
          AND sp.professional_id = resources.id
      ) = 1`,
]
