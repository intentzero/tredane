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

function eligibleContacts(
  db: ClinicDb,
  tenantId: string,
  protection: LabResetProtection,
  scopeContactId: string | null,
): string[] {
  if (scopeContactId) {
    if (isProtectedContactId(protection, scopeContactId)) return []
    return [scopeContactId]
  }
  return db
    .all<{ id: string }>(`SELECT id FROM contacts WHERE tenant_id = ?`, tenantId)
    .map((r) => r.id)
    .filter((id) => !isProtectedContactId(protection, id))
}

function countAppointments(
  db: ClinicDb,
  tenantId: string,
  contactIds: string[],
  nowMs: number,
): { past: number; future: number } {
  if (contactIds.length === 0) return { past: 0, future: 0 }
  const placeholders = contactIds.map(() => '?').join(', ')
  const past = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM appointments
     WHERE tenant_id = ? AND contact_id IN (${placeholders}) AND starts_at <= ?`,
    tenantId,
    ...contactIds,
    nowMs,
  )
  const future = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM appointments
     WHERE tenant_id = ? AND contact_id IN (${placeholders}) AND starts_at > ?`,
    tenantId,
    ...contactIds,
    nowMs,
  )
  return { past: Number(past?.n ?? 0), future: Number(future?.n ?? 0) }
}

function countForContacts(
  db: ClinicDb,
  table: string,
  tenantId: string,
  contactIds: string[],
): number {
  if (!tableExists(db, table) || contactIds.length === 0) return 0
  const placeholders = contactIds.map(() => '?').join(', ')
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ? AND contact_id IN (${placeholders})`,
    tenantId,
    ...contactIds,
  )
  return Number(row?.n ?? 0)
}

function countSchedulingConversationState(
  db: ClinicDb,
  tenantId: string,
  contactIds: string[],
  protectedConvIds: Set<string>,
): number {
  if (contactIds.length === 0) return 0
  const convPlaceholders = contactIds.map(() => '?').join(', ')
  const convs = db
    .all<{ id: string }>(
      `SELECT id FROM conversations
       WHERE tenant_id = ? AND contact_id IN (${convPlaceholders})`,
      tenantId,
      ...contactIds,
    )
    .map((r) => r.id)
    .filter((id) => !protectedConvIds.has(id))
  if (convs.length === 0) return 0
  const convPh = convs.map(() => '?').join(', ')
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
        const opps = db.all<{ id: string }>(
          `SELECT id FROM opportunities WHERE tenant_id = ? AND contact_id IN (${convPlaceholders})`,
          tenantId,
          ...contactIds,
        )
        for (const o of opps) {
          const h = db.get<{ n: number }>(
            `SELECT COUNT(*) AS n FROM opportunity_stage_history WHERE tenant_id = ? AND opportunity_id = ?`,
            tenantId,
            o.id,
          )
          total += Number(h?.n ?? 0)
        }
      }
      continue
    }
    if (table === 'conversations') {
      total += convs.length
      continue
    }
    const row = db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ? AND conversation_id IN (${convPh})`,
      tenantId,
      ...convs,
    )
    total += Number(row?.n ?? 0)
  }
  return total
}

function countProtectedSkipped(
  db: ClinicDb,
  tenantId: string,
  protection: LabResetProtection,
  scopeContactId: string | null,
  nowMs: number,
): number {
  let total = 0
  const protectedContacts = [...protection.contactIds]
  if (protectedContacts.length === 0) return 0
  const ph = protectedContacts.map(() => '?').join(', ')
  if (scopeContactId && scopeContactId !== protectedContacts[0] && !protection.contactIds.has(scopeContactId)) {
    return 0
  }
  const ap = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ? AND contact_id IN (${ph})`,
    tenantId,
    ...protectedContacts,
  )
  total += Number(ap?.n ?? 0)
  total += countForContacts(db, 'appointment_proposals', tenantId, protectedContacts)
  total += countForContacts(db, 'schedule_holds', tenantId, protectedContacts)
  for (const convId of protection.conversationIds) {
    if (tableExists(db, 'conversations')) {
      const row = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ? AND id = ?`,
        tenantId,
        convId,
      )
      total += Number(row?.n ?? 0)
    }
    for (const table of ['messages', 'booking_sessions', 'schedule_sessions'] as const) {
      if (!tableExists(db, table)) continue
      const row = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ? AND conversation_id = ?`,
        tenantId,
        convId,
      )
      total += Number(row?.n ?? 0)
    }
  }
  void nowMs
  return total
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
  }
  if (tableExists(db, 'appointment_proposals')) {
    db.run(`DELETE FROM appointment_proposals WHERE tenant_id = ? AND contact_id = ?`, tenantId, contactId)
  }

  for (const conversationId of conversationIds) {
    if (tableExists(db, 'attachments')) {
      db.run(`DELETE FROM attachments WHERE tenant_id = ? AND conversation_id = ?`, tenantId, conversationId)
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
  if (tableExists(db, 'scheduling_intents')) {
    db.run(`DELETE FROM scheduling_intents WHERE tenant_id = ? AND contact_id = ?`, tenantId, contactId)
  }

  const apptIds = db
    .all<{ id: string }>(
      `SELECT id FROM appointments WHERE tenant_id = ? AND contact_id = ?`,
      tenantId,
      contactId,
    )
    .map((r) => r.id)
  for (const appointmentId of apptIds) {
    if (tableExists(db, 'appointment_allocations')) {
      db.run(`DELETE FROM appointment_allocations WHERE tenant_id = ? AND appointment_id = ?`, tenantId, appointmentId)
    }
    if (tableExists(db, 'appointment_events')) {
      db.run(`DELETE FROM appointment_events WHERE tenant_id = ? AND appointment_id = ?`, tenantId, appointmentId)
    }
    if (tableExists(db, 'appointment_commands')) {
      db.run(`DELETE FROM appointment_commands WHERE tenant_id = ? AND appointment_id = ?`, tenantId, appointmentId)
    }
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
  if (tableExists(db, 'appointments')) {
    db.run(
      `DELETE FROM appointments WHERE tenant_id = ? AND (contact_id IS NULL OR contact_id = '')`,
      tenantId,
    )
  }
  for (const convId of protection.conversationIds) {
    void convId
  }
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
    assertWaIdFilterAllowed(protection, waIdFilter, scopeContactId)
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
  const protectedSkipped = countProtectedSkipped(db, tenantId, protection, scopeContactId, nowMs)
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