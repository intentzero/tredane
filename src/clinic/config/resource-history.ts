import type { ClinicDb } from '../store'

/** Teve algum compromisso, reserva ou cobrança (passado ou futuro)? */
export function resourceHasHistory(db: ClinicDb, tenantId: string, resourceId: string): boolean {
  const checks: Array<[string, string]> = [
    ['appointments', 'professional_id = ? OR room_resource_id = ?'],
    ['appointment_allocations', 'resource_id = ? OR resource_id = ?'],
    ['scheduling_intents', 'professional_id = ? OR room_resource_id = ?'],
    ['pix_charges', 'professional_id = ? OR room_resource_id = ?'],
    ['schedule_holds', 'professional_id = ? OR professional_id = ?'],
  ]
  for (const [table, where] of checks) {
    const exists = db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`,
      table,
    )
    if (!exists?.n) continue
    const row = db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ? AND (${where})`,
      tenantId,
      resourceId,
      resourceId,
    )
    if ((row?.n ?? 0) > 0) return true
  }
  return false
}
