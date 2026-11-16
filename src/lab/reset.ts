/**
 * `lab_reset` — cancela marcações futuras e propostas/holds pendentes na clínica demo.
 *
 * Escolha de persistência (soft-cancel, sem DELETE):
 * - `appointments`: `status = 'cancelled'` (histórico mantido).
 * - `appointment_proposals` em estados abertos: `state = 'expirada'`.
 * - `schedule_holds` ativos com janela futura: `status = 'cancelled'`.
 *
 * Conversas, mensagens e marcações passadas não são alteradas.
 */
import { writeOperationalAudit } from '../clinic/audit'
import { APPOINTMENT_PROPOSAL_OPEN_STATES } from '../clinic/constants'
import type { ClinicCaller } from '../clinic/envelopes'
import { assertValidCaller } from '../clinic/envelopes'
import { assertClinicSchemaReady } from '../clinic/migrations'
import type { ClinicDb } from '../clinic/store'
import { bindOrAssertTenant } from '../clinic/tenant'
import { deleteAllocationsForAppointment } from '../clinic/scheduling/allocations'
import type { Clock } from '../db/clock'

export type LabResetInput = {
  dryRun?: boolean
  waId?: string
}

export type LabResetItem = {
  id: string
  kind: 'appointment' | 'proposal' | 'hold'
  startsAt?: number
  endsAt?: number
  statusOrState?: string
  contactId?: string
}

export type LabResetResult = {
  dryRun: boolean
  tenantId: string
  waIdFilter: string | null
  nowMs: number
  counts: {
    appointments: number
    proposals: number
    holds: number
    total: number
  }
  items: LabResetItem[]
  applied?: {
    appointmentsCancelled: number
    proposalsExpired: number
    holdsCancelled: number
  }
  auditId?: string
}

function openProposalPlaceholders(): string {
  return APPOINTMENT_PROPOSAL_OPEN_STATES.map(() => '?').join(', ')
}

function contactIdForWa(db: ClinicDb, tenantId: string, waId: string): string | null {
  const row = db.get<{ id: string }>(
    `SELECT id FROM contacts WHERE tenant_id = ? AND wa_id = ?`,
    tenantId,
    waId,
  )
  return row?.id ?? null
}

function selectFutureAppointments(
  db: ClinicDb,
  tenantId: string,
  nowMs: number,
  contactId: string | null,
): LabResetItem[] {
  const params: Array<string | number> = [tenantId, nowMs]
  let contactSql = ''
  if (contactId) {
    contactSql = ' AND contact_id = ?'
    params.push(contactId)
  }
  return db
    .all<{
      id: string
      starts_at: number
      ends_at: number
      status: string
      contact_id: string | null
    }>(
      `SELECT id, starts_at, ends_at, status, contact_id
       FROM appointments
       WHERE tenant_id = ? AND status = 'confirmed' AND starts_at > ?${contactSql}
       ORDER BY starts_at, id`,
      ...params,
    )
    .map((r) => ({
      id: r.id,
      kind: 'appointment' as const,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      statusOrState: r.status,
      contactId: r.contact_id ?? undefined,
    }))
}

function selectOpenProposals(
  db: ClinicDb,
  tenantId: string,
  contactId: string | null,
): LabResetItem[] {
  const params: Array<string | number> = [tenantId, ...APPOINTMENT_PROPOSAL_OPEN_STATES]
  let contactSql = ''
  if (contactId) {
    contactSql = ' AND contact_id = ?'
    params.push(contactId)
  }
  return db
    .all<{
      id: string
      starts_at: number
      ends_at: number
      state: string
      contact_id: string
    }>(
      `SELECT id, starts_at, ends_at, state, contact_id
       FROM appointment_proposals
       WHERE tenant_id = ? AND state IN (${openProposalPlaceholders()})${contactSql}
       ORDER BY created_at DESC, id`,
      ...params,
    )
    .map((r) => ({
      id: r.id,
      kind: 'proposal' as const,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      statusOrState: r.state,
      contactId: r.contact_id,
    }))
}

function selectActiveFutureHolds(
  db: ClinicDb,
  tenantId: string,
  nowMs: number,
  contactId: string | null,
): LabResetItem[] {
  const params: Array<string | number> = [tenantId, nowMs]
  let contactSql = ''
  if (contactId) {
    contactSql = ' AND contact_id = ?'
    params.push(contactId)
  }
  return db
    .all<{
      id: string
      window_starts_at: number
      window_ends_at: number
      status: string
      contact_id: string
    }>(
      `SELECT id, window_starts_at, window_ends_at, status, contact_id
       FROM schedule_holds
       WHERE tenant_id = ? AND status = 'active' AND window_ends_at > ?${contactSql}
       ORDER BY window_starts_at, id`,
      ...params,
    )
    .map((r) => ({
      id: r.id,
      kind: 'hold' as const,
      startsAt: r.window_starts_at,
      endsAt: r.window_ends_at,
      statusOrState: r.status,
      contactId: r.contact_id,
    }))
}

export function labResetAgenda(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  input: LabResetInput,
): LabResetResult {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const tenantId = meta.tenantId
  const dryRun = input.dryRun !== false
  const nowMs = clock.nowMs()
  const waIdFilter = typeof input.waId === 'string' && input.waId.length > 0 ? input.waId : null
  const contactId = waIdFilter ? contactIdForWa(db, tenantId, waIdFilter) : null
  if (waIdFilter && !contactId) {
    return {
      dryRun,
      tenantId,
      waIdFilter,
      nowMs,
      counts: { appointments: 0, proposals: 0, holds: 0, total: 0 },
      items: [],
      applied: dryRun
        ? undefined
        : { appointmentsCancelled: 0, proposalsExpired: 0, holdsCancelled: 0 },
    }
  }

  const appointments = selectFutureAppointments(db, tenantId, nowMs, contactId)
  const proposals = selectOpenProposals(db, tenantId, contactId)
  const holds = selectActiveFutureHolds(db, tenantId, nowMs, contactId)
  const items = [...appointments, ...proposals, ...holds]
  const counts = {
    appointments: appointments.length,
    proposals: proposals.length,
    holds: holds.length,
    total: items.length,
  }

  if (dryRun) {
    return { dryRun: true, tenantId, waIdFilter, nowMs, counts, items }
  }

  const actor = caller.actorId ?? caller.kind
  const reason = 'lab_reset'

  return db.transactionSync(() => {
    let appointmentsCancelled = 0
    let proposalsExpired = 0
    let holdsCancelled = 0

    for (const apt of appointments) {
      db.run(
        `UPDATE appointments SET
          status = 'cancelled',
          change_reason = ?,
          cancelled_by = ?,
          cancelled_at = ?,
          updated_at = ?
         WHERE tenant_id = ? AND id = ? AND status = 'confirmed'`,
        reason,
        actor,
        nowMs,
        nowMs,
        tenantId,
        apt.id,
      )
      deleteAllocationsForAppointment(db, tenantId, apt.id)
      appointmentsCancelled += 1
    }

    if (proposals.length > 0) {
      const ids = proposals.map((p) => p.id)
      const idPlaceholders = ids.map(() => '?').join(', ')
      db.run(
        `UPDATE appointment_proposals
         SET state = 'expirada', updated_at = ?
         WHERE tenant_id = ? AND id IN (${idPlaceholders})
           AND state IN (${openProposalPlaceholders()})`,
        nowMs,
        tenantId,
        ...ids,
        ...APPOINTMENT_PROPOSAL_OPEN_STATES,
      )
      proposalsExpired = ids.length
    }

    for (const hold of holds) {
      db.run(
        `UPDATE schedule_holds
         SET status = 'cancelled', cancelled_at = ?, updated_at = ?
         WHERE tenant_id = ? AND id = ? AND status = 'active'`,
        nowMs,
        nowMs,
        tenantId,
        hold.id,
      )
      holdsCancelled += 1
    }

    const audit = writeOperationalAudit(
      db,
      {
        tenantId,
        actor,
        action: 'lab.agenda_reset',
        objectType: 'clinic',
        objectId: tenantId,
        detail: {
          dryRun: false,
          waIdFilter,
          counts,
          applied: { appointmentsCancelled, proposalsExpired, holdsCancelled },
        },
      },
      clock,
    )

    return {
      dryRun: false,
      tenantId,
      waIdFilter,
      nowMs,
      counts,
      items,
      applied: { appointmentsCancelled, proposalsExpired, holdsCancelled },
      auditId: audit.id,
    }
  })
}