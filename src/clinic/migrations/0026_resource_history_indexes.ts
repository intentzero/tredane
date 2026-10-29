/**
 * Migração 26 — índices para o aviso «tem histórico» de profissionais e salas.
 * Sem eles, cada carga da Clínica varria por inteiro as tabelas de intenções, cobranças e
 * alocações, uma vez por recurso (leituras de linhas dos Durable Objects, #226).
 */
export const MIGRATION_ID = 26
export const MIGRATION_NAME = '0026_resource_history_indexes'

export const STATEMENTS: readonly string[] = [
  `CREATE INDEX IF NOT EXISTS idx_scheduling_intents_professional
    ON scheduling_intents (tenant_id, professional_id)`,
  `CREATE INDEX IF NOT EXISTS idx_scheduling_intents_room
    ON scheduling_intents (tenant_id, room_resource_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pix_charges_professional
    ON pix_charges (tenant_id, professional_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pix_charges_room
    ON pix_charges (tenant_id, room_resource_id)`,
  `CREATE INDEX IF NOT EXISTS idx_allocations_resource_id
    ON appointment_allocations (tenant_id, resource_id)`,
]
