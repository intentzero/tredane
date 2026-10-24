import type { Clock } from '../../db/clock'
import { NotFoundError, ValidationError } from '../errors'
import { newId } from '../ids'
import type { ClinicDb } from '../store'
import { getResource } from './resources'
import type { SetWeeklyWindowsInput, WeeklyWindowRow } from './types'
import { assertDayOfWeek, assertWindowRange } from './validation'

type WindowSql = {
  id: string
  tenant_id: string
  resource_id: string
  day_of_week: number
  start_minute: number
  end_minute: number
}

function toWindow(row: WindowSql): WeeklyWindowRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    resourceId: row.resource_id,
    dayOfWeek: row.day_of_week,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
  }
}

export function listWeeklyWindows(
  db: ClinicDb,
  tenantId: string,
  resourceId?: string,
): WeeklyWindowRow[] {
  if (resourceId) {
    return db
      .all<WindowSql>(
        `SELECT * FROM weekly_windows
         WHERE tenant_id = ? AND resource_id = ?
         ORDER BY day_of_week, start_minute, id`,
        tenantId,
        resourceId,
      )
      .map(toWindow)
  }
  return db
    .all<WindowSql>(
      `SELECT * FROM weekly_windows WHERE tenant_id = ?
       ORDER BY resource_id, day_of_week, start_minute, id`,
      tenantId,
    )
    .map(toWindow)
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

/**
 * Substitui o expediente semanal de um recurso (DEC-008).
 * Sem recorrência complexa — só faixas por dia da semana.
 */
export function setWeeklyWindows(
  db: ClinicDb,
  tenantId: string,
  input: SetWeeklyWindowsInput,
  clock: Clock,
): WeeklyWindowRow[] {
  const resource = getResource(db, tenantId, input.resourceId, clock)
  if (!resource) {
    throw new NotFoundError(
      'resource_not_found',
      `recurso ${input.resourceId} não encontrado`,
    )
  }

  for (const w of input.windows) {
    assertDayOfWeek(w.dayOfWeek)
    assertWindowRange(w.startMinute, w.endMinute)
  }
  assertNoOverlap(input.windows)

  db.run(
    `DELETE FROM weekly_windows WHERE tenant_id = ? AND resource_id = ?`,
    tenantId,
    input.resourceId,
  )

  for (const w of input.windows) {
    db.run(
      `INSERT INTO weekly_windows (
        id, tenant_id, resource_id, day_of_week, start_minute, end_minute
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      newId('win'),
      tenantId,
      input.resourceId,
      w.dayOfWeek,
      w.startMinute,
      w.endMinute,
    )
  }

  return listWeeklyWindows(db, tenantId, input.resourceId)
}
