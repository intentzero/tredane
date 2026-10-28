import { SCHEDULE_GRID_MINUTES } from '../constants'
import type { ClinicDb } from '../store'
import { getService } from '../config/services'
import type { WeeklyWindowRow } from '../config/types'
import type { UnavailabilityReason } from './types'

export type Interval = { startsAt: number; endsAt: number }

export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt
}

/** Janelas semanais cobrem [startMinute, startMinute + occupiedMinutes]? */
export function weeklyCovers(
  windows: WeeklyWindowRow[],
  dayOfWeek: number,
  startMinute: number,
  occupiedMins: number,
): boolean {
  const endMinute = startMinute + occupiedMins
  if (endMinute > 24 * 60) return false
  return windows.some(
    (w) =>
      w.dayOfWeek === dayOfWeek
      && w.startMinute <= startMinute
      && w.endMinute >= endMinute,
  )
}

type BlockSql = { starts_at: number; ends_at: number; id: string }

export function listBlocksOverlapping(
  db: ClinicDb,
  tenantId: string,
  resourceId: string,
  range: Interval,
): BlockSql[] {
  return db.all<BlockSql>(
    `SELECT id, starts_at, ends_at FROM resource_blocks
     WHERE tenant_id = ? AND resource_id = ?
       AND starts_at < ? AND ends_at > ?
     ORDER BY starts_at, id`,
    tenantId,
    resourceId,
    range.endsAt,
    range.startsAt,
  )
}

type AptSql = {
  id: string
  service_id: string
  professional_id: string
  room_resource_id: string | null
  starts_at: number
  ends_at: number
  occupies_until: number | null
}

/**
 * Ocupação efetiva de um compromisso confirmado = `occupies_until` gravado na
 * reserva (duração real — inclusive override/bloco — + buffer, DEC-008).
 * Linhas antigas sem `occupies_until`: `ends_at` + buffer do serviço.
 * NÃO recalcula pela duração atual do serviço: um bloco mais longo que o
 * serviço, ou um serviço editado depois, ocupa o que foi reservado.
 */
export function appointmentOccupiesUntil(
  db: ClinicDb,
  tenantId: string,
  apt: Pick<AptSql, 'service_id' | 'ends_at' | 'occupies_until'>,
): number {
  if (apt.occupies_until != null) return Math.max(apt.occupies_until, apt.ends_at)
  const svc = getService(db, tenantId, apt.service_id)
  return apt.ends_at + (svc ? svc.bufferMinutes * 60_000 : 0)
}

export function listConfirmedOccupyingResource(
  db: ClinicDb,
  tenantId: string,
  resourceId: string,
  range: Interval,
  /** Ao reagendar, o próprio compromisso não conta como conflito. */
  excludeAppointmentId?: string | null,
): Array<{ id: string; startsAt: number; occupiesUntil: number }> {
  const rows = db.all<AptSql>(
    `SELECT id, service_id, professional_id, room_resource_id, starts_at, ends_at, occupies_until
     FROM appointments
     WHERE tenant_id = ?
       AND status = 'confirmed'
       AND (professional_id = ? OR room_resource_id = ?)
     ORDER BY starts_at, id`,
    tenantId,
    resourceId,
    resourceId,
  )
  const out: Array<{ id: string; startsAt: number; occupiesUntil: number }> = []
  for (const row of rows) {
    if (excludeAppointmentId && row.id === excludeAppointmentId) continue
    const occupiesUntil = appointmentOccupiesUntil(db, tenantId, row)
    if (intervalsOverlap(range, { startsAt: row.starts_at, endsAt: occupiesUntil })) {
      out.push({ id: row.id, startsAt: row.starts_at, occupiesUntil })
    }
  }
  return out
}

export function gridStartMinutes(occupiedMins: number): number[] {
  const last = 24 * 60 - occupiedMins
  const starts: number[] = []
  for (let m = 0; m <= last; m += SCHEDULE_GRID_MINUTES) {
    starts.push(m)
  }
  return starts
}

export type ResourceBusyReason =
  | Extract<
      UnavailabilityReason,
      'outside_weekly_hours' | 'resource_block' | 'appointment_conflict' | 'crosses_day_boundary'
    >

/**
 * Verifica se um recurso está livre no intervalo de ocupação.
 * Não cria nem altera dados.
 */
export function resourceBusyReasons(
  db: ClinicDb,
  tenantId: string,
  resourceId: string,
  /** null = recurso sem expediente (sala/equipamento, decisão 28/10/2026). */
  windows: WeeklyWindowRow[] | null,
  dayOfWeek: number,
  startMinute: number,
  occupiedMins: number,
  range: Interval,
  dayEndsAt: number,
  excludeAppointmentId?: string | null,
): ResourceBusyReason[] {
  const reasons: ResourceBusyReason[] = []
  if (range.endsAt > dayEndsAt) {
    reasons.push('crosses_day_boundary')
  }
  if (windows !== null && !weeklyCovers(windows, dayOfWeek, startMinute, occupiedMins)) {
    reasons.push('outside_weekly_hours')
  }
  if (listBlocksOverlapping(db, tenantId, resourceId, range).length > 0) {
    reasons.push('resource_block')
  }
  const occupying = listConfirmedOccupyingResource(
    db,
    tenantId,
    resourceId,
    range,
    excludeAppointmentId,
  )
  if (occupying.length > 0) {
    const capacity = resourceCapacity(db, tenantId, resourceId)
    // DEC-008 + capacidade (D-20261027-180200-CUR): ocupado quando o pico de
    // pessoas num bloco de 15 min do período já chegou à capacidade.
    if (
      capacity <= 1
      || peakConcurrent(
        range,
        occupying.map((a) => ({ startsAt: a.startsAt, endsAt: a.occupiesUntil })),
      ) >= capacity
    ) {
      reasons.push('appointment_conflict')
    }
  }
  return reasons
}

/**
 * Capacidade simultânea do recurso. Só sala tem capacidade > 1 (card
 * t1892s7600): profissional atende 1 de cada vez; equipamento não tem
 * capacidade.
 */
export function resourceCapacity(db: ClinicDb, tenantId: string, resourceId: string): number {
  const row = db.get<{ kind: string; capacity: number | null }>(
    `SELECT kind, capacity FROM resources WHERE tenant_id = ? AND id = ?`,
    tenantId,
    resourceId,
  )
  if (!row || row.kind !== 'room') return 1
  return Math.max(1, row.capacity ?? 1)
}

/**
 * Pico de pessoas ao mesmo tempo dentro de `range`, contando cada bloco de
 * 15 min da grade (DEC-008). Um intervalo conta num bloco se se sobrepõe a ele.
 */
export function peakConcurrent(range: Interval, intervals: Interval[]): number {
  const step = SCHEDULE_GRID_MINUTES * 60_000
  let peak = 0
  for (let t = range.startsAt; t < range.endsAt; t += step) {
    const chunk = { startsAt: t, endsAt: Math.min(t + step, range.endsAt) }
    let n = 0
    for (const iv of intervals) if (intervalsOverlap(chunk, iv)) n += 1
    if (n > peak) peak = n
  }
  return peak
}

/**
 * Blocos de 15 min futuros em que a sala tem mais pessoas marcadas do que a
 * capacidade (aviso ao reduzir a capacidade, card t1892s7600 — nada é apagado).
 * Blocos contíguos com a mesma contagem são agrupados.
 */
export function listOverCapacitySlots(
  db: ClinicDb,
  tenantId: string,
  roomId: string,
  capacity: number,
  fromMs: number,
): Array<{ startsAt: number; endsAt: number; count: number }> {
  const rows = db.all<AptSql>(
    `SELECT id, service_id, professional_id, room_resource_id, starts_at, ends_at, occupies_until
     FROM appointments
     WHERE tenant_id = ? AND status = 'confirmed' AND room_resource_id = ?
     ORDER BY starts_at, id`,
    tenantId,
    roomId,
  )
  const ivs = rows
    .map((r) => ({ startsAt: r.starts_at, endsAt: appointmentOccupiesUntil(db, tenantId, r) }))
    .filter((iv) => iv.endsAt > fromMs)
  if (ivs.length <= capacity) return []
  const step = SCHEDULE_GRID_MINUTES * 60_000
  const points = new Set<number>()
  for (const iv of ivs) {
    const first = Math.max(iv.startsAt, fromMs - ((fromMs - iv.startsAt) % step))
    for (let t = first; t < iv.endsAt; t += step) points.add(t)
  }
  const out: Array<{ startsAt: number; endsAt: number; count: number }> = []
  for (const t of [...points].sort((a, b) => a - b)) {
    const chunk = { startsAt: t, endsAt: t + step }
    const n = ivs.filter((iv) => intervalsOverlap(chunk, iv)).length
    if (n <= capacity) continue
    const last = out[out.length - 1]
    if (last && last.endsAt === t && last.count === n) last.endsAt = chunk.endsAt
    else out.push({ startsAt: t, endsAt: chunk.endsAt, count: n })
  }
  return out
}
