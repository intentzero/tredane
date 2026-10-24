import type { Clock } from '../../db/clock'
import { writeOperationalAudit } from '../audit'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import { recordInboundEvent } from '../inbound'
import { assertClinicSchemaReady } from '../migrations'
import {
  acknowledgeOutboxResult,
  insertOutboxEvent,
  type OutboxRow,
} from '../outbox'
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
import { listAttachmentsForMessage } from '../attachments'
import {
  applyOutboundDeliveryUpdate,
  findOutboundByClientRequestId,
  findOutboundByProviderMessageId,
  insertOutboundMessage,
  mapMetaStatusToDelivery,
  setOutboundOutboxEventId,
  type OutboundMessageRow,
} from './outbound'
import { validateTemplateSend } from './templates'
import { messagingWindowForConversation } from './window'
import { getWhatsappChannel } from '../whatsapp/channel'
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
  const messagingWindow = messagingWindowForConversation(
    db,
    meta.tenantId,
    input.conversationId,
    clock.nowMs(),
  )
  const messages = page.messages.map((m) => {
    const atts = listAttachmentsForMessage(db, meta.tenantId, m.id)
    if (atts.length === 0) return m
    return {
      ...m,
      attachments: atts.map((a) => ({
        id: a.id,
        contentType: a.contentType,
        byteSize: a.byteSize,
        filename: a.filename,
        status: a.status,
        failureCode: a.failureCode,
        includedInAiContext: false as const,
      })),
    }
  })
  return {
    ...item,
    messages,
    messagesHasMore: page.hasMore,
    messagesNextBefore: page.nextBefore,
    messagingWindow,
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
 * Envio humano (#33): intenção persistente + outbox `whatsapp.send`.
 * Idempotente por clientRequestId (outbound_messages). Janela 24 h no backend.
 * Não toca appointments (REQ-033).
 */
export function sendOutboundMessageOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: SendOutboundInput,
  clock: Clock,
): InboxMutationResult<{
  conversation: ConversationListItem
  message: MessageRow
  outbound: OutboundMessageRow
  duplicate: boolean
}> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)

  if (!input.clientRequestId.trim()) {
    throw new ValidationError('client_request_id_required', 'clientRequestId obrigatório')
  }

  const hasTemplate = Boolean(input.template?.name?.trim())
  const rawBody = (input.body ?? '').trim()
  if (hasTemplate && rawBody) {
    throw new ValidationError(
      'send_body_and_template',
      'Envie texto livre ou modelo, não ambos',
    )
  }
  if (!hasTemplate && !rawBody) {
    throw new ValidationError('empty_body', 'Mensagem vazia')
  }
  if (rawBody.length > 4000) {
    throw new ValidationError('body_too_long', 'Mensagem demasiado longa')
  }

  return db.transactionSync(() => {
    requireConversation(db, meta.tenantId, input.conversationId)

    const existingOb = findOutboundByClientRequestId(
      db,
      meta.tenantId,
      input.clientRequestId,
    )
    if (existingOb) {
      const existingMsg = db.get<{
        id: string
        tenant_id: string
        conversation_id: string
        direction: string
        body: string
        external_message_id: string | null
        delivery_state: string
        author_clerk_user_id: string | null
        author_display_name: string | null
        created_at: number
      }>(
        `SELECT * FROM messages WHERE tenant_id = ? AND id = ?`,
        meta.tenantId,
        existingOb.messageId,
      )
      if (!existingMsg) {
        throw new ConflictError('outbound_orphan', 'Intenção de envio sem mensagem')
      }
      const message: MessageRow = {
        id: existingMsg.id,
        tenantId: existingMsg.tenant_id,
        conversationId: existingMsg.conversation_id,
        direction: existingMsg.direction as MessageRow['direction'],
        body: existingMsg.body,
        externalMessageId: existingMsg.external_message_id,
        deliveryState: existingMsg.delivery_state as MessageRow['deliveryState'],
        authorClerkUserId: existingMsg.author_clerk_user_id,
        authorDisplayName: existingMsg.author_display_name,
        createdAt: existingMsg.created_at,
      }
      const item = getConversationWithContact(db, meta.tenantId, input.conversationId)!
      return {
        value: { conversation: item, message, outbound: existingOb, duplicate: true },
        outbox: [],
      }
    }

    const channel = getWhatsappChannel(db, meta.tenantId)
    if (!channel || channel.status !== 'connected') {
      throw new ValidationError(
        'whatsapp_not_connected',
        channel?.status === 'interrupted'
          ? 'WhatsApp interrompido — reconecte antes de enviar (sem reenvio automático)'
          : 'WhatsApp não conectado nesta clínica',
      )
    }

    const window = messagingWindowForConversation(
      db,
      meta.tenantId,
      input.conversationId,
      clock.nowMs(),
    )

    let body: string
    let kind: 'text' | 'template' = 'text'
    let templateName: string | null = null
    let templateLanguage: string | null = null
    let templateParams: Record<string, string> | null = null

    if (hasTemplate) {
      const tpl = input.template!
      const validated = validateTemplateSend(db, meta.tenantId, {
        name: tpl.name.trim(),
        language: (tpl.language || 'pt_BR').trim(),
        params: tpl.params ?? {},
      })
      body = validated.body
      kind = 'template'
      templateName = validated.template.name
      templateLanguage = validated.template.language
      templateParams = { ...tpl.params }
    } else {
      if (!window.open) {
        throw new ValidationError(
          'outside_messaging_window',
          'Fora da janela de 24 h do WhatsApp — use um modelo aprovado',
        )
      }
      body = rawBody
    }

    const now = clock.nowMs()
    const message = insertMessage(
      db,
      {
        tenantId: meta.tenantId,
        conversationId: input.conversationId,
        direction: 'outbound',
        body,
        externalMessageId: null,
        deliveryState: 'pending',
        authorClerkUserId: input.authorClerkUserId,
        authorDisplayName: input.authorDisplayName,
        createdAt: now,
      },
      clock,
    )

    const outbound = insertOutboundMessage(
      db,
      {
        tenantId: meta.tenantId,
        conversationId: input.conversationId,
        messageId: message.id,
        clientRequestId: input.clientRequestId,
        kind,
        templateName,
        templateLanguage,
        templateParams,
        deliveryState: 'pending',
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

    const createdOutbox = insertOutboxEvent(
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
          outboundId: outbound.id,
          direction: 'outbound',
          bodyPreview: body.slice(0, 120),
          deliveryState: 'pending',
          kind,
        },
      },
      clock,
    )

    const sendOutbox = insertOutboxEvent(
      db,
      {
        tenantId: meta.tenantId,
        type: 'whatsapp.send',
        aggregateType: 'outbound_message',
        aggregateId: outbound.id,
        idempotencyKey: `whatsapp.send:${input.clientRequestId}`,
        payload: {
          conversationId: input.conversationId,
          messageId: message.id,
          outboundId: outbound.id,
          clientRequestId: input.clientRequestId,
          kind,
          templateName,
          templateLanguage,
          waId: getConversationWithContact(db, meta.tenantId, input.conversationId)!.contact
            .waId,
          phoneNumberId: channel.phoneNumberId,
          // Corpo só na fila interna — logs do consumer não devem ecoá-lo.
          body,
          templateParams,
        },
      },
      clock,
    )
    setOutboundOutboxEventId(db, meta.tenantId, outbound.id, sendOutbox.id)

    const item = getConversationWithContact(db, meta.tenantId, input.conversationId)!
    const outboundFresh = findOutboundByClientRequestId(
      db,
      meta.tenantId,
      input.clientRequestId,
    )!
    return {
      value: {
        conversation: item,
        message,
        outbound: outboundFresh,
        duplicate: false,
      },
      outbox: [createdOutbox, sendOutbox],
    }
  })
}

/**
 * Resultado do consumer Meta → DO (#33).
 * Timeout/uncertain → unknown (sem retry automático).
 */
export function applyOutboundSendResultOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: {
    outboundId: string
    outboxEventId: string
    idempotencyKey: string
    outcome: 'succeeded' | 'failed' | 'uncertain'
    providerMessageId?: string | null
    errorCode?: string | null
  },
  clock: Clock,
): InboxMutationResult<{
  outbound: OutboundMessageRow
  message: MessageRow
  advanced: boolean
}> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)

  return db.transactionSync(() => {
    const nextState =
      input.outcome === 'succeeded'
        ? 'accepted'
        : input.outcome === 'failed'
          ? 'failed'
          : 'unknown'

    const updated = applyOutboundDeliveryUpdate(
      db,
      {
        tenantId: meta.tenantId,
        outboundId: input.outboundId,
        nextState,
        providerMessageId: input.providerMessageId ?? null,
        failureReason: input.errorCode ?? null,
      },
      clock,
    )
    if (!updated) {
      throw new NotFoundError('outbound_not_found', 'Intenção de envio não encontrada')
    }

    const outboxes: OutboxRow[] = []
    if (updated.advanced) {
      outboxes.push(
        insertOutboxEvent(
          db,
          {
            tenantId: meta.tenantId,
            type: 'message.delivery_updated',
            aggregateType: 'message',
            aggregateId: updated.message.id,
            idempotencyKey: `message.delivery:${updated.outbound.id}:${nextState}:${input.outboxEventId}`,
            payload: {
              conversationId: updated.outbound.conversationId,
              messageId: updated.message.id,
              outboundId: updated.outbound.id,
              deliveryState: nextState,
              providerMessageId: updated.outbound.providerMessageId,
            },
          },
          clock,
        ),
      )
    }

    acknowledgeOutboxResult(db, {
      tenantId: meta.tenantId,
      outboxEventId: input.outboxEventId,
      idempotencyKey: input.idempotencyKey,
      outcome: input.outcome,
      providerRef: input.providerMessageId ?? undefined,
      errorCode: input.errorCode ?? undefined,
      occurredAt: clock.nowMs(),
    })

    return {
      value: {
        outbound: updated.outbound,
        message: updated.message,
        advanced: updated.advanced,
      },
      outbox: outboxes,
    }
  })
}

/**
 * Status Meta (delivered/read/failed) reconciliado com outbound (#33).
 * Dedup inbound + avanço monotónico; fora de ordem não regride.
 */
export function reconcileOutboundStatusOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: {
    providerEventKey: string
    statusMessageId: string
    status: string
    providerTimestamp?: number | null
  },
  clock: Clock,
): InboxMutationResult<{
  duplicate: boolean
  inboundId: string
  advanced: boolean
  message: MessageRow | null
}> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)

  return db.transactionSync(() => {
    const recorded = recordInboundEvent(
      db,
      {
        tenantId: meta.tenantId,
        providerEventKey: input.providerEventKey,
        payload: {
          kind: 'status',
          statusMessageId: input.statusMessageId,
          status: input.status,
          providerTimestamp: input.providerTimestamp ?? null,
        },
      },
      clock,
    )

    if (recorded.duplicate) {
      return {
        value: {
          duplicate: true,
          inboundId: recorded.row.id,
          advanced: false,
          message: null,
        },
        outbox: [],
      }
    }

    const mapped = mapMetaStatusToDelivery(input.status)
    if (!mapped || !input.statusMessageId) {
      return {
        value: {
          duplicate: false,
          inboundId: recorded.row.id,
          advanced: false,
          message: null,
        },
        outbox: [],
      }
    }

    const outbound = findOutboundByProviderMessageId(
      db,
      meta.tenantId,
      input.statusMessageId,
    )
    if (!outbound) {
      // Status sem outbound local (ex.: mensagem pré-MVP) — só inbound_events.
      return {
        value: {
          duplicate: false,
          inboundId: recorded.row.id,
          advanced: false,
          message: null,
        },
        outbox: [],
      }
    }

    const updated = applyOutboundDeliveryUpdate(
      db,
      {
        tenantId: meta.tenantId,
        outboundId: outbound.id,
        nextState: mapped,
        providerMessageId: input.statusMessageId,
        failureReason: mapped === 'failed' ? input.status : null,
      },
      clock,
    )

    const outboxes: OutboxRow[] = []
    if (updated?.advanced) {
      outboxes.push(
        insertOutboxEvent(
          db,
          {
            tenantId: meta.tenantId,
            type: 'message.delivery_updated',
            aggregateType: 'message',
            aggregateId: updated.message.id,
            idempotencyKey: `message.delivery:${outbound.id}:${mapped}:${input.providerEventKey}`,
            payload: {
              conversationId: outbound.conversationId,
              messageId: updated.message.id,
              outboundId: outbound.id,
              deliveryState: mapped,
              providerMessageId: input.statusMessageId,
            },
          },
          clock,
        ),
      )
    }

    return {
      value: {
        duplicate: false,
        inboundId: recorded.row.id,
        advanced: updated?.advanced ?? false,
        message: updated?.message ?? null,
      },
      outbox: outboxes,
    }
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
    /** Timestamp do provedor (ms) — ordenação Meta (#32). */
    occurredAtMs?: number
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

  const now =
    input.occurredAtMs != null && Number.isFinite(input.occurredAtMs)
      ? input.occurredAtMs
      : clock.nowMs()
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
