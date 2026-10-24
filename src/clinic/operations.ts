import type { Clock } from '../db/clock'
import { writeOperationalAudit } from './audit'
import { upsertContact, type ContactRow } from './contacts'
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
import type { ClinicDb } from './store'
import { bindOrAssertTenant } from './tenant'

export type IngestContactMessageInput = {
  providerEventKey: string
  waId: string
  displayName?: string
  body: string
}

export type IngestContactMessageResult = {
  duplicate: boolean
  contact: ContactRow
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
    const inbound = recordInboundEvent(
      db,
      {
        tenantId: meta.tenantId,
        providerEventKey: input.providerEventKey,
        payload: {
          waId: input.waId,
          displayName: input.displayName ?? null,
          body: input.body,
        },
      },
      clock,
    )

    if (inbound.duplicate) {
      const contact = upsertContact(
        db,
        { tenantId: meta.tenantId, waId: input.waId, displayName: input.displayName },
        clock,
      )
      return {
        duplicate: true,
        contact,
        inbound: inbound.row,
        conversation: null,
        message: null,
        outbox: null,
        outboxes: [],
        externalCallsInsideTransaction: 0,
      }
    }

    const contact = upsertContact(
      db,
      { tenantId: meta.tenantId, waId: input.waId, displayName: input.displayName },
      clock,
    )

    const appended = appendInboundToConversation(
      db,
      {
        tenantId: meta.tenantId,
        contactId: contact.id,
        providerEventKey: input.providerEventKey,
        body: input.body,
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
              status: appended.conversation.status,
              unreadCount: appended.conversation.unreadCount,
              lastMessagePreview: appended.conversation.lastMessagePreview,
            },
          },
          clock,
        )

    const outboxes = [contactOutbox, messageOutbox, conversationOutbox]
    return {
      duplicate: false,
      contact,
      inbound: inbound.row,
      conversation: appended.conversation,
      message: appended.message,
      outbox: contactOutbox,
      outboxes,
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
