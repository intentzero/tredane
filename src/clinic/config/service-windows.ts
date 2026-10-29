import { ValidationError } from '../errors'
import { newId } from '../ids'
import type { ClinicDb } from '../store'
import { assertDayOfWeek, assertWindowRange } from './validation'
import type { ServiceWeeklyWindowRow } from './types'

type WindowSql = {
  id: string
  tenant_id: string
  service_id: string
  day_of_week: number
  start_minute: number
  end_minute: number
}

function toRow(row: WindowSql): ServiceWeeklyWindowRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    serviceId: row.service_id,
    dayOfWeek: row.day_of_week,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
  }
}

function assertNoOverlap(
  windows: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>,
): void {
  const byDay = new Map<number, Array<{ startMinute: number; endMinute: number }>>()
  for (const w of windows) {
    const list = byDay.get(w.dayOfWeek) ?? []
    list.push({ startMinute: w.startMinute, endMinute: w.endMinute })
    byDay.set(w.dayOfWeek, list)
  }
  for (const [day, list] of byDay) {
    const sorted = [...list].sort((a, b) => a.startMinute - b.startMinute)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!
      const cur = sorted[i]!
      if (cur.startMinute < prev.endMinute) {
        throw new ValidationError(
          'overlapping_windows',
          `faixas sobrepostas no dia ${day}`,
          { dayOfWeek: day },
        )
      }
    }
  }
}

export function listServiceWeeklyWindows(
  db: ClinicDb,
  tenantId: string,
  serviceId?: string,
): ServiceWeeklyWindowRow[] {
  if (serviceId) {
    return db
      .all<WindowSql>(
        `SELECT * FROM service_weekly_windows
         WHERE tenant_id = ? AND service_id = ?
         ORDER BY day_of_week, start_minute, id`,
        tenantId,
        serviceId,
      )
      .map(toRow)
  }
  return db
    .all<WindowSql>(
      `SELECT * FROM service_weekly_windows WHERE tenant_id = ?
       ORDER BY service_id, day_of_week, start_minute, id`,
      tenantId,
    )
    .map(toRow)
}

/**
 * Substitui o horário semanal de oferta de um serviço (issue #261).
 * Lista vazia = sem filtro (qualquer horário dentro do expediente da profissional).
 */
export function setServiceWeeklyWindows(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
  windows: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>,
): ServiceWeeklyWindowRow[] {
  for (const w of windows) {
    assertDayOfWeek(w.dayOfWeek)
    assertWindowRange(w.startMinute, w.endMinute)
  }
  assertNoOverlap(windows)

  db.run(
    `DELETE FROM service_weekly_windows WHERE tenant_id = ? AND service_id = ?`,
    tenantId,
    serviceId,
  )

  for (const w of windows) {
    db.run(
      `INSERT INTO service_weekly_windows (
        id, tenant_id, service_id, day_of_week, start_minute, end_minute
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      newId('swin'),
      tenantId,
      serviceId,
      w.dayOfWeek,
      w.startMinute,
      w.endMinute,
    )
  }

  return listServiceWeeklyWindows(db, tenantId, serviceId)
}
