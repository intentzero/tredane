import type { ClinicDb } from '../store'

/** Colunas de cada tabela que apontam para um recurso (profissional, sala ou equipamento). */
const CHECKS: Array<[string, string[]]> = [
  ['appointments', ['professional_id', 'room_resource_id']],
  ['appointment_allocations', ['resource_id']],
  ['scheduling_intents', ['professional_id', 'room_resource_id']],
  ['pix_charges', ['professional_id', 'room_resource_id']],
  ['schedule_holds', ['professional_id']],
  ['appointment_proposals', ['professional_id']],
]

/**
 * Teve algum compromisso, reserva ou cobrança (passado ou futuro)?
 * Uma consulta por coluna com `LIMIT 1`, cada uma sobre um índice (migração 26): lê no
 * máximo uma linha por consulta em vez de varrer a tabela da clínica.
 */
export function resourceHasHistory(db: ClinicDb, tenantId: string, resourceId: string): boolean {
  const present = new Set(
    db
      .all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${CHECKS.map(() => '?').join(', ')})`,
        ...CHECKS.map(([table]) => table),
      )
      .map((r) => r.name),
  )
  for (const [table, columns] of CHECKS) {
    if (!present.has(table)) continue
    for (const column of columns) {
      const hit = db.get<{ one: number }>(
        `SELECT 1 AS one FROM ${table} WHERE tenant_id = ? AND ${column} = ? LIMIT 1`,
        tenantId,
        resourceId,
      )
      if (hit) return true
    }
  }
  return false
}
