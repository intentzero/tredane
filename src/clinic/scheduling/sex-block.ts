/**
 * DEC-075 / S5 — sexo do bloco na sala («Mesmo sexo neste horário»).
 * A audiência vem do serviço, nunca do contacto.
 */
import type { Clock } from '../../db/clock'
import type { ServiceAudience } from '../catalog/audience'
import { normalizeServiceAudience } from '../catalog/audience'
import { writeOperationalAudit } from '../audit'
import { NotFoundError, ValidationError } from '../errors'
import { newId } from '../ids'
import { getResource } from '../config/resources'
import { getService } from '../config/services'
import type { ClinicDb } from '../store'
import {
  appointmentOccupiesUntil,
  intervalsOverlap,
  type Interval,
} from './occupancy'

export type BlockSex = 'feminino' | 'masculino'

type AptSexSql = {
  id: string
  service_id: string
  starts_at: number
  ends_at: number
  occupies_until: number | null
}

function listOverlappingRoomAppointments(
  db: ClinicDb,
  tenantId: string,
  roomId: string,
  range: Interval,
  excludeAppointmentId?: string | null,
): Array<{ id: string; startsAt: number; occupiesUntil: number; audiencia: ServiceAudience }> {
  const rows = db.all<AptSexSql>(
    `SELECT id, service_id, starts_at, ends_at, occupies_until
     FROM appointments
     WHERE tenant_id = ? AND status = 'confirmed' AND room_resource_id = ?
     ORDER BY starts_at, id`,
    tenantId,
    roomId,
  )
  const out: Array<{
    id: string
    startsAt: number
    occupiesUntil: number
    audiencia: ServiceAudience
  }> = []
  for (const row of rows) {
    if (excludeAppointmentId && row.id === excludeAppointmentId) continue
    const occupiesUntil = appointmentOccupiesUntil(db, tenantId, row)
    if (!intervalsOverlap(range, { startsAt: row.starts_at, endsAt: occupiesUntil })) continue
    const svc = getService(db, tenantId, row.service_id)
    out.push({
      id: row.id,
      startsAt: row.starts_at,
      occupiesUntil,
      audiencia: normalizeServiceAudience(svc?.audiencia),
    })
  }
  return out
}

/**
 * Sexo do bloco: primeira marcação (início, empate por id) com audiência
 * feminino ou masculino. `qualquer` não fixa nem quebra.
 */
export function blockSexFromAppointments(
  apts: Array<{ id: string; startsAt: number; audiencia: ServiceAudience }>,
): BlockSex | null {
  const ordered = [...apts].sort((a, b) =>
    a.startsAt !== b.startsAt ? a.startsAt - b.startsAt : a.id.localeCompare(b.id),
  )
  for (const a of ordered) {
    if (a.audiencia === 'feminino' || a.audiencia === 'masculino') return a.audiencia
  }
  return null
}

export function hasAllowBothException(
  db: ClinicDb,
  tenantId: string,
  roomId: string,
  range: Interval,
): boolean {
  const row = db.get<{ id: string }>(
    `SELECT id FROM room_sex_block_exceptions
     WHERE tenant_id = ? AND room_resource_id = ?
       AND starts_at < ? AND ends_at > ?
     LIMIT 1`,
    tenantId,
    roomId,
    range.endsAt,
    range.startsAt,
  )
  return Boolean(row)
}

/**
 * Recusa se o serviço candidato tem audiência oposta ao sexo do bloco,
 * sem «Permitir os dois» activo para o intervalo.
 */
export function roomSexConflict(
  db: ClinicDb,
  tenantId: string,
  roomId: string,
  range: Interval,
  candidateAudience: ServiceAudience,
  opts?: { excludeAppointmentId?: string | null },
): boolean {
  const room = db.get<{ same_sex_in_slot: number; capacity: number | null; kind: string }>(
    `SELECT same_sex_in_slot, capacity, kind FROM resources WHERE tenant_id = ? AND id = ?`,
    tenantId,
    roomId,
  )
  if (!room || room.kind !== 'room') return false
  if (room.same_sex_in_slot !== 1 || Math.max(1, room.capacity ?? 1) <= 1) return false

  const cand = normalizeServiceAudience(candidateAudience)
  if (cand === 'qualquer') return false

  const overlapping = listOverlappingRoomAppointments(
    db,
    tenantId,
    roomId,
    range,
    opts?.excludeAppointmentId,
  )
  const sex = blockSexFromAppointments(overlapping)
  if (!sex || sex === cand) return false
  if (hasAllowBothException(db, tenantId, roomId, range)) return false
  return true
}

/**
 * Expande o intervalo ao cluster de sobreposições actuais na sala (bloco).
 */
export function expandRoomBlockInterval(
  db: ClinicDb,
  tenantId: string,
  roomId: string,
  seed: Interval,
): Interval {
  let startsAt = seed.startsAt
  let endsAt = seed.endsAt
  // Itera até fecho: marcações que tocam o intervalo alargam-no.
  for (let i = 0; i < 32; i++) {
    const overlapping = listOverlappingRoomAppointments(db, tenantId, roomId, {
      startsAt,
      endsAt,
    })
    if (overlapping.length === 0) return { startsAt, endsAt }
    let nextStart = startsAt
    let nextEnd = endsAt
    for (const a of overlapping) {
      if (a.startsAt < nextStart) nextStart = a.startsAt
      if (a.occupiesUntil > nextEnd) nextEnd = a.occupiesUntil
    }
    if (nextStart === startsAt && nextEnd === endsAt) return { startsAt, endsAt }
    startsAt = nextStart
    endsAt = nextEnd
  }
  return { startsAt, endsAt }
}

export type AllowBothSexesResult = {
  id: string
  roomResourceId: string
  startsAt: number
  endsAt: number
  actorClerkUserId: string
  createdAt: number
}

/**
 * «Permitir os dois» — só a responsável (clinic.config.write no HTTP).
 * AI / atendente não devem chamar isto.
 */
export function allowBothSexesInBlock(
  db: ClinicDb,
  tenantId: string,
  input: {
    roomResourceId: string
    /** Ponto no bloco (ou intervalo) a liberalizar. */
    startsAt: number
    endsAt?: number
    actorClerkUserId: string
  },
  clock: Clock,
): AllowBothSexesResult {
  if (!input.actorClerkUserId || input.actorClerkUserId.startsWith('ai_')) {
    throw new ValidationError(
      'allow_both_owner_only',
      'Só a responsável pode permitir os dois sexos neste horário.',
    )
  }
  const room = getResource(db, tenantId, input.roomResourceId, clock)
  if (!room || room.kind !== 'room' || !room.active) {
    throw new NotFoundError('room_not_found', `sala ${input.roomResourceId} não encontrada`)
  }
  if (room.capacity <= 1) {
    throw new ValidationError(
      'same_sex_capacity',
      'Sala de 1 lugar não usa «Mesmo sexo» nem «Permitir os dois».',
    )
  }
  if (!room.sameSexInSlot) {
    throw new ValidationError(
      'same_sex_disabled',
      'Ligue «Mesmo sexo neste horário» nesta sala antes de permitir os dois.',
    )
  }
  const seedEnd = input.endsAt ?? input.startsAt + 60_000
  if (seedEnd <= input.startsAt) {
    throw new ValidationError('invalid_interval', 'O intervalo tem de ter fim depois do início.')
  }
  const block = expandRoomBlockInterval(db, tenantId, room.id, {
    startsAt: input.startsAt,
    endsAt: seedEnd,
  })
  const now = clock.nowMs()
  const id = newId('rsex')
  db.run(
    `INSERT INTO room_sex_block_exceptions (
      id, tenant_id, room_resource_id, starts_at, ends_at, actor_clerk_user_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    tenantId,
    room.id,
    block.startsAt,
    block.endsAt,
    input.actorClerkUserId,
    now,
  )
  writeOperationalAudit(
    db,
    {
      tenantId,
      actor: input.actorClerkUserId,
      action: 'room.allow_both_sexes',
      objectType: 'room',
      objectId: room.id,
      detail: {
        roomResourceId: room.id,
        startsAt: block.startsAt,
        endsAt: block.endsAt,
        exceptionId: id,
      },
    },
    clock,
  )
  return {
    id,
    roomResourceId: room.id,
    startsAt: block.startsAt,
    endsAt: block.endsAt,
    actorClerkUserId: input.actorClerkUserId,
    createdAt: now,
  }
}
