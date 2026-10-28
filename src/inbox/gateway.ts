import type { ClinicOutboxQueueMessage } from '../whatsapp/queue-types'
import type { Clock } from '../db/clock'
import {
  clinicInbox,
  type ClinicCaller,
  type ClinicDb,
  workerCaller,
} from '../clinic'
import type {
  AssignConversationInput,
  BlockContactInput,
  CloseConversationInput,
  ConversationDetail,
  ConversationListItem,
  InboxCounts,
  ListConversationsInput,
  MarkReadInput,
  MessageRow,
  OutboundMessageRow,
  SendOutboundInput,
  UnblockContactInput,
} from '../clinic/inbox'
import { createSyntheticMetaAdapter } from '../whatsapp/meta'
import { listPendingOutbox, toEventEnvelope } from '../clinic/outbox'
import { queueCaller } from '../clinic'

export type InboxGateway = {
  listConversations(
    caller: ClinicCaller,
    input: ListConversationsInput,
  ): Promise<{
    items: ConversationListItem[]
    nextBefore: number | null
    counts: InboxCounts
  }>
  getConversation(
    caller: ClinicCaller,
    input: { conversationId: string; messageLimit?: number; before?: number | null },
  ): Promise<ConversationDetail>
  getContact(
    caller: ClinicCaller,
    contactId: string,
  ): Promise<{
    contact: ConversationListItem['contact']
    conversations: ConversationListItem[]
    hasPendingPix: boolean
  }>
  assign(
    caller: ClinicCaller,
    input: AssignConversationInput,
  ): Promise<{
    conversation: ConversationListItem
    systemMessage: MessageRow
    versionMatched: boolean
  }>
  markRead(
    caller: ClinicCaller,
    input: MarkReadInput,
  ): Promise<ConversationListItem>
  close(
    caller: ClinicCaller,
    input: CloseConversationInput,
  ): Promise<{ conversation: ConversationListItem; systemMessage: MessageRow }>
  blockContact(
    caller: ClinicCaller,
    input: BlockContactInput,
  ): Promise<{ contact: ConversationListItem['contact']; closedConversationIds: string[] }>
  unblockContact(
    caller: ClinicCaller,
    input: UnblockContactInput,
  ): Promise<{ contact: ConversationListItem['contact'] }>
  sendOutbound(
    caller: ClinicCaller,
    input: SendOutboundInput,
  ): Promise<{
    conversation: ConversationListItem
    message: MessageRow
    outbound: OutboundMessageRow
    duplicate: boolean
    /** DO real: envio a despachar já no pedido (fila só como fallback). */
    inlineDispatch?: ClinicOutboxQueueMessage | null
  }>
  seedDemo(
    caller: ClinicCaller,
    opts?: { force?: boolean },
  ): Promise<{ seeded: boolean; conversationCount: number }>
}

/**
 * Em memória: após persistir a intenção, processa `whatsapp.send` com Meta sintético
 * (equivale ao consumer da Queue no Worker).
 */
async function drainMemoryWhatsappSends(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  accessTokenMarker?: string,
): Promise<void> {
  const meta = createSyntheticMetaAdapter()
  const pending = listPendingOutbox(db, tenantId).filter((o) => o.type === 'whatsapp.send')
  for (const row of pending) {
    const envelope = toEventEnvelope(row)
    const payload = envelope.payload
    const outboundId = String(payload.outboundId ?? '')
    const kind = payload.kind === 'template' ? 'template' : 'text'
    const clientRequestId = String(payload.clientRequestId ?? '')
    const body = String(payload.body ?? '')
    const waId = String(payload.waId ?? '000')
    const phoneNumberId = String(payload.phoneNumberId ?? 'synth_phone')
    const accessToken = accessTokenMarker ?? `synth_token_${phoneNumberId}`

    let outcome: 'succeeded' | 'failed' | 'uncertain' = 'succeeded'
    let providerMessageId: string | null = null
    let errorCode: string | null = null

    if (kind === 'template') {
      const r = await meta.sendTemplateMessage({
        phoneNumberId,
        accessToken,
        toWaId: waId,
        templateName: String(payload.templateName ?? ''),
        language: String(payload.templateLanguage ?? 'pt_BR'),
        bodyParams: Object.values(
          (payload.templateParams as Record<string, string> | null) ?? {},
        ),
        clientRequestId,
      })
      outcome = r.outcome
      providerMessageId = r.outcome === 'succeeded' ? r.providerMessageId : null
      errorCode = r.outcome === 'succeeded' ? null : r.errorCode
    } else {
      const r = await meta.sendTextMessage({
        phoneNumberId,
        accessToken,
        toWaId: waId,
        body,
        clientRequestId,
      })
      outcome = r.outcome
      providerMessageId = r.outcome === 'succeeded' ? r.providerMessageId : null
      errorCode = r.outcome === 'succeeded' ? null : r.errorCode
    }

    clinicInbox.applyOutboundSendResultOp(
      db,
      queueCaller(tenantId),
      {
        outboundId,
        outboxEventId: row.id,
        idempotencyKey: row.idempotencyKey,
        outcome,
        providerMessageId,
        errorCode,
      },
      clock,
    )
  }
}

export function createMemoryInboxGateway(db: ClinicDb, clock: Clock): InboxGateway {
  return {
    async listConversations(caller, input) {
      return clinicInbox.listConversationsOp(db, caller, input, clock)
    },
    async getConversation(caller, input) {
      return clinicInbox.getConversationDetailOp(db, caller, input, clock)
    },
    async getContact(caller, contactId) {
      return clinicInbox.getContactDetailOp(db, caller, contactId, clock)
    },
    async assign(caller, input) {
      return clinicInbox.assignConversationOp(db, caller, input, clock).value
    },
    async markRead(caller, input) {
      return clinicInbox.markConversationReadOp(db, caller, input, clock).value
    },
    async close(caller, input) {
      return clinicInbox.closeConversationOp(db, caller, input, clock).value
    },
    async blockContact(caller, input) {
      return clinicInbox.blockContactOp(db, caller, input, clock).value
    },
    async unblockContact(caller, input) {
      return clinicInbox.unblockContactOp(db, caller, input, clock).value
    },
    async sendOutbound(caller, input) {
      const result = clinicInbox.sendOutboundMessageOp(db, caller, input, clock)
      if (!result.value.duplicate) {
        await drainMemoryWhatsappSends(db, caller.tenantId, clock)
        const fresh = clinicInbox.findOutboundByClientRequestId(
          db,
          caller.tenantId,
          input.clientRequestId,
        )
        const msgRow = db.get<{
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
          caller.tenantId,
          result.value.message.id,
        )
        const conversation = clinicInbox.getConversationWithContact(
          db,
          caller.tenantId,
          input.conversationId,
        )!
        return {
          conversation,
          message: {
            id: msgRow!.id,
            tenantId: msgRow!.tenant_id,
            conversationId: msgRow!.conversation_id,
            direction: msgRow!.direction as MessageRow['direction'],
            body: msgRow!.body,
            externalMessageId: msgRow!.external_message_id,
            deliveryState: msgRow!.delivery_state as MessageRow['deliveryState'],
            authorClerkUserId: msgRow!.author_clerk_user_id,
            authorDisplayName: msgRow!.author_display_name,
            createdAt: msgRow!.created_at,
          },
          outbound: fresh!,
          duplicate: false,
        }
      }
      return result.value
    },
    async seedDemo(caller, opts) {
      return clinicInbox.seedSyntheticInboxOp(db, caller, clock, opts)
    },
  }
}

export function createMemoryInboxRegistry(
  getDb: (tenantId: string) => { db: ClinicDb; clock: Clock },
): (tenantId: string) => InboxGateway {
  const cache = new Map<string, InboxGateway>()
  return (tenantId: string) => {
    let gw = cache.get(tenantId)
    if (!gw) {
      const { db, clock } = getDb(tenantId)
      clinicInbox.listConversationsOp(db, workerCaller(tenantId), {}, clock)
      gw = createMemoryInboxGateway(db, clock)
      cache.set(tenantId, gw)
    }
    return gw
  }
}
