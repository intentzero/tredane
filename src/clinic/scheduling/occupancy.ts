import { SCHEDULE_GRID_MINUTES } from '../constants'
import type { ClinicDb } from '../store'
import { getService } from '../config/services'
import { CLINIC_SCOPE_ID, type WeeklyWindowRow } from '../config/types'
import type { UnavailabilityReason } from './types'

export type Interval = { startsAt: number; endsAt: number }

export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt
}

/** Janelas semanais cobrem [startMinute, startMinute + occupiedMinutes]? */
/** Horário de oferta do serviço: vazio = sem filtro (issue #261). */
export function serviceOfferingAllows(
  windows: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>,
  dayOfWeek: number,
  startMinute: number,
  occupiedMins: number,
): boolean {
  if (windows.length === 0) return true
  const mapped: WeeklyWindowRow[] = windows.map((w, i) => ({
    id: `svc:${i}`,
    tenantId: '',
    resourceId: '',
    dayOfWeek: w.dayOfWeek,
    startMinute: w.startMinute,
    endMinute: w.endMinute,
  }))
  return weeklyCovers(mapped, dayOfWeek, startMinute, occupiedMins)
}

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
     WHERE tenant_id = ? AND (resource_id = ? OR resource_id = ?)
       AND starts_at < ? AND ends_at > ?
     ORDER BY starts_at, id`,
    tenantId,
    resourceId,
    CLINIC_SCOPE_ID,
    range.endsAt,
    range.startsAt,
  )
}

type AptSql = {
  id: string
  service_id: string
  professional_id: string
  room_resource_id: string | null
  contact_id?: string | null
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

export type OccupyingAppointment = {
  id: string
  startsAt: number
  occupiesUntil: number
  /** Contacto da marcação; sem contacto cada marcação conta como pessoa distinta. */
  contactId: string | null
  personKey: string
  roomResourceId: string | null
}

export function listConfirmedOccupyingResource(
  db: ClinicDb,
  tenantId: string,
  resourceId: string,
  range: Interval,
  /** Ao reagendar, o próprio compromisso não conta como conflito. */
  excludeAppointmentId?: string | null,
): OccupyingAppointment[] {
  // DEC-075: room_resource_id é a sala da profissional. Equipamento exigido pelo
  // serviço (mode=resource → kind=equipment) continua a ocupar uma vaga via o
  // requisito do serviço, sem ser o room_resource_id da marcação.
  const rows = db.all<AptSql>(
    `SELECT a.id, a.service_id, a.professional_id, a.room_resource_id, a.contact_id,
            a.starts_at, a.ends_at, a.occupies_until
     FROM appointments a
     WHERE a.tenant_id = ?
       AND a.status = 'confirmed'
       AND (
         a.professional_id = ?
         OR a.room_resource_id = ?
         OR EXISTS (
           SELECT 1
           FROM service_room_requirements q
           JOIN resources eq
             ON eq.tenant_id = q.tenant_id
            AND eq.id = q.resource_id
            AND eq.kind = 'equipment'
           WHERE q.tenant_id = a.tenant_id
             AND q.service_id = a.service_id
             AND q.mode = 'resource'
             AND q.resource_id = ?
         )
       )
     ORDER BY a.starts_at, a.id`,
    tenantId,
    resourceId,
    resourceId,
    resourceId,
  )
  const out: OccupyingAppointment[] = []
  for (const row of rows) {
    if (excludeAppointmentId && row.id === excludeAppointmentId) continue
    const occupiesUntil = appointmentOccupiesUntil(db, tenantId, row)
    if (intervalsOverlap(range, { startsAt: row.starts_at, endsAt: occupiesUntil })) {
      const contactId = row.contact_id ?? null
      out.push({
        id: row.id,
        startsAt: row.starts_at,
        occupiesUntil,
        contactId,
        personKey: contactId ?? `apt:${row.id}`,
        roomResourceId: row.room_resource_id ?? null,
      })
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
 *
 * @param groupModeRoomId DEC-075 / S4 — se a profissional marca nesta sala em
 *   modo «Uma profissional para todas», as marcações dela *nesta* sala não a
 *   travam (a capacidade da sala limita). Marcações noutra sala continuam a
 *   bloquear.
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
  groupModeRoomId?: string | null,
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
  let occupying = listConfirmedOccupyingResource(
    db,
    tenantId,
    resourceId,
    range,
    excludeAppointmentId,
  )
  if (groupModeRoomId) {
    occupying = occupying.filter((a) => a.roomResourceId !== groupModeRoomId)
  }
  if (occupying.length > 0) {
    const capacity = resourceCapacity(db, tenantId, resourceId)
    // DEC-075: pico de pessoas distintas (mesmo contacto = 1) por bloco de 15 min.
    if (
      capacity <= 1
      || peakConcurrentPeople(
        range,
        occupying.map((a) => ({
          startsAt: a.startsAt,
          endsAt: a.occupiesUntil,
          personKey: a.personKey,
        })),
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
 * Pico de intervalos (marcações) ao mesmo tempo — útil em testes de grade.
 * Para capacidade da sala use {@link peakConcurrentPeople}.
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
 * Pico de pessoas distintas (DEC-075): dois serviços do mesmo contacto no
 * mesmo bloco contam como uma pessoa.
 */
export function peakConcurrentPeople(
  range: Interval,
  intervals: Array<Interval & { personKey: string }>,
): number {
  const step = SCHEDULE_GRID_MINUTES * 60_000
  let peak = 0
  for (let t = range.startsAt; t < range.endsAt; t += step) {
    const chunk = { startsAt: t, endsAt: Math.min(t + step, range.endsAt) }
    const people = new Set<string>()
    for (const iv of intervals) {
      if (intervalsOverlap(chunk, iv)) people.add(iv.personKey)
    }
    if (people.size > peak) peak = people.size
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
    `SELECT id, service_id, professional_id, room_resource_id, contact_id,
            starts_at, ends_at, occupies_until
     FROM appointments
     WHERE tenant_id = ? AND status = 'confirmed' AND room_resource_id = ?
     ORDER BY starts_at, id`,
    tenantId,
    roomId,
  )
  const ivs = rows
    .map((r) => ({
      startsAt: r.starts_at,
      endsAt: appointmentOccupiesUntil(db, tenantId, r),
      personKey: r.contact_id ?? `apt:${r.id}`,
    }))
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
    const people = new Set<string>()
    for (const iv of ivs) {
      if (intervalsOverlap(chunk, iv)) people.add(iv.personKey)
    }
    const n = people.size
    if (n <= capacity) continue
    const last = out[out.length - 1]
    if (last && last.endsAt === t && last.count === n) last.endsAt = chunk.endsAt
    else out.push({ startsAt: t, endsAt: chunk.endsAt, count: n })
  }
  return out
}
