import type { Clock } from '../../db/clock'
import { writeOperationalAudit } from '../audit'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import { assertClinicSchemaReady } from '../migrations'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import {
  clearConversationUnread,
  countInboxFilters,
  createConversation,
  findConversationForContact,
  getConversationWithContact,
  listConversations,
  loadContactSummary,
  requireConversation,
  setConversationAssignee,
  setConversationStatus,
  touchConversationMessage,
} from './conversations'
import { findMessageByExternalId, insertMessage, listMessages } from './messages'
import type {
  AssignConversationInput,
  CloseConversationInput,
  ConversationDetail,
  ConversationListItem,
  ConversationRow,
  InboxCounts,
  ListConversationsInput,
  MarkReadInput,
  MessageRow,
  SendOutboundInput,
} from './types'

export type InboxMutationResult<T> = {
  value: T
  outbox: OutboxRow[]
}

function requireActor(caller: ClinicCaller): string {
  if (!caller.actorId) {
    throw new ValidationError('actor_required', 'Actor obrigatório para esta operação')
  }
  return caller.actorId
}

export function listConversationsOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: ListConversationsInput,
  clock: Clock,
): { items: ConversationListItem[]; nextBefore: number | null; counts: InboxCounts } {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const listed = listConversations(db, meta.tenantId, input)
  const counts = countInboxFilters(db, meta.tenantId, input.viewerClerkUserId)
  return { ...listed, counts }
}

export function getConversationDetailOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: { conversationId: string; messageLimit?: number; before?: number | null },
  clock: Clock,
): ConversationDetail {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const item = getConversationWithContact(db, meta.tenantId, input.conversationId)
  if (!item) {
    throw new NotFoundError('conversation_not_found', 'Conversa não encontrada nesta clínica')
  }
  const page = listMessages(db, meta.tenantId, {
    conversationId: input.conversationId,
    limit: input.messageLimit,
    before: input.before,
  })
  return {
    ...item,
    messages: page.messages,
    messagesHasMore: page.hasMore,
    messagesNextBefore: page.nextBefore,
  }
}

export function getContactDetailOp(
  db: ClinicDb,
  caller: ClinicCaller,
  contactId: string,
  clock: Clock,
): {
  contact: NonNullable<ReturnType<typeof loadContactSummary>>
  conversations: ConversationListItem[]
} {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const contact = loadContactSummary(db, meta.tenantId, contactId)
  if (!contact) {
    throw new NotFoundError('contact_not_found', 'Contacto não encontrado nesta clínica')
  }
  const all = listConversations(db, meta.tenantId, { filter: 'all', limit: 100 })
  const conversations = all.items.filter((c) => c.contactId === contactId)
  return { contact, conversations }
}

/**
 * Assumir / transferir responsável.
 * Atribuição é campo separado do status (states.md).
 * Last-write-wins no DO; assignment_version incrementa sempre.
 */
export function assignConversationOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: AssignConversationInput,
  clock: Clock,
): InboxMutationResult<{
  conversation: ConversationListItem
  systemMessage: MessageRow
  versionMatched: boolean
}> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  requireActor(caller)

  return db.transactionSync(() => {
    const before = requireConversation(db, meta.tenantId, input.conversationId)
    const versionMatched =
      input.expectedAssignmentVersion == null ||
      input.expectedAssignmentVersion === before.assignmentVersion

    const now = clock.nowMs()
    const updated = setConversationAssignee(db, {
      tenantId: meta.tenantId,
      conversationId: input.conversationId,
      assigneeClerkUserId: input.assigneeClerkUserId,
      assigneeDisplayName: input.assigneeDisplayName,
      updatedAt: now,
    })

    let systemBody: string
    if (!input.assigneeClerkUserId) {
      systemBody = `${input.actorDisplayName} removeu o responsável`
    } else if (
      before.assigneeClerkUserId &&
      before.assigneeClerkUserId !== input.assigneeClerkUserId
    ) {
      systemBody = `${input.actorDisplayName} transferiu para ${input.assigneeDisplayName ?? 'membro'}`
    } else if (input.assigneeClerkUserId === input.actorClerkUserId) {
      systemBody = `${input.actorDisplayName} assumiu a conversa`
    } else {
      systemBody = `${input.actorDisplayName} atribuiu a ${input.assigneeDisplayName ?? 'membro'}`
    }

    const systemMessage = insertMessage(
      db,
      {
        tenantId: meta.tenantId,
        conversationId: input.conversationId,
        direction: 'system',
        body: systemBody,
        deliveryState: 'received',
        authorClerkUserId: input.actorClerkUserId,
        authorDisplayName: input.actorDisplayName,
        createdAt: now,
      },
      clock,
    )

    touchConversationMessage(db, {
      tenantId: meta.tenantId,
      conversationId: input.conversationId,
      preview: systemBody,
      direction: 'system',
      at: now,
      bumpUnread: false,
      reopenIfClosed: false,
    })

    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: input.actorClerkUserId,
        action: 'conversation.assigned',
        objectType: 'conversation',
        objectId: input.conversationId,
        detail: {
          from: before.assigneeClerkUserId,
          to: input.assigneeClerkUserId,
          assignmentVersion: updated.assignmentVersion,
          versionMatched,
        },
      },
      clock,
    )

    const outbox = insertOutboxEvent(
      db,
      {
        tenantId: meta.tenantId,
        type: 'conversation.assigned',
        aggregateType: 'conversation',
        aggregateId: input.conversationId,
        idempotencyKey: `conversation.assigned:${input.conversationId}:v${updated.assignmentVersion}`,
        payload: {
          conversationId: input.conversationId,
          assigneeClerkUserId: input.assigneeClerkUserId,
          assigneeDisplayName: input.assigneeDisplayName,
          assignmentVersion: updated.assignmentVersion,
          actorClerkUserId: input.actorClerkUserId,
          systemMessageId: systemMessage.id,
        },
      },
      clock,
    )

    const item = getConversationWithContact(db, meta.tenantId, input.conversationId)!
    return {
      value: { conversation: item, systemMessage, versionMatched },
      outbox: [outbox],
    }
  })
}

export function markConversationReadOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: MarkReadInput,
  clock: Clock,
): InboxMutationResult<ConversationListItem> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  return db.transactionSync(() => {
    const now = clock.nowMs()
    clearConversationUnread(db, meta.tenantId, input.conversationId, now)
    const item = getConversationWithContact(db, meta.tenantId, input.conversationId)!
    const outbox = insertOutboxEvent(
      db,
      {
        tenantId: meta.tenantId,
        type: 'conversation.read',
        aggregateType: 'conversation',
        aggregateId: input.conversationId,
        idempotencyKey: `conversation.read:${input.conversationId}:${now}`,
        payload: {
          conversationId: input.conversationId,
          unreadCount: 0,
        },
      },
      clock,
    )
    return { value: item, outbox: [outbox] }
  })
}

export function closeConversationOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: CloseConversationInput,
  clock: Clock,
): InboxMutationResult<{ conversation: ConversationListItem; systemMessage: MessageRow }> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  return db.transactionSync(() => {
    const now = clock.nowMs()
    setConversationStatus(db, {
      tenantId: meta.tenantId,
      conversationId: input.conversationId,
      status: 'closed',
      updatedAt: now,
    })
    const systemBody = `${input.actorDisplayName} encerrou a conversa`
    const systemMessage = insertMessage(
      db,
      {
        tenantId: meta.tenantId,
        conversationId: input.conversationId,
        direction: 'system',
        body: systemBody,
        deliveryState: 'received',
        authorClerkUserId: input.actorClerkUserId,
        authorDisplayName: input.actorDisplayName,
        createdAt: now,
      },
      clock,
    )
    touchConversationMessage(db, {
      tenantId: meta.tenantId,
      conversationId: input.conversationId,
      preview: systemBody,
      direction: 'system',
      at: now,
      bumpUnread: false,
      reopenIfClosed: false,
    })
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: input.actorClerkUserId,
        action: 'conversation.closed',
        objectType: 'conversation',
        objectId: input.conversationId,
        detail: {},
      },
      clock,
    )
    const outbox = insertOutboxEvent(
      db,
      {
        tenantId: meta.tenantId,
        type: 'conversation.closed',
        aggregateType: 'conversation',
        aggregateId: input.conversationId,
        idempotencyKey: `conversation.closed:${input.conversationId}:${now}`,
        payload: {
          conversationId: input.conversationId,
          systemMessageId: systemMessage.id,
        },
      },
      clock,
    )
    const item = getConversationWithContact(db, meta.tenantId, input.conversationId)!
    return { value: { conversation: item, systemMessage }, outbox: [outbox] }
  })
}

/**
 * Resposta simulada (sem Meta / F3): persiste outbound com delivery_state=accepted.
 * Idempotente por clientRequestId (= external_message_id).
 */
export function sendOutboundMessageOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: SendOutboundInput,
  clock: Clock,
): InboxMutationResult<{ conversation: ConversationListItem; message: MessageRow; duplicate: boolean }> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)

  const body = input.body.trim()
  if (!body) {
    throw new ValidationError('empty_body', 'Mensagem vazia')
  }
  if (body.length > 4000) {
    throw new ValidationError('body_too_long', 'Mensagem demasiado longa')
  }
  if (!input.clientRequestId.trim()) {
    throw new ValidationError('client_request_id_required', 'clientRequestId obrigatório')
  }

  return db.transactionSync(() => {
    requireConversation(db, meta.tenantId, input.conversationId)
    const existing = findMessageByExternalId(db, meta.tenantId, input.clientRequestId)
    if (existing) {
      const item = getConversationWithContact(db, meta.tenantId, input.conversationId)!
      return {
        value: { conversation: item, message: existing, duplicate: true },
        outbox: [],
      }
    }

    const now = clock.nowMs()
    const message = insertMessage(
      db,
      {
        tenantId: meta.tenantId,
        conversationId: input.conversationId,
        direction: 'outbound',
        body,
        externalMessageId: input.clientRequestId,
        deliveryState: 'accepted',
        authorClerkUserId: input.authorClerkUserId,
        authorDisplayName: input.authorDisplayName,
        createdAt: now,
      },
      clock,
    )
    touchConversationMessage(db, {
      tenantId: meta.tenantId,
      conversationId: input.conversationId,
      preview: body,
      direction: 'outbound',
      at: now,
      bumpUnread: false,
      reopenIfClosed: true,
    })
    // Se estava new sem responsável e o autor responde, assume automaticamente.
    const afterTouch = requireConversation(db, meta.tenantId, input.conversationId)
    if (!afterTouch.assigneeClerkUserId) {
      setConversationAssignee(db, {
        tenantId: meta.tenantId,
        conversationId: input.conversationId,
        assigneeClerkUserId: input.authorClerkUserId,
        assigneeDisplayName: input.authorDisplayName,
        updatedAt: now,
      })
    }

    const outbox = insertOutboxEvent(
      db,
      {
        tenantId: meta.tenantId,
        type: 'message.created',
        aggregateType: 'message',
        aggregateId: message.id,
        idempotencyKey: `message.created:${input.clientRequestId}`,
        payload: {
          conversationId: input.conversationId,
          messageId: message.id,
          direction: 'outbound',
          bodyPreview: body.slice(0, 120),
          deliveryState: 'accepted',
        },
      },
      clock,
    )
    const item = getConversationWithContact(db, meta.tenantId, input.conversationId)!
    return { value: { conversation: item, message, duplicate: false }, outbox: [outbox] }
  })
}

/**
 * Garante conversa + mensagem inbound a partir do ingest (chamado dentro da TX do ingest).
 */
export function appendInboundToConversation(
  db: ClinicDb,
  input: {
    tenantId: string
    contactId: string
    providerEventKey: string
    body: string
  },
  clock: Clock,
): { conversation: ConversationRow; message: MessageRow; createdConversation: boolean } {
  assertClinicSchemaReady(db)
  const existingMsg = findMessageByExternalId(db, input.tenantId, input.providerEventKey)
  if (existingMsg) {
    const conv = requireConversation(db, input.tenantId, existingMsg.conversationId)
    return { conversation: conv, message: existingMsg, createdConversation: false }
  }

  let createdConversation = false
  let conversation = findConversationForContact(db, input.tenantId, input.contactId)
  if (!conversation) {
    conversation = createConversation(
      db,
      { tenantId: input.tenantId, contactId: input.contactId, status: 'new' },
      clock,
    )
    createdConversation = true
  }

  const now = clock.nowMs()
  let message: MessageRow
  try {
    message = insertMessage(
      db,
      {
        tenantId: input.tenantId,
        conversationId: conversation.id,
        direction: 'inbound',
        body: input.body,
        externalMessageId: input.providerEventKey,
        deliveryState: 'received',
        createdAt: now,
      },
      clock,
    )
  } catch (err) {
    if (err instanceof ConflictError && err.code === 'message_duplicate') {
      const again = findMessageByExternalId(db, input.tenantId, input.providerEventKey)!
      return {
        conversation: requireConversation(db, input.tenantId, again.conversationId),
        message: again,
        createdConversation: false,
      }
    }
    throw err
  }

  conversation = touchConversationMessage(db, {
    tenantId: input.tenantId,
    conversationId: conversation.id,
    preview: input.body,
    direction: 'inbound',
    at: now,
    bumpUnread: true,
    reopenIfClosed: true,
  })

  return { conversation, message, createdConversation }
}
