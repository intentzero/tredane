import type { Clock } from '../db/clock'
import { writeOperationalAudit } from './audit'
import {
  ContactTombstonedError,
  upsertContact,
  type ContactRow,
} from './contacts'
import type { ClinicCaller } from './envelopes'
import { assertValidCaller } from './envelopes'
import { appendInboundToConversation } from './inbox/operations'
import type { ConversationRow, MessageRow } from './inbox/types'
import { recordInboundEvent, type InboundRow } from './inbound'
import { assertClinicSchemaReady } from './migrations'
import {
  drainOutbox,
  insertOutboxEvent,
  type OutboxPublisher,
  type OutboxRow,
} from './outbox'
import { ensureOpenOpportunity } from './pipeline/operations'
import { findContactTombstoneByWaId } from './retention/tombstones'
import type { ClinicDb } from './store'
import { bindOrAssertTenant } from './tenant'
import { touchWhatsappLastInbound } from './whatsapp/channel'

export type IngestContactMessageInput = {
  providerEventKey: string
  waId: string
  displayName?: string
  body: string
  /** Timestamp do provedor (ms); preserva ordem Meta quando disponível (#32). */
  occurredAtMs?: number
}

type IngestContactMessageBase = {
  duplicate: boolean
  inbound: InboundRow
  conversation: ConversationRow | null
  message: MessageRow | null
  /** Primeiro outbox (contact.upserted); demais em `outboxes`. */
  outbox: OutboxRow | null
  outboxes: OutboxRow[]
  /**
   * Efeitos externos NÃO executados aqui — o chamador deve chamar
   * `publishPendingEffects` depois do commit (ou o DO faz drain pós-RPC).
   */
  externalCallsInsideTransaction: 0
}

/**
 * Resultado da ingestão. `suppressedTombstone` discrimina contacto ausente
 * após exclusão (#43 / REQ-071) vs fluxo normal.
 */
export type IngestContactMessageResult =
  | (IngestContactMessageBase & {
      suppressedTombstone: true
      contact: null
    })
  | (IngestContactMessageBase & {
      suppressedTombstone: false
      contact: ContactRow
    })

/**
 * Primitiva transacional: dedup inbound + contacto + conversa/mensagem + audit + outbox.
 * Proibido HTTP/Queues/R2 dentro de `transactionSync` (ADR-0012).
 */
export function ingestContactMessage(
  db: ClinicDb,
  caller: ClinicCaller,
  input: IngestContactMessageInput,
  clock: Clock,
): IngestContactMessageResult {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)

  return db.transactionSync(() => {
    const tombstone = findContactTombstoneByWaId(db, meta.tenantId, input.waId)

    const inbound = recordInboundEvent(
      db,
      {
        tenantId: meta.tenantId,
        providerEventKey: input.providerEventKey,
        payload: {
          waId: input.waId,
          displayName: input.displayName ?? null,
          // Sem corpo completo no inbound_events para alinhar REQ-070 em dumps;
          // a mensagem lógica guarda o texto na tabela messages.
          bodyPreview: tombstone ? null : input.body.slice(0, 120),
          occurredAtMs: input.occurredAtMs ?? null,
          suppressedTombstone: tombstone ? true : undefined,
        },
      },
      clock,
    )

    if (tombstone) {
      writeOperationalAudit(
        db,
        {
          tenantId: meta.tenantId,
          actor: caller.actorId ?? caller.kind,
          action: 'contact.ingest_suppressed_tombstone',
          objectType: 'contact',
          objectId: tombstone.contactId,
          detail: {
            providerEventKey: input.providerEventKey,
            // Sem wa_id completo / corpo
          },
        },
        clock,
      )
      return {
        duplicate: inbound.duplicate,
        contact: null,
        inbound: inbound.row,
        conversation: null,
        message: null,
        outbox: null,
        outboxes: [],
        suppressedTombstone: true,
        externalCallsInsideTransaction: 0,
      }
    }

    if (inbound.duplicate) {
      let contact: ContactRow
      try {
        contact = upsertContact(
          db,
          { tenantId: meta.tenantId, waId: input.waId, displayName: input.displayName },
          clock,
        )
      } catch (err) {
        if (err instanceof ContactTombstonedError) {
          return {
            duplicate: true,
            contact: null,
            inbound: inbound.row,
            conversation: null,
            message: null,
            outbox: null,
            outboxes: [],
            suppressedTombstone: true,
            externalCallsInsideTransaction: 0,
          }
        }
        throw err
      }
      return {
        duplicate: true,
        contact,
        inbound: inbound.row,
        conversation: null,
        message: null,
        outbox: null,
        outboxes: [],
        suppressedTombstone: false,
        externalCallsInsideTransaction: 0,
      }
    }

    const contact = upsertContact(
      db,
      { tenantId: meta.tenantId, waId: input.waId, displayName: input.displayName },
      clock,
    )

    // Contato bloqueado pela equipe: o evento fica deduplicado, mas não entra
    // mensagem nem conversa no painel (sem corpo no audit).
    const blocked = db.get<{ blocked_at: number | null }>(
      `SELECT blocked_at FROM contacts WHERE tenant_id = ? AND id = ?`,
      meta.tenantId,
      contact.id,
    )
    if (blocked?.blocked_at != null) {
      writeOperationalAudit(
        db,
        {
          tenantId: meta.tenantId,
          actor: caller.actorId ?? caller.kind,
          action: 'contact.ingest_suppressed_blocked',
          objectType: 'contact',
          objectId: contact.id,
          detail: { providerEventKey: input.providerEventKey },
        },
        clock,
      )
      return {
        duplicate: false,
        contact,
        inbound: inbound.row,
        conversation: null,
        message: null,
        outbox: null,
        outboxes: [],
        suppressedTombstone: false,
        externalCallsInsideTransaction: 0,
      }
    }

    const appended = appendInboundToConversation(
      db,
      {
        tenantId: meta.tenantId,
        contactId: contact.id,
        providerEventKey: input.providerEventKey,
        body: input.body,
        occurredAtMs: input.occurredAtMs,
      },
      clock,
    )

    touchWhatsappLastInbound(
      db,
      meta.tenantId,
      input.occurredAtMs ?? clock.nowMs(),
    )

    // AC-04: conversa + oportunidade; VAL-02 hipótese = 1 open / conversa.
    const ensured = ensureOpenOpportunity(
      db,
      {
        tenantId: meta.tenantId,
        contactId: contact.id,
        conversationId: appended.conversation.id,
        assigneeClerkUserId: appended.conversation.assigneeClerkUserId,
        assigneeDisplayName: appended.conversation.assigneeDisplayName,
        lastInteractionAt: appended.message.createdAt,
      },
      clock,
    )

    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: caller.actorId ?? caller.kind,
        action: 'contact.message_ingested',
        objectType: 'contact',
        objectId: contact.id,
        detail: {
          providerEventKey: input.providerEventKey,
          waId: input.waId,
          conversationId: appended.conversation.id,
          messageId: appended.message.id,
          opportunityId: ensured.opportunity.id,
        },
      },
      clock,
    )

    const contactOutbox = insertOutboxEvent(
      db,
      {
        tenantId: meta.tenantId,
        type: 'contact.upserted',
        aggregateType: 'contact',
        aggregateId: contact.id,
        idempotencyKey: `contact.upserted:${input.providerEventKey}`,
        payload: {
          contactId: contact.id,
          waId: contact.waId,
          providerEventKey: input.providerEventKey,
          bodyPreview: input.body.slice(0, 120),
          conversationId: appended.conversation.id,
          opportunityId: ensured.opportunity.id,
        },
      },
      clock,
    )

    const messageOutbox = insertOutboxEvent(
      db,
      {
        tenantId: meta.tenantId,
        type: 'message.created',
        aggregateType: 'message',
        aggregateId: appended.message.id,
        idempotencyKey: `message.created:${input.providerEventKey}`,
        payload: {
          conversationId: appended.conversation.id,
          messageId: appended.message.id,
          contactId: contact.id,
          opportunityId: ensured.opportunity.id,
          direction: 'inbound',
          bodyPreview: input.body.slice(0, 120),
          deliveryState: 'received',
        },
      },
      clock,
    )

    const conversationOutbox = appended.createdConversation
      ? insertOutboxEvent(
          db,
          {
            tenantId: meta.tenantId,
            type: 'conversation.created',
            aggregateType: 'conversation',
            aggregateId: appended.conversation.id,
            idempotencyKey: `conversation.created:${appended.conversation.id}`,
            payload: {
              conversationId: appended.conversation.id,
              contactId: contact.id,
              opportunityId: ensured.opportunity.id,
              status: appended.conversation.status,
            },
          },
          clock,
        )
      : insertOutboxEvent(
          db,
          {
            tenantId: meta.tenantId,
            type: 'conversation.updated',
            aggregateType: 'conversation',
            aggregateId: appended.conversation.id,
            idempotencyKey: `conversation.updated:${input.providerEventKey}`,
            payload: {
              conversationId: appended.conversation.id,
              contactId: contact.id,
              opportunityId: ensured.opportunity.id,
              status: appended.conversation.status,
              unreadCount: appended.conversation.unreadCount,
              lastMessagePreview: appended.conversation.lastMessagePreview,
            },
          },
          clock,
        )

    const outboxes = [
      contactOutbox,
      messageOutbox,
      conversationOutbox,
      ...ensured.outbox,
    ]
    return {
      duplicate: false,
      contact,
      inbound: inbound.row,
      conversation: appended.conversation,
      message: appended.message,
      outbox: contactOutbox,
      outboxes,
      suppressedTombstone: false,
      externalCallsInsideTransaction: 0,
    }
  })
}

/**
 * Publicação pós-commit / recuperação após crash entre commit e publish.
 * Reprocessa outbox pending sem duplicar entidades de domínio.
 */
export async function publishPendingEffects(
  db: ClinicDb,
  caller: ClinicCaller,
  publisher: OutboxPublisher,
  clock: Clock,
): Promise<{ published: string[]; failed: string[] }> {
  assertClinicSchemaReady(db)
  const meta = bindOrAssertTenant(db, caller, clock)
  return drainOutbox(db, meta.tenantId, publisher, clock)
}
