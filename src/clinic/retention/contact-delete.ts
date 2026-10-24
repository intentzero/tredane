/**
 * Exclusão de contacto pelo responsável (#43 / REQ-071 / DEC-011).
 * TX SQLite: tombstone + cascata mensagens/anexos meta/conversas/oportunidades;
 * compromissos anonimizados. R2 fora da TX (caller).
 */
import type { Clock } from '../../db/clock'
import { writeOperationalAudit } from '../audit'
import { getContact } from '../contacts'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { NotFoundError, ValidationError } from '../errors'
import { assertClinicSchemaReady } from '../migrations'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import { ANONYMIZED_CONTACT_LABEL, type DeleteContactResult } from './types'
import { findContactTombstoneByWaId, insertContactTombstone } from './tombstones'

export type DeleteContactOpResult = {
  value: DeleteContactResult
  outbox: OutboxRow[]
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

function listMessageIds(db: ClinicDb, tenantId: string, conversationIds: string[]): string[] {
  if (conversationIds.length === 0) return []
  const ids: string[] = []
  for (const conversationId of conversationIds) {
    const rows = db.all<{ id: string }>(
      `SELECT id FROM messages WHERE tenant_id = ? AND conversation_id = ?`,
      tenantId,
      conversationId,
    )
    for (const r of rows) ids.push(r.id)
  }
  return ids
}

function listAttachmentIdsForMessages(
  db: ClinicDb,
  tenantId: string,
  messageIds: string[],
): string[] {
  if (messageIds.length === 0) return []
  const out: string[] = []
  for (const messageId of messageIds) {
    const rows = db.all<{ id: string }>(
      `SELECT id FROM attachments
       WHERE tenant_id = ? AND message_id = ? AND deleted_at IS NULL`,
      tenantId,
      messageId,
    )
    for (const r of rows) out.push(r.id)
  }
  return out
}

/**
 * Exclui contacto e cascata clínica. Não apaga objectos R2 — devolve ids.
 * Auditoria sem wa_id, nome ou corpos de mensagem.
 */
export function deleteContactOp(
  db: ClinicDb,
  caller: ClinicCaller,
  contactId: string,
  clock: Clock,
): DeleteContactOpResult {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)

  return db.transactionSync(() => {
    const contact = getContact(db, meta.tenantId, contactId)
    if (!contact) {
      throw new NotFoundError('contact_not_found', 'Contacto não encontrado nesta clínica')
    }

    const existingTombstone = findContactTombstoneByWaId(db, meta.tenantId, contact.waId)
    if (existingTombstone) {
      throw new ValidationError(
        'contact_already_deleted',
        'Contacto já excluído (tombstone)',
      )
    }

    const conversationIds = listConversationIds(db, meta.tenantId, contactId)
    const messageIds = listMessageIds(db, meta.tenantId, conversationIds)
    const attachmentIds = listAttachmentIdsForMessages(db, meta.tenantId, messageIds)
    const now = clock.nowMs()

    // IA ligada às conversas.
    for (const conversationId of conversationIds) {
      db.run(
        `DELETE FROM ai_suggestions WHERE tenant_id = ? AND conversation_id = ?`,
        meta.tenantId,
        conversationId,
      )
      db.run(
        `DELETE FROM ai_commands WHERE tenant_id = ? AND conversation_id = ?`,
        meta.tenantId,
        conversationId,
      )
    }

    // Anexos: remover metadados (R2 apagado pelo Worker com deletedAttachmentIds).
    for (const conversationId of conversationIds) {
      db.run(
        `DELETE FROM attachments WHERE tenant_id = ? AND conversation_id = ?`,
        meta.tenantId,
        conversationId,
      )
    }
    for (const attachmentId of attachmentIds) {
      db.run(
        `DELETE FROM attachments WHERE tenant_id = ? AND id = ?`,
        meta.tenantId,
        attachmentId,
      )
    }

    // Outbound + mensagens.
    for (const conversationId of conversationIds) {
      db.run(
        `DELETE FROM outbound_messages WHERE tenant_id = ? AND conversation_id = ?`,
        meta.tenantId,
        conversationId,
      )
      db.run(
        `DELETE FROM messages WHERE tenant_id = ? AND conversation_id = ?`,
        meta.tenantId,
        conversationId,
      )
    }

    // Oportunidades do contacto (histórico de etapa primeiro — FK).
    const oppIds = db
      .all<{ id: string }>(
        `SELECT id FROM opportunities WHERE tenant_id = ? AND contact_id = ?`,
        meta.tenantId,
        contactId,
      )
      .map((r) => r.id)
    const deletedOpportunityCount = oppIds.length
    for (const opportunityId of oppIds) {
      db.run(
        `DELETE FROM opportunity_stage_history
         WHERE tenant_id = ? AND opportunity_id = ?`,
        meta.tenantId,
        opportunityId,
      )
    }
    db.run(
      `DELETE FROM opportunities WHERE tenant_id = ? AND contact_id = ?`,
      meta.tenantId,
      contactId,
    )

    // Intents / cobranças: remover ligação PII; manter ids financeiros (Em aberto jurídico).
    db.run(
      `UPDATE scheduling_intents SET contact_id = ? WHERE tenant_id = ? AND contact_id = ?`,
      `deleted:${contactId}`,
      meta.tenantId,
      contactId,
    )
    db.run(
      `UPDATE pix_charges SET contact_id = NULL WHERE tenant_id = ? AND contact_id = ?`,
      meta.tenantId,
      contactId,
    )

    // Compromissos: manter linha, anonimizar (REQ-071).
    const apptCount = db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ? AND contact_id = ?`,
      meta.tenantId,
      contactId,
    )
    const anonymizedAppointmentCount = Number(apptCount?.n ?? 0)
    db.run(
      `UPDATE appointments
       SET contact_id = NULL, contact_label = ?, conversation_id = NULL, opportunity_id = NULL
       WHERE tenant_id = ? AND contact_id = ?`,
      ANONYMIZED_CONTACT_LABEL,
      meta.tenantId,
      contactId,
    )
    // Também anonimizar por rótulo legado se contact_id já era null mas label tinha nome.
    // (não aplicamos fuzzy — só o vínculo contact_id.)

    for (const conversationId of conversationIds) {
      db.run(
        `DELETE FROM conversations WHERE tenant_id = ? AND id = ?`,
        meta.tenantId,
        conversationId,
      )
    }

    insertContactTombstone(
      db,
      {
        tenantId: meta.tenantId,
        waId: contact.waId,
        contactId: contact.id,
        deletedByClerkUserId: caller.actorId ?? null,
      },
      now,
    )

    db.run(
      `DELETE FROM contacts WHERE tenant_id = ? AND id = ?`,
      meta.tenantId,
      contactId,
    )

    const audit = writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: caller.actorId ?? caller.kind,
        action: 'contact.deleted',
        objectType: 'contact',
        objectId: contactId,
        detail: {
          messageCount: messageIds.length,
          attachmentCount: attachmentIds.length,
          conversationCount: conversationIds.length,
          opportunityCount: deletedOpportunityCount,
          anonymizedAppointmentCount,
          // Sem wa_id, displayName ou corpos.
        },
      },
      clock,
    )

    const outbox = insertOutboxEvent(
      db,
      {
        tenantId: meta.tenantId,
        type: 'contact.deleted',
        aggregateType: 'contact',
        aggregateId: contactId,
        payload: {
          contactId,
          messageCount: messageIds.length,
          attachmentCount: attachmentIds.length,
        },
        idempotencyKey: `contact.deleted:${contactId}`,
      },
      clock,
    )

    return {
      value: {
        contactId,
        tombstoneWaId: contact.waId,
        deletedMessageCount: messageIds.length,
        deletedAttachmentIds: attachmentIds,
        anonymizedAppointmentCount,
        deletedConversationCount: conversationIds.length,
        deletedOpportunityCount,
        auditId: audit.id,
        outboxId: outbox.id,
      },
      outbox: [outbox],
    }
  })
}
