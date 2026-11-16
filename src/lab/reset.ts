/**
 * `lab_reset` — hard reset da agenda e estado conversacional no Clinic DO (staging).
 * Não toca D1, configuração da clínica, Pix nem canais WhatsApp.
 */
import { writeOperationalAudit } from '../clinic/audit'
import type { ClinicCaller } from '../clinic/envelopes'
import { assertValidCaller } from '../clinic/envelopes'
import { assertClinicSchemaReady } from '../clinic/migrations'
import type { ClinicDb } from '../clinic/store'
import { bindOrAssertTenant } from '../clinic/tenant'
import type { Clock } from '../db/clock'
import {
  assertWaIdFilterAllowed,
  enrichProtectionFromDb,
  isProtectedContactId,
  isProtectedConversationId,
  LabResetProtectionError,
  resolveLabResetProtection,
  type LabResetProtection,
  type LabResetProtectionEnv,
} from './reset-protected'
import {
  countInList,
  LAB_RESET_IN_CHUNK_SIZE,
  selectIdsInList,
} from './reset-sql'

export { LAB_RESET_IN_CHUNK_SIZE }

export type LabResetInput = {
  dryRun?: boolean
  waId?: string
  protectionEnv?: LabResetProtectionEnv
}

export type LabResetDeletedCounts = {
  appointmentsPast: number
  appointmentsFuture: number
  proposals: number
  holds: number
  schedulingConversation: number
}

export type LabResetResult = {
  dryRun: boolean
  tenantId: string
  waIdFilter: string | null
  nowMs: number
  deleted: LabResetDeletedCounts
  protectedSkipped: number
  totalWouldDelete: number
  auditId?: string
}

function tableExists(db: ClinicDb, name: string): boolean {
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`,
    name,
  )
  return Number(row?.n ?? 0) > 0
}

function contactIdForWa(db: ClinicDb, tenantId: string, waId: string): string | null {
  const row = db.get<{ id: string }>(
    `SELECT id FROM contacts WHERE tenant_id = ? AND wa_id = ?`,
    tenantId,
    waId,
  )
  return row?.id ?? null
}

function listConversationIds(db: ClinicDb, tenantId: string, contactId: string): string[] {
  return db
    .all<{ id: string }>(
      `SELECT id FROM conversations WHERE tenant_id = ? AND contact_id = ?`,
      tenantId,
      contactId,
    )
    .map((r) => r.id)
}

function contactHasProtectedConversation(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
  protection: LabResetProtection,
): boolean {
  return listConversationIds(db, tenantId, contactId).some((id) =>
    isProtectedConversationId(protection, id),
  )
}

function isContactFullyProtected(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
  protection: LabResetProtection,
): boolean {
  return (
    isProtectedContactId(protection, contactId)
    || contactHasProtectedConversation(db, tenantId, contactId, protection)
  )
}

function eligibleContacts(
  db: ClinicDb,
  tenantId: string,
  protection: LabResetProtection,
  scopeContactId: string | null,
): string[] {
  if (scopeContactId) {
    if (isContactFullyProtected(db, tenantId, scopeContactId, protection)) return []
    return [scopeContactId]
  }
  return db
    .all<{ id: string }>(`SELECT id FROM contacts WHERE tenant_id = ?`, tenantId)
    .map((r) => r.id)
    .filter((id) => !isContactFullyProtected(db, tenantId, id, protection))
}

function countAppointments(
  db: ClinicDb,
  tenantId: string,
  contactIds: string[],
  nowMs: number,
): { past: number; future: number } {
  if (!tableExists(db, 'appointments') || contactIds.length === 0) return { past: 0, future: 0 }
  return {
    past: countInList(db, 'appointments', tenantId, 'contact_id', contactIds, ' AND starts_at <= ?', [nowMs]),
    future: countInList(db, 'appointments', tenantId, 'contact_id', contactIds, ' AND starts_at > ?', [nowMs]),
  }
}

function countForContacts(
  db: ClinicDb,
  table: string,
  tenantId: string,
  contactIds: string[],
): number {
  if (!tableExists(db, table) || contactIds.length === 0) return 0
  return countInList(db, table, tenantId, 'contact_id', contactIds)
}

function countSchedulingConversationState(
  db: ClinicDb,
  tenantId: string,
  contactIds: string[],
  protectedConvIds: Set<string>,
): number {
  if (contactIds.length === 0) return 0
  const convs = selectIdsInList(db, 'conversations', tenantId, 'contact_id', contactIds).filter(
    (id) => !protectedConvIds.has(id),
  )
  if (convs.length === 0) return 0
  let total = 0
  for (const table of [
    'messages',
    'outbound_messages',
    'attachments',
    'ai_autodraft_jobs',
    'ai_suggestions',
    'ai_commands',
    'llm_jobs',
    'booking_sessions',
    'schedule_sessions',
    'opportunities',
    'scheduling_intents',
    'conversations',
  ] as const) {
    if (!tableExists(db, table)) continue
    if (table === 'opportunities' || table === 'scheduling_intents') {
      total += countForContacts(db, table, tenantId, contactIds)
      if (table === 'opportunities' && tableExists(db, 'opportunity_stage_history')) {
        const oppIds = selectIdsInList(db, 'opportunities', tenantId, 'contact_id', contactIds)
        total += countInList(db, 'opportunity_stage_history', tenantId, 'opportunity_id', oppIds)
      }
      continue
    }
    if (table === 'conversations') {
      total += convs.length
      continue
    }
    total += countInList(db, table, tenantId, 'conversation_id', convs)
  }
  return total
}

function listFullyProtectedContactIds(
  db: ClinicDb,
  tenantId: string,
  protection: LabResetProtection,
): string[] {
  return db
    .all<{ id: string }>(`SELECT id FROM contacts WHERE tenant_id = ?`, tenantId)
    .map((r) => r.id)
    .filter((id) => isContactFullyProtected(db, tenantId, id, protection))
}

function countProtectedSkipped(
  db: ClinicDb,
  tenantId: string,
  protection: LabResetProtection,
  scopeContactId: string | null,
): number {
  const protectedContacts = listFullyProtectedContactIds(db, tenantId, protection)
  if (protectedContacts.length === 0) return 0
  if (
    scopeContactId
    && !protectedContacts.includes(scopeContactId)
    && !isContactFullyProtected(db, tenantId, scopeContactId, protection)
  ) {
    return 0
  }
  let total = 0
  total += countInList(db, 'appointments', tenantId, 'contact_id', protectedContacts)
  total += countForContacts(db, 'appointment_proposals', tenantId, protectedContacts)
  total += countForContacts(db, 'schedule_holds', tenantId, protectedContacts)
  total += countSchedulingConversationState(db, tenantId, protectedContacts, new Set())
  return total
}

function deleteVisitSnapshots(db: ClinicDb, tenantId: string, ownerKind: string, ownerId: string): void {
  if (tableExists(db, 'visit_zone_snapshots')) {
    db.run(
      `DELETE FROM visit_zone_snapshots WHERE tenant_id = ? AND owner_kind = ? AND owner_id = ?`,
      tenantId,
      ownerKind,
      ownerId,
    )
  }
  if (tableExists(db, 'visit_combo_snapshots')) {
    db.run(
      `DELETE FROM visit_combo_snapshots WHERE tenant_id = ? AND owner_kind = ? AND owner_id = ?`,
      tenantId,
      ownerKind,
      ownerId,
    )
  }
}

function deleteAppointmentChildren(db: ClinicDb, tenantId: string, appointmentId: string): void {
  deleteVisitSnapshots(db, tenantId, 'appointment', appointmentId)
  if (tableExists(db, 'appointment_allocations')) {
    db.run(
      `DELETE FROM appointment_allocations WHERE tenant_id = ? AND appointment_id = ?`,
      tenantId,
      appointmentId,
    )
  }
  if (tableExists(db, 'appointment_events')) {
    db.run(`DELETE FROM appointment_events WHERE tenant_id = ? AND appointment_id = ?`, tenantId, appointmentId)
  }
  if (tableExists(db, 'appointment_commands')) {
    db.run(`DELETE FROM appointment_commands WHERE tenant_id = ? AND appointment_id = ?`, tenantId, appointmentId)
  }
}

function purgeContact(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
  protection: LabResetProtection,
): void {
  const conversationIds = listConversationIds(db, tenantId, contactId).filter(
    (id) => !isProtectedConversationId(protection, id),
  )

  for (const conversationId of conversationIds) {
    for (const table of ['llm_jobs', 'ai_autodraft_jobs', 'ai_suggestions', 'ai_commands'] as const) {
      if (tableExists(db, table)) {
        db.run(`DELETE FROM ${table} WHERE tenant_id = ? AND conversation_id = ?`, tenantId, conversationId)
      }
    }
  }

  if (tableExists(db, 'pending_communications')) {
    db.run(`DELETE FROM pending_communications WHERE tenant_id = ? AND contact_id = ?`, tenantId, contactId)
    for (const conversationId of conversationIds) {
      db.run(
        `DELETE FROM pending_communications WHERE tenant_id = ? AND conversation_id = ?`,
        tenantId,
        conversationId,
      )
    }
  }

  const proposalIds = tableExists(db, 'appointment_proposals')
    ? db
        .all<{ id: string }>(
          `SELECT id FROM appointment_proposals WHERE tenant_id = ? AND contact_id = ?`,
          tenantId,
          contactId,
        )
        .map((r) => r.id)
    : []
  for (const proposalId of proposalIds) {
    deleteVisitSnapshots(db, tenantId, 'proposal', proposalId)
  }
  if (tableExists(db, 'appointment_proposals')) {
    db.run(`DELETE FROM appointment_proposals WHERE tenant_id = ? AND contact_id = ?`, tenantId, contactId)
  }

  if (tableExists(db, 'scheduling_intents')) {
    db.run(`DELETE FROM scheduling_intents WHERE tenant_id = ? AND contact_id = ?`, tenantId, contactId)
  }

  for (const conversationId of conversationIds) {
    const messageIds = db
      .all<{ id: string }>(
        `SELECT id FROM messages WHERE tenant_id = ? AND conversation_id = ?`,
        tenantId,
        conversationId,
      )
      .map((r) => r.id)
    if (tableExists(db, 'attachments')) {
      db.run(`DELETE FROM attachments WHERE tenant_id = ? AND conversation_id = ?`, tenantId, conversationId)
      for (const messageId of messageIds) {
        db.run(`DELETE FROM attachments WHERE tenant_id = ? AND message_id = ?`, tenantId, messageId)
      }
    }
    if (tableExists(db, 'outbound_messages')) {
      db.run(`DELETE FROM outbound_messages WHERE tenant_id = ? AND conversation_id = ?`, tenantId, conversationId)
    }
    if (tableExists(db, 'messages')) {
      db.run(`DELETE FROM messages WHERE tenant_id = ? AND conversation_id = ?`, tenantId, conversationId)
    }
  }

  const oppIds = db
    .all<{ id: string }>(
      `SELECT id FROM opportunities WHERE tenant_id = ? AND contact_id = ?`,
      tenantId,
      contactId,
    )
    .map((r) => r.id)
  for (const opportunityId of oppIds) {
    if (tableExists(db, 'opportunity_stage_history')) {
      db.run(
        `DELETE FROM opportunity_stage_history WHERE tenant_id = ? AND opportunity_id = ?`,
        tenantId,
        opportunityId,
      )
    }
  }
  if (tableExists(db, 'schedule_holds')) {
    db.run(`DELETE FROM schedule_holds WHERE tenant_id = ? AND contact_id = ?`, tenantId, contactId)
  }
  if (tableExists(db, 'opportunities')) {
    db.run(`DELETE FROM opportunities WHERE tenant_id = ? AND contact_id = ?`, tenantId, contactId)
  }

  const apptIds = db
    .all<{ id: string }>(
      `SELECT id FROM appointments WHERE tenant_id = ? AND contact_id = ?`,
      tenantId,
      contactId,
    )
    .map((r) => r.id)
  for (const appointmentId of apptIds) {
    deleteAppointmentChildren(db, tenantId, appointmentId)
  }
  if (tableExists(db, 'appointments')) {
    db.run(`DELETE FROM appointments WHERE tenant_id = ? AND contact_id = ?`, tenantId, contactId)
  }

  for (const conversationId of conversationIds) {
    if (tableExists(db, 'booking_sessions')) {
      db.run(`DELETE FROM booking_sessions WHERE tenant_id = ? AND conversation_id = ?`, tenantId, conversationId)
    }
    if (tableExists(db, 'schedule_sessions')) {
      db.run(`DELETE FROM schedule_sessions WHERE tenant_id = ? AND conversation_id = ?`, tenantId, conversationId)
    }
    if (tableExists(db, 'conversations')) {
      db.run(`DELETE FROM conversations WHERE tenant_id = ? AND id = ?`, tenantId, conversationId)
    }
  }

  if (tableExists(db, 'contacts')) {
    db.run(`DELETE FROM contacts WHERE tenant_id = ? AND id = ?`, tenantId, contactId)
  }
}

function purgeOrphanTenantRows(db: ClinicDb, tenantId: string, protection: LabResetProtection): void {
  for (const convId of protection.conversationIds) {
    void convId
  }
  if (!tableExists(db, 'appointments')) return
  const orphanIds = db
    .all<{ id: string }>(
      `SELECT id FROM appointments
       WHERE tenant_id = ? AND (contact_id IS NULL OR contact_id = '')`,
      tenantId,
    )
    .map((r) => r.id)
  for (const appointmentId of orphanIds) {
    deleteAppointmentChildren(db, tenantId, appointmentId)
  }
  db.run(
    `DELETE FROM appointments WHERE tenant_id = ? AND (contact_id IS NULL OR contact_id = '')`,
    tenantId,
  )
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

  const baseProtection = resolveLabResetProtection(tenantId, input.protectionEnv)
  if (baseProtection === null) {
    throw new LabResetProtectionError('Não foi possível avaliar a lista de proteção; reset abortado (fail-closed).')
  }
  const protection = enrichProtectionFromDb(db, tenantId, baseProtection)
  if (protection === null) {
    throw new LabResetProtectionError('Não foi possível avaliar a lista de proteção; reset abortado (fail-closed).')
  }

  const scopeContactId = waIdFilter ? contactIdForWa(db, tenantId, waIdFilter) : null
  if (waIdFilter) {
    assertWaIdFilterAllowed(protection, waIdFilter, scopeContactId, {
      contactHasProtectedConversation: scopeContactId
        ? contactHasProtectedConversation(db, tenantId, scopeContactId, protection)
        : false,
    })
    if (!scopeContactId) {
      const empty: LabResetDeletedCounts = {
        appointmentsPast: 0,
        appointmentsFuture: 0,
        proposals: 0,
        holds: 0,
        schedulingConversation: 0,
      }
      const audit = recordAudit(db, caller, clock, tenantId, {
        dryRun,
        waIdFilter,
        deleted: empty,
        protectedSkipped: 0,
        nowMs,
      })
      return {
        dryRun,
        tenantId,
        waIdFilter,
        nowMs,
        deleted: empty,
        protectedSkipped: 0,
        totalWouldDelete: 0,
        auditId: audit?.id,
      }
    }
  }

  const contactIds = eligibleContacts(db, tenantId, protection, scopeContactId)
  const apptCounts = countAppointments(db, tenantId, contactIds, nowMs)
  const deleted: LabResetDeletedCounts = {
    appointmentsPast: apptCounts.past,
    appointmentsFuture: apptCounts.future,
    proposals: countForContacts(db, 'appointment_proposals', tenantId, contactIds),
    holds: countForContacts(db, 'schedule_holds', tenantId, contactIds),
    schedulingConversation: countSchedulingConversationState(db, tenantId, contactIds, protection.conversationIds),
  }
  const protectedSkipped = countProtectedSkipped(db, tenantId, protection, scopeContactId)
  const totalWouldDelete =
    deleted.appointmentsPast +
    deleted.appointmentsFuture +
    deleted.proposals +
    deleted.holds +
    deleted.schedulingConversation

  if (dryRun) {
    const audit = recordAudit(db, caller, clock, tenantId, {
      dryRun: true,
      waIdFilter,
      deleted,
      protectedSkipped,
      nowMs,
    })
    return {
      dryRun: true,
      tenantId,
      waIdFilter,
      nowMs,
      deleted,
      protectedSkipped,
      totalWouldDelete,
      auditId: audit?.id,
    }
  }

  db.transactionSync(() => {
    for (const contactId of contactIds) {
      purgeContact(db, tenantId, contactId, protection)
    }
    purgeOrphanTenantRows(db, tenantId, protection)
  })

  const audit = recordAudit(db, caller, clock, tenantId, {
    dryRun: false,
    waIdFilter,
    deleted,
    protectedSkipped,
    nowMs,
  })

  return {
    dryRun: false,
    tenantId,
    waIdFilter,
    nowMs,
    deleted,
    protectedSkipped,
    totalWouldDelete,
    auditId: audit?.id,
  }
}

function recordAudit(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  tenantId: string,
  detail: {
    dryRun: boolean
    waIdFilter: string | null
    deleted: LabResetDeletedCounts
    protectedSkipped: number
    nowMs: number
  },
) {
  const actor = caller.actorId ?? caller.kind
  return writeOperationalAudit(
    db,
    {
      tenantId,
      actor,
      action: 'lab.agenda_hard_reset',
      objectType: 'clinic',
      objectId: tenantId,
      detail: {
        dryRun: detail.dryRun,
        waIdFilter: detail.waIdFilter,
        deleted: detail.deleted,
        protectedSkipped: detail.protectedSkipped,
        timestamp: detail.nowMs,
      },
    },
    clock,
  )
}