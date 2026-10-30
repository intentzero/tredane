/**
 * Ciclo de vida de profissionais e salas/equipamentos: desativar com
 * tratamento de compromissos futuros, reativar e excluir (só sem histórico).
 *
 * Regras:
 * - Nunca cancela compromissos automaticamente.
 * - Nunca notifica o paciente (sem outbox): só auditoria + evento do compromisso.
 * - Remanejamento revalida disponibilidade (checkSlotAvailability) na mesma TX.
 */
import type { Clock } from '../../db/clock'
import { writeOperationalAudit } from '../audit'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import {
  deleteAllocationsForAppointment,
  insertAllocations,
} from '../scheduling/allocations'
import { checkSlotAvailability } from '../scheduling/check'
import { insertAppointmentEvent } from '../scheduling/events'
import { toAppointment } from './appointments'
import { resourceHasHistory } from './resource-history'
import {
  getResource,
  listResources,
  servicesLeftWithoutCategoryResource,
} from './resources'
import { getService } from './services'
import { ensureClinicSettings } from './settings'
import type { AppointmentRow, ResourceRow } from './types'

export type ReassignCandidate = { id: string; name: string }

export type FutureAppointmentForResource = {
  appointmentId: string
  serviceId: string
  serviceName: string | null
  contactLabel: string | null
  startsAt: number
  endsAt: number
  professionalId: string
  roomResourceId: string | null
  version: number
  /** Recursos ativos livres neste horário e compatíveis com o serviço. */
  candidates: ReassignCandidate[]
  /** Primeiro candidato, quando existe. */
  suggestedResourceId: string | null
}

export type ResourceReassignment = {
  appointmentId: string
  targetResourceId: string
  expectedVersion?: number
}

export type DeactivateResourceInput = {
  resourceId: string
  /** Compromissos a remanejar; os restantes ficam mantidos no recurso. */
  reassignments?: ResourceReassignment[]
}

export type DeactivateResourceResult = ResourceRow & {
  servicesWithoutResource?: string[]
  reassigned: Array<{ appointmentId: string; fromResourceId: string; toResourceId: string }>
  keptAppointmentIds: string[]
}

function prepare(db: ClinicDb, caller: ClinicCaller, clock: Clock) {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  ensureClinicSettings(db, meta.tenantId, clock)
  return meta
}

function isRoomKind(kind: string): boolean {
  return kind === 'room' || kind === 'equipment'
}

function loadResourceOrThrow(
  db: ClinicDb,
  tenantId: string,
  resourceId: string,
  clock: Clock,
): ResourceRow {
  const row = getResource(db, tenantId, resourceId, clock)
  if (!row) {
    throw new NotFoundError('resource_not_found', `recurso ${resourceId} não encontrado`)
  }
  return row
}

function futureAppointmentsOf(
  db: ClinicDb,
  tenantId: string,
  resource: ResourceRow,
  nowMs: number,
): AppointmentRow[] {
  const column = resource.kind === 'professional' ? 'professional_id' : 'room_resource_id'
  return db
    .all<Parameters<typeof toAppointment>[0]>(
      `SELECT * FROM appointments
       WHERE tenant_id = ? AND ${column} = ?
         AND status = 'confirmed' AND starts_at >= ?
       ORDER BY starts_at, id`,
      tenantId,
      resource.id,
      nowMs,
    )
    .map(toAppointment)
}

function slotInputFor(apt: AppointmentRow, resource: ResourceRow, targetId: string) {
  return {
    serviceId: apt.serviceId,
    professionalId: resource.kind === 'professional' ? targetId : apt.professionalId,
    roomResourceId: isRoomKind(resource.kind) ? targetId : apt.roomResourceId,
    startsAt: apt.startsAt,
    excludeAppointmentId: apt.id,
  }
}

/** Verifica um alvo sem lançar: devolve motivos de indisponibilidade. */
function checkTarget(
  db: ClinicDb,
  tenantId: string,
  apt: AppointmentRow,
  resource: ResourceRow,
  target: ResourceRow,
  clock: Clock,
): string[] {
  if (target.id === resource.id) return ['same_resource']
  if (!target.active) return ['target_inactive']
  if (resource.kind === 'professional' ? target.kind !== 'professional' : !isRoomKind(target.kind)) {
    return ['target_kind_mismatch']
  }
  try {
    const res = checkSlotAvailability(
      db,
      tenantId,
      slotInputFor(apt, resource, target.id),
      clock,
    )
    return res.available ? [] : res.reasons
  } catch (err) {
    if (err instanceof NotFoundError) return [err.code]
    throw err
  }
}

function candidatesFor(
  db: ClinicDb,
  tenantId: string,
  apt: AppointmentRow,
  resource: ResourceRow,
  pool: ResourceRow[],
  clock: Clock,
): ReassignCandidate[] {
  return pool
    .filter((t) => checkTarget(db, tenantId, apt, resource, t, clock).length === 0)
    .map((t) => ({ id: t.id, name: t.name }))
}

export function listResourceFutureAppointmentsOp(
  db: ClinicDb,
  caller: ClinicCaller,
  resourceId: string,
  clock: Clock,
): { resource: ResourceRow; appointments: FutureAppointmentForResource[] } {
  const meta = prepare(db, caller, clock)
  const resource = loadResourceOrThrow(db, meta.tenantId, resourceId, clock)
  const pool = listResources(db, meta.tenantId, clock).filter(
    (r) =>
      r.active
      && r.id !== resource.id
      && (resource.kind === 'professional' ? r.kind === 'professional' : isRoomKind(r.kind)),
  )
  const apts = futureAppointmentsOf(db, meta.tenantId, resource, clock.nowMs())
  return {
    resource,
    appointments: apts.map((apt) => {
      const candidates = candidatesFor(db, meta.tenantId, apt, resource, pool, clock)
      return {
        appointmentId: apt.id,
        serviceId: apt.serviceId,
        serviceName: getService(db, meta.tenantId, apt.serviceId)?.name ?? null,
        contactLabel: apt.contactLabel,
        startsAt: apt.startsAt,
        endsAt: apt.endsAt,
        professionalId: apt.professionalId,
        roomResourceId: apt.roomResourceId,
        version: apt.version,
        candidates,
        suggestedResourceId: candidates[0]?.id ?? null,
      }
    }),
  }
}

function reassignOne(
  db: ClinicDb,
  tenantId: string,
  actorId: string,
  resource: ResourceRow,
  apt: AppointmentRow,
  target: ResourceRow,
  clock: Clock,
): void {
  const reasons = checkTarget(db, tenantId, apt, resource, target, clock)
  if (reasons.length > 0) {
    throw new ConflictError(
      'reassign_conflict',
      'O recurso escolhido não está livre ou não atende este serviço neste horário. Nada foi alterado.',
      { appointmentId: apt.id, targetResourceId: target.id, reasons },
    )
  }
  const check = checkSlotAvailability(db, tenantId, slotInputFor(apt, resource, target.id), clock)
  const slot = check.slot!
  const room = slot.roomResourceId ? getResource(db, tenantId, slot.roomResourceId, clock) : null
  const now = clock.nowMs()
  const reason = `Remanejado ao desativar ${resource.name}`
  deleteAllocationsForAppointment(db, tenantId, apt.id)
  db.run(
    `UPDATE appointments SET
      professional_id = ?, room_resource_id = ?, occupies_until = ?,
      change_reason = ?, updated_at = ?, version = version + 1
     WHERE tenant_id = ? AND id = ? AND status = 'confirmed'`,
    slot.professionalId,
    slot.roomResourceId,
    slot.occupiesUntil,
    reason,
    now,
    tenantId,
    apt.id,
  )
  insertAllocations(db, {
    tenantId,
    appointmentId: apt.id,
    professionalId: slot.professionalId,
    roomResourceId: slot.roomResourceId,
    roomKind: room && isRoomKind(room.kind) ? (room.kind as 'room' | 'equipment') : null,
    occupiedFrom: slot.startsAt,
    occupiedUntil: slot.occupiesUntil,
  })
  const after = db.get<Parameters<typeof toAppointment>[0]>(
    `SELECT * FROM appointments WHERE tenant_id = ? AND id = ?`,
    tenantId,
    apt.id,
  )!
  insertAppointmentEvent(db, {
    tenantId,
    appointmentId: apt.id,
    operation: 'rescheduled',
    actorId,
    reason,
    previous: {
      professionalId: apt.professionalId,
      roomResourceId: apt.roomResourceId,
      version: apt.version,
    },
    next: {
      professionalId: after.professional_id,
      roomResourceId: after.room_resource_id,
      version: after.version ?? apt.version + 1,
    },
    occurredAt: now,
  })
  writeOperationalAudit(
    db,
    {
      tenantId,
      actor: actorId,
      action: 'appointment.resource_reassigned',
      objectType: 'appointment',
      objectId: apt.id,
      detail: {
        resourceKind: resource.kind,
        fromResourceId: resource.id,
        toResourceId: target.id,
        startsAt: apt.startsAt,
        patientNotified: false,
      },
    },
    clock,
  )
}

export function deactivateResourceOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: DeactivateResourceInput,
  clock: Clock,
): DeactivateResourceResult {
  const meta = prepare(db, caller, clock)
  const actorId = caller.actorId ?? caller.kind
  const reassignments = input.reassignments ?? []
  const seen = new Set<string>()
  for (const r of reassignments) {
    if (!r || typeof r.appointmentId !== 'string' || typeof r.targetResourceId !== 'string') {
      throw new ValidationError('invalid_reassignment', 'remanejamento inválido')
    }
    if (seen.has(r.appointmentId)) {
      throw new ValidationError('duplicate_reassignment', 'compromisso repetido')
    }
    seen.add(r.appointmentId)
  }
  return db.transactionSync(() => {
    const resource = loadResourceOrThrow(db, meta.tenantId, input.resourceId, clock)
    const future = futureAppointmentsOf(db, meta.tenantId, resource, clock.nowMs())
    const byId = new Map(future.map((a) => [a.id, a]))
    const reassigned: DeactivateResourceResult['reassigned'] = []
    for (const r of reassignments) {
      const apt = byId.get(r.appointmentId)
      if (!apt) {
        throw new ConflictError(
          'appointment_not_on_resource',
          'Um dos compromissos já não está neste recurso. Recarregue a lista. Nada foi alterado.',
          { appointmentId: r.appointmentId },
        )
      }
      if (r.expectedVersion != null && r.expectedVersion !== apt.version) {
        throw new ConflictError(
          'appointment_version_conflict',
          'Um compromisso foi alterado por outra sessão. Recarregue a lista. Nada foi alterado.',
          { appointmentId: apt.id, currentVersion: apt.version },
        )
      }
      const target = loadResourceOrThrow(db, meta.tenantId, r.targetResourceId, clock)
      reassignOne(db, meta.tenantId, actorId, resource, apt, target, clock)
      reassigned.push({ appointmentId: apt.id, fromResourceId: resource.id, toResourceId: target.id })
    }
    db.run(
      `UPDATE resources SET active = 0, updated_at = ? WHERE tenant_id = ? AND id = ?`,
      clock.nowMs(),
      meta.tenantId,
      resource.id,
    )
    const row = getResource(db, meta.tenantId, resource.id, clock)!
    const keptAppointmentIds = future.filter((a) => !seen.has(a.id)).map((a) => a.id)
    const servicesWithoutResource = row.category
      ? servicesLeftWithoutCategoryResource(db, meta.tenantId, row.category, row.id)
      : undefined
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: actorId,
        action: 'config.resource_deactivated',
        objectType: 'resource',
        objectId: row.id,
        detail: {
          active: false,
          reassignedCount: reassigned.length,
          keptCount: keptAppointmentIds.length,
          servicesWithoutResource,
        },
      },
      clock,
    )
    return { ...row, servicesWithoutResource, reassigned, keptAppointmentIds }
  })
}

export function deleteResourceOp(
  db: ClinicDb,
  caller: ClinicCaller,
  resourceId: string,
  clock: Clock,
): { ok: true; id: string } {
  const meta = prepare(db, caller, clock)
  return db.transactionSync(() => {
    const resource = loadResourceOrThrow(db, meta.tenantId, resourceId, clock)
    if (resourceHasHistory(db, meta.tenantId, resource.id)) {
      throw new ConflictError(
        'resource_has_history',
        'Não é possível excluir: este recurso já teve compromissos. Desative-o para manter o histórico.',
        { resourceId: resource.id },
      )
    }
    const t = meta.tenantId
    const required = db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM service_room_requirements
       WHERE tenant_id = ? AND mode IN ('room', 'equipment') AND resource_id = ?`,
      t,
      resource.id,
    )
    if ((required?.n ?? 0) > 0) {
      throw new ConflictError(
        'resource_required_by_service',
        'Não é possível excluir: um serviço exige esta sala ou equipamento. Altere o serviço antes.',
        { resourceId: resource.id },
      )
    }
    db.run(`DELETE FROM weekly_windows WHERE tenant_id = ? AND resource_id = ?`, t, resource.id)
    db.run(`DELETE FROM resource_blocks WHERE tenant_id = ? AND resource_id = ?`, t, resource.id)
    db.run(
      `DELETE FROM service_professionals WHERE tenant_id = ? AND professional_id = ?`,
      t,
      resource.id,
    )
    db.run(`DELETE FROM resources WHERE tenant_id = ? AND id = ?`, t, resource.id)
    writeOperationalAudit(
      db,
      {
        tenantId: t,
        actor: caller.actorId ?? caller.kind,
        action: 'config.resource_deleted',
        objectType: 'resource',
        objectId: resource.id,
        detail: { kind: resource.kind, name: resource.name },
      },
      clock,
    )
    return { ok: true as const, id: resource.id }
  })
}
