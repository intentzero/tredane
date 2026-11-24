import { SCHEDULE_GRID_MINUTES } from '../constants'
import type { ClinicDb } from '../store'
import { getService } from '../config/services'
import { CLINIC_SCOPE_ID, type WeeklyWindowRow } from '../config/types'
import type { UnavailabilityReason } from './types'
import type { HoldNeed } from './hold-fit'

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
export type ServiceBufferCache = Map<string, number>

function bufferMsForService(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
  cache?: ServiceBufferCache,
): number {
  if (cache?.has(serviceId)) return cache.get(serviceId)!
  const svc = getService(db, tenantId, serviceId)
  const ms = svc ? svc.bufferMinutes * 60_000 : 0
  cache?.set(serviceId, ms)
  return ms
}

export function appointmentOccupiesUntil(
  db: ClinicDb,
  tenantId: string,
  apt: Pick<AptSql, 'service_id' | 'ends_at' | 'occupies_until'>,
  serviceBufferCache?: ServiceBufferCache,
): number {
  if (apt.occupies_until != null) return Math.max(apt.occupies_until, apt.ends_at)
  return apt.ends_at + bufferMsForService(db, tenantId, apt.service_id, serviceBufferCache)
}

/** Cache por recurso/dia: uma leitura SQL por recurso em `queryAvailability`. */
export type OccupancyDayIndex = {
  dayRange: Interval
  excludeAppointmentId?: string | null
  byResource: Map<string, OccupyingAppointment[]>
  serviceBufferCache: ServiceBufferCache
  /** Bloqueios do recurso (e da clínica) que tocam o dia: uma leitura por recurso (DEC-227, custo). */
  blocksByResource: Map<string, BlockSql[]>
  /** Holds activos da profissional que tocam o dia: uma leitura por profissional. */
  holdsByProfessional: Map<string, HoldNeed[]>
  /** Tipo e capacidade do recurso: uma leitura por recurso. */
  resourceMeta: Map<string, { kind: string; capacity: number | null } | null>
}

export function createOccupancyDayIndex(
  dayRange: Interval,
  excludeAppointmentId?: string | null,
): OccupancyDayIndex {
  return {
    dayRange,
    excludeAppointmentId,
    byResource: new Map(),
    serviceBufferCache: new Map(),
    blocksByResource: new Map(),
    holdsByProfessional: new Map(),
    resourceMeta: new Map(),
  }
}

function rangeWithinDay(range: Interval, day: Interval): boolean {
  return range.startsAt >= day.startsAt && range.endsAt <= day.endsAt
}

/**
 * Bloqueios que tocam `range`. Com índice de dia, lê-os uma vez por recurso e filtra em memória
 * (igual à consulta directa quando `range` cabe no dia; senão cai na consulta directa).
 */
export function blocksForRange(
  db: ClinicDb,
  tenantId: string,
  resourceId: string,
  range: Interval,
  index?: OccupancyDayIndex,
): BlockSql[] {
  if (!index || !rangeWithinDay(range, index.dayRange)) {
    return listBlocksOverlapping(db, tenantId, resourceId, range)
  }
  let day = index.blocksByResource.get(resourceId)
  if (!day) {
    day = listBlocksOverlapping(db, tenantId, resourceId, index.dayRange)
    index.blocksByResource.set(resourceId, day)
  }
  return day.filter((b) => b.starts_at < range.endsAt && b.ends_at > range.startsAt)
}

/** Tipo e capacidade do recurso, lidos uma vez por índice de dia. */
export function resourceKindAndCapacity(
  db: ClinicDb,
  tenantId: string,
  resourceId: string,
  index?: OccupancyDayIndex,
): { kind: string; capacity: number | null } | null {
  if (index?.resourceMeta.has(resourceId)) return index.resourceMeta.get(resourceId) ?? null
  const row =
    db.get<{ kind: string; capacity: number | null }>(
      `SELECT kind, capacity FROM resources WHERE tenant_id = ? AND id = ?`,
      tenantId,
      resourceId,
    ) ?? null
  index?.resourceMeta.set(resourceId, row)
  return row
}

function capacityOf(meta: { kind: string; capacity: number | null } | null): number {
  if (!meta || meta.kind !== 'room') return 1
  return Math.max(1, meta.capacity ?? 1)
}

function loadOccupyingForResourceDay(
  db: ClinicDb,
  tenantId: string,
  index: OccupancyDayIndex,
  resourceId: string,
): OccupyingAppointment[] {
  let hit = index.byResource.get(resourceId)
  if (!hit) {
    hit = listConfirmedOccupyingResource(
      db,
      tenantId,
      resourceId,
      index.dayRange,
      index.excludeAppointmentId,
      index.serviceBufferCache,
    )
    index.byResource.set(resourceId, hit)
  }
  return hit
}

/** Ocupações que intersectam `range`; com índice de dia evita N×SQL na grade. */
export function occupyingForRange(
  db: ClinicDb,
  tenantId: string,
  resourceId: string,
  range: Interval,
  index: OccupancyDayIndex | undefined,
  excludeAppointmentId?: string | null,
): OccupyingAppointment[] {
  if (index) {
    const dayList = loadOccupyingForResourceDay(db, tenantId, index, resourceId)
    return dayList.filter((a) =>
      intervalsOverlap(range, { startsAt: a.startsAt, endsAt: a.occupiesUntil }),
    )
  }
  return listConfirmedOccupyingResource(
    db,
    tenantId,
    resourceId,
    range,
    excludeAppointmentId,
  )
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
  serviceBufferCache?: ServiceBufferCache,
): OccupyingAppointment[] {
  // DEC-082: room_resource_id é uma sala da lista do serviço. Equipamento exigido
  // (mode=equipment) ocupa uma vaga à parte, sem ser o room_resource_id.
  const rows = db.all<AptSql>(
    `SELECT a.id, a.service_id, a.professional_id, a.room_resource_id, a.contact_id,
            a.starts_at, a.ends_at, a.occupies_until
     FROM appointments a
     LEFT JOIN services s ON s.tenant_id = a.tenant_id AND s.id = a.service_id
     WHERE a.tenant_id = ?
       AND a.status = 'confirmed'
       AND a.starts_at < ?
       AND COALESCE(
         a.occupies_until,
         a.ends_at + COALESCE(s.buffer_minutes, 0) * 60000
       ) > ?
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
             AND q.mode = 'equipment'
             AND q.resource_id = ?
         )
       )
     ORDER BY a.starts_at, a.id`,
    tenantId,
    range.endsAt,
    range.startsAt,
    resourceId,
    resourceId,
    resourceId,
  )
  const out: OccupyingAppointment[] = []
  for (const row of rows) {
    if (excludeAppointmentId && row.id === excludeAppointmentId) continue
    const occupiesUntil = appointmentOccupiesUntil(db, tenantId, row, serviceBufferCache)
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
      | 'outside_weekly_hours'
      | 'resource_block'
      | 'appointment_conflict'
      | 'room_at_capacity'
      | 'professional_other_room'
      | 'crosses_day_boundary'
    >

/**
 * Verifica se um recurso está livre no intervalo de ocupação.
 * Não cria nem altera dados.
 *
 * @param groupModeRoomId DEC-075 / S4 — se a profissional marca nesta sala em
 *   modo «Uma profissional para todas», as marcações dela *nesta* sala não a
 *   travam (a capacidade da sala limita). Marcações noutra sala continuam a
 *   bloquear.
 * @param targetRoomId DEC-075 / S6 — sala do candidato; distingue «outra sala»
 *   de compromisso na mesma sala.
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
  targetRoomId?: string | null,
  occupancyIndex?: OccupancyDayIndex,
): ResourceBusyReason[] {
  const reasons: ResourceBusyReason[] = []
  if (range.endsAt > dayEndsAt) {
    reasons.push('crosses_day_boundary')
  }
  if (windows !== null && !weeklyCovers(windows, dayOfWeek, startMinute, occupiedMins)) {
    reasons.push('outside_weekly_hours')
  }
  if (blocksForRange(db, tenantId, resourceId, range, occupancyIndex).length > 0) {
    reasons.push('resource_block')
  }
  let occupying = occupyingForRange(
    db,
    tenantId,
    resourceId,
    range,
    occupancyIndex,
    occupancyIndex ? occupancyIndex.excludeAppointmentId : excludeAppointmentId,
  )
  if (groupModeRoomId) {
    occupying = occupying.filter((a) => a.roomResourceId !== groupModeRoomId)
  }
  if (occupying.length === 0) return reasons

  const meta = resourceKindAndCapacity(db, tenantId, resourceId, occupancyIndex)
  const kind = meta?.kind ?? ''
  const capacity = capacityOf(meta)

  if (kind === 'room') {
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
      reasons.push('room_at_capacity')
    }
    return reasons
  }

  if (kind === 'professional' && targetRoomId) {
    const inOther = occupying.some(
      (a) => a.roomResourceId != null && a.roomResourceId !== targetRoomId,
    )
    if (inOther) {
      reasons.push('professional_other_room')
      return reasons
    }
  }

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
