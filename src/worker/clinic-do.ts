import { countUnreadConversations } from '../clinic/inbox/conversations'
import { isDevelopmentEnv } from '../security/env-gate'
import { isDemoTenantId, seedDemoClinicOp } from '../clinic/demo'
import { DurableObject } from 'cloudflare:workers'
import {
  claimOutboundSendOp,
  releaseOutboundSendOp,
  sweepStuckOutboundOp,
  OUTBOUND_INLINE_FALLBACK_DELAY_S,
  OUTBOUND_PENDING_STALE_MS,
  type ClaimOutboundSendResult,
} from '../clinic/inbox/dispatch'
import type { ClinicOutboxQueueMessage } from '../whatsapp/queue-types'
import {
  acknowledgeOutboxResult,
  assertClinicTenantId,
  assertSyntheticTenantId,
  bindOrAssertTenant,
  clinicAi,
  clinicAttachments,
  clinicConfig,
  clinicInbox,
  clinicPipeline,
  clinicPix,
  clinicRetention,
  clinicScheduling,
  clinicWhatsapp,
  fromDurableObjectSql,
  getBoundTenant,
  ingestContactMessage,
  listContacts,
  listPendingOutbox,
  publishPendingEffects,
  runClinicMigrations,
  TenantMismatchError,
  ValidationError,
  type ClinicCaller,
  type ClinicDb,
  type ConsumerResult,
  type EventEnvelope,
  type IngestContactMessageInput,
  type OutboxRow,
  workerCaller,
} from '../clinic'
import type {
  AssignConversationInput,
  CloseConversationInput,
  ListConversationsInput,
  MarkReadInput,
  SendOutboundInput,
} from '../clinic/inbox'
import type {
  CreatePendingAttachmentInput,
  LinkAttachmentToMessageInput,
  MarkAttachmentFailedInput,
  MarkAttachmentReadyInput,
} from '../clinic/attachments'
import type {
  LinkAppointmentInput,
  ListOpportunitiesInput,
  MoveStageInput,
  ReopenOpportunityInput,
} from '../clinic/pipeline'
import type {
  CreateBlockInput,
  SetWeeklyWindowsInput,
  UpsertResourceInput,
  UpsertServiceInput,
} from '../clinic/config'
import type {
  AgendaViewInput,
  AvailabilityQueryInput,
  CancelAppointmentInput,
  CheckSlotInput,
  ConfirmAppointmentInput,
  CreateHoldInput,
  CancelHoldInput,
  HoldPreviewInput,
  ListHoldsInput,
  RescheduleAppointmentInput,
  ResolveHoldInput,
} from '../clinic/scheduling'
import type {
  CancelPaidWithSignalInput,
  CancelUnpaidChargeInput,
  ConfirmWithoutSignalInput,
  ConnectPixInput,
  CreateSignalChargeInput,
  PixConnectDeps,
  ProcessPixLifecycleInput,
  ProcessPixPaymentInput,
  RecordChargeInput,
  RequestRefundInput,
  ResolveAlertAltSlotInput,
  ResolveAlertRefundInput,
  UpdateSignalSettingsInput,
} from '../clinic/pix'
import type { PixProviderAdapter } from '../pix'
import type {
  AiAssistRpcDeps,
  DecideSuggestionInput,
  SuggestReplyInput,
  SummarizeInput,
} from '../clinic/ai'
import { systemClock, type Clock } from '../db/clock'
import { fromD1 } from '../db/admin/async-store'
import {
  appendRealtimeEvent,
  closeAllSockets,
  closeUserSockets,
  createD1AccessAuthority,
  createMapAccessAuthority,
  deliverEventToSockets,
  denyUserAccess,
  encodeServerMessage,
  ensureRealtimeFence,
  getLastEventSeq,
  listRealtimeEventsAfter,
  parseClientMessage,
  activeViewerUserIds,
  setTenantSuspendedFence,
  WORKER_WS_ASSERTION,
  WS_INTERNAL_HEADERS,
  type AccessAuthority,
  type DeliverySocket,
  type FenceSource,
  type SocketAttachment,
} from '../realtime'
import {
  WS_TICKET_HEADER,
  issueWsTicket,
  redeemWsTicket,
  type WsTicketStorage,
} from '../realtime/ticket'
import { newId } from '../clinic/ids'
import type { WorkerBindings } from './bindings'

type ClinicEnv = WorkerBindings

type WsUpgradeIdentity = {
  tenantId: string
  clerkUserId: string
  sessionId: string
  role: 'owner' | 'attendant'
}

/**
 * Clinic Durable Object — um por clínica (DEC-038 / ADR-0012 / issues #20/#23).
 * SQLite + migrações + outbox + WebSockets hibernáveis com fence D1→DO.
 */
export class ClinicDurableObject extends DurableObject<ClinicEnv> {
  #db: ClinicDb
  #clock: Clock = systemClock
  #ready = false
  /** Override de authority para testes determinísticos (cache positivo / falha). */
  #authorityOverride: AccessAuthority | null = null

  constructor(ctx: DurableObjectState, env: ClinicEnv) {
    super(ctx, env)
    this.#db = fromDurableObjectSql(this.ctx.storage as Parameters<typeof fromDurableObjectSql>[0])
    this.ctx.blockConcurrencyWhile(async () => {
      runClinicMigrations(this.#db, this.#clock)
      ensureRealtimeFence(this.#db, this.#clock)
      this.#ready = true
      // Auto-ping/pong sem acordar o DO (hibernação).
      try {
        this.ctx.setWebSocketAutoResponse(
          new WebSocketRequestResponsePair('ping', 'pong'),
        )
      } catch {
        /* runtime sem auto-response — ok */
      }
    })
  }

  #ensureReady(): void {
    if (!this.#ready) {
      runClinicMigrations(this.#db, this.#clock)
      ensureRealtimeFence(this.#db, this.#clock)
      this.#ready = true
    }
  }

  #assertInstanceTenant(caller: ClinicCaller): string {
    const name = this.ctx.id.name
    if (!name) {
      throw new TenantMismatchError('DO sem nome estável (idFromName obrigatório)')
    }
    assertClinicTenantId(name, { allowSynthetic: isDevelopmentEnv(this.env) })
    if (caller.tenantId !== name) {
      throw new TenantMismatchError(
        `instância=${name} chamador=${caller.tenantId}`,
      )
    }
    return name
  }

  #authority(): AccessAuthority {
    if (this.#authorityOverride) return this.#authorityOverride
    return createD1AccessAuthority(fromD1(this.env.DB))
  }

  #asDeliverySockets(): DeliverySocket[] {
    return this.ctx.getWebSockets().map((ws) => ({
      send: (data: string) => ws.send(data),
      close: (code?: number, reason?: string) => {
        try {
          ws.close(code, reason)
        } catch {
          /* ignore */
        }
      },
      deserializeAttachment: () => {
        try {
          return (ws.deserializeAttachment() as SocketAttachment | null) ?? null
        } catch {
          return null
        }
      },
    }))
  }

  /** Harness F0/F1 — isolamento por instância. */
  async ping(tenantId: string): Promise<{ ok: true; tenantId: string; value: string }> {
    if (!isDevelopmentEnv(this.env)) {
      throw new TenantMismatchError('harness indisponível fora de development')
    }
    this.#ensureReady()
    assertSyntheticTenantId(tenantId)
    const caller = workerCaller(tenantId)
    this.#assertInstanceTenant(caller)
    bindOrAssertTenant(this.#db, caller, this.#clock)

    const now = this.#clock.nowMs()
    this.#db.run(
      `INSERT INTO f0_probe (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      'last_ping',
      tenantId,
      now,
    )
    const row = this.#db.get<{ value: string }>(
      'SELECT value FROM f0_probe WHERE key = ?',
      'last_ping',
    )
    return { ok: true, tenantId, value: row!.value }
  }

  async getStatus(caller: ClinicCaller): Promise<{
    tenantId: string
    schemaReady: true
    pendingOutbox: number
    contactCount: number
    eventSeq: number
  }> {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const meta = bindOrAssertTenant(this.#db, caller, this.#clock)
    return {
      tenantId: meta.tenantId,
      schemaReady: true,
      pendingOutbox: listPendingOutbox(this.#db, meta.tenantId).length,
      contactCount: listContacts(this.#db, meta.tenantId).length,
      eventSeq: getLastEventSeq(this.#db),
    }
  }

  /**
   * Snapshot operacional (#44) — contagens técnicas sem PII / corpos.
   * Usado por harness de carga, alertas e ensaio de recuperação.
   */
  async getOpsSnapshot(caller: ClinicCaller): Promise<{
    tenantId: string
    schemaVersion: number | null
    schemaReady: boolean
    pendingOutbox: number
    failedOutbox: number
    uncertainOutbound: number
    contactCount: number
    messageCount: number
    appointmentCount: number
    attachmentMetaCount: number
    eventSeq: number
  }> {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const meta = bindOrAssertTenant(this.#db, caller, this.#clock)
    const schema = this.#db.get<{ version: number; status: string }>(
      'SELECT version, status FROM clinic_schema_state WHERE id = 1',
    )
    const failedOutbox =
      this.#db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM outbox_events
         WHERE tenant_id = ? AND processing_state = 'failed'`,
        meta.tenantId,
      )?.n ?? 0
    const uncertainOutbound =
      this.#db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM outbound_messages
         WHERE tenant_id = ? AND delivery_state = 'unknown'`,
        meta.tenantId,
      )?.n ?? 0
    const messageCount =
      this.#db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ?`,
        meta.tenantId,
      )?.n ?? 0
    const appointmentCount =
      this.#db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`,
        meta.tenantId,
      )?.n ?? 0
    const attachmentMetaCount =
      this.#db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM attachments WHERE tenant_id = ?`,
        meta.tenantId,
      )?.n ?? 0
    return {
      tenantId: meta.tenantId,
      schemaVersion: schema?.version ?? null,
      schemaReady: schema?.status === 'ready',
      pendingOutbox: listPendingOutbox(this.#db, meta.tenantId).length,
      failedOutbox,
      uncertainOutbound,
      contactCount: listContacts(this.#db, meta.tenantId).length,
      messageCount,
      appointmentCount,
      attachmentMetaCount,
      eventSeq: getLastEventSeq(this.#db),
    }
  }

  async listEventsAfter(
    caller: ClinicCaller,
    afterSeq: number,
  ): Promise<{
    eventSeq: number
    events: Array<{
      seq: number
      tenantId: string
      eventId: string
      type: string
      entityType: string
      entityId: string
      payload: Record<string, unknown>
      occurredAt: number
    }>
  }> {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const meta = bindOrAssertTenant(this.#db, caller, this.#clock)
    return {
      eventSeq: getLastEventSeq(this.#db),
      events: listRealtimeEventsAfter(this.#db, meta.tenantId, afterSeq),
    }
  }

  /**
   * Bilhete curto de uso único para o upgrade WS do browser (sem headers).
   * Chamado só pelo Worker depois de autenticar Clerk + membership D1.
   */
  async issueWsTicket(
    caller: ClinicCaller,
    identity: { clerkUserId: string; sessionId: string; role: 'owner' | 'attendant' },
  ): Promise<{ ticket: string; expiresAt: number }> {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return issueWsTicket(
      this.#ticketStorage(),
      {
        tenantId: caller.tenantId,
        clerkUserId: identity.clerkUserId,
        sessionId: identity.sessionId,
        role: identity.role,
      },
      this.#clock.nowMs(),
    )
  }

  #ticketStorage(): WsTicketStorage {
    const storage = this.ctx.storage
    return {
      get: <T>(key: string) => storage.get<T>(key),
      put: <T>(key: string, value: T) => storage.put<T>(key, value),
      delete: (key: string) => storage.delete(key),
      list: <T>(opts: { prefix: string }) => storage.list<T>(opts),
    }
  }

  /**
   * Publica evento de domínio admin/clínica no log versionado + fan-out WS.
   * Usado por pedidos de suporte (#26) — audience `owners` filtra attendants.
   */
  async publishTenantEvent(
    caller: ClinicCaller,
    input: {
      type: string
      entityType: string
      entityId: string
      payload: Record<string, unknown>
      audience?: 'all' | 'owners' | 'subject' | 'owners_and_subject'
      eventId?: string
    },
  ): Promise<{
    seq: number
    eventId: string
    fanout: { delivered: string[]; revoked: string[]; skippedUnavailable: string[] }
  }> {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    bindOrAssertTenant(this.#db, caller, this.#clock)
    const evt = appendRealtimeEvent(
      this.#db,
      {
        tenantId: caller.tenantId,
        type: input.type,
        entityType: input.entityType,
        entityId: input.entityId,
        payload: input.payload,
        audience: input.audience,
        eventId: input.eventId,
      },
      this.#clock,
    )
    const fanout = await deliverEventToSockets(
      this.#db,
      this.#asDeliverySockets(),
      evt,
      this.#authority(),
      this.#clock,
    )
    return {
      seq: evt.seq,
      eventId: evt.eventId,
      fanout,
    }
  }

  /**
   * Ingestão operacional com outbox + evento realtime na mesma TX SQLite.
   * Fan-out WS ocorre depois do commit; publicação Queue no drain.
   */
  async ingestMessage(
    caller: ClinicCaller,
    input: IngestContactMessageInput,
    opts: { drain?: boolean; fanout?: boolean } = {},
  ): Promise<{
    duplicate: boolean
    contactId: string | null
    conversationId: string | null
    messageId: string | null
    inboundId: string
    outboxId: string | null
    eventSeq: number | null
    drained: string[]
    fanout: { delivered: string[]; revoked: string[]; skippedUnavailable: string[] } | null
    /** #42 — dispara push de nova conversa no Worker após ingest. */
    createdConversation: boolean
    /** #43 — wa_id tombstoned; sem recriação de contacto. */
    suppressedTombstone: boolean
    /** Push: utilizadores com a app aberta e visível (não recebem push). */
    activeViewerUserIds: string[]
    /** Push: conversas com não lidas (badge do ícone). */
    unreadConversations: number
  }> {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = ingestContactMessage(this.#db, caller, input, this.#clock)

    let eventSeq: number | null = null
    let fanoutResult: {
      delivered: string[]
      revoked: string[]
      skippedUnavailable: string[]
    } | null = null

    const createdConversation =
      !result.duplicate &&
      result.outboxes.some((o) => o.type === 'conversation.created')

    if (!result.duplicate && result.outboxes.length > 0) {
      const last = await this.#fanoutOutboxes(
        caller,
        result.outboxes,
        opts.fanout !== false,
      )
      eventSeq = last.eventSeq
      fanoutResult = last.fanout
    }

    let drained: string[] = []
    if (opts.drain !== false) {
      const pub = await this.#drain(caller)
      drained = pub.published
    }

    return {
      duplicate: result.duplicate,
      contactId: result.contact?.id ?? null,
      conversationId: result.conversation?.id ?? null,
      messageId: result.message?.id ?? null,
      inboundId: result.inbound.id,
      outboxId: result.outbox?.id ?? null,
      eventSeq,
      drained,
      fanout: fanoutResult,
      createdConversation,
      suppressedTombstone: result.suppressedTombstone,
      activeViewerUserIds: result.duplicate ? [] : this.#activeViewerUserIds(),
      unreadConversations: result.duplicate
        ? 0
        : countUnreadConversations(this.#db, caller.tenantId),
    }
  }

  #activeViewerUserIds(): string[] {
    try {
      return activeViewerUserIds(
        this.ctx.getWebSockets().map((ws) => {
          try {
            return ws.deserializeAttachment() as SocketAttachment | null
          } catch {
            return null
          }
        }),
        this.#clock.nowMs(),
      )
    } catch {
      return []
    }
  }

  /**
   * Status Meta (#32/#33): dedup inbound_events + reconciliação monotónica de outbound.
   */
  async recordInboundStatus(
    caller: ClinicCaller,
    input: {
      providerEventKey: string
      statusMessageId: string
      status: string
      providerTimestamp?: number | null
    },
  ): Promise<{ duplicate: boolean; inboundId: string; advanced: boolean }> {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicInbox.reconcileOutboundStatusOp(
      this.#db,
      caller,
      input,
      this.#clock,
    )
    if (result.outbox.length > 0) {
      await this.#fanoutOutboxes(caller, result.outbox, true)
      await this.#drain(caller)
    }
    return {
      duplicate: result.value.duplicate,
      inboundId: result.value.inboundId,
      advanced: result.value.advanced,
    }
  }

  /** Resultado Graph/synthetic do consumer de `whatsapp.send` (#33). */
  async applyOutboundSendResult(
    caller: ClinicCaller,
    input: {
      outboundId: string
      outboxEventId: string
      idempotencyKey: string
      outcome: 'succeeded' | 'failed' | 'uncertain'
      providerMessageId?: string | null
      errorCode?: string | null
    },
  ): Promise<{ deliveryState: string; advanced: boolean }> {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicInbox.applyOutboundSendResultOp(
      this.#db,
      caller,
      input,
      this.#clock,
    )
    if (result.outbox.length > 0) {
      await this.#fanoutOutboxes(caller, result.outbox, true)
      await this.#drain(caller)
    }
    return {
      deliveryState: result.value.message.deliveryState,
      advanced: result.value.advanced,
    }
  }

  /** Interrupção via webhook Meta (#32) — espelho DO + evento WS. */
  async applyWhatsappInterrupt(
    caller: ClinicCaller,
    input: { reason: string; phoneNumberId?: string | null },
  ): Promise<{ status: string }> {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    bindOrAssertTenant(this.#db, caller, this.#clock)
    const channel = clinicWhatsapp.interruptWhatsappChannel(
      this.#db,
      caller.tenantId,
      input,
      this.#clock,
    )
    if (channel) {
      const evt = appendRealtimeEvent(
        this.#db,
        {
          tenantId: caller.tenantId,
          type: 'whatsapp.interrupted',
          entityType: 'whatsapp_channel',
          entityId: caller.tenantId,
          eventId: `rt:whatsapp.interrupted:${caller.tenantId}:${this.#clock.nowMs()}`,
          payload: {
            status: 'interrupted',
            reason: input.reason,
          },
        },
        this.#clock,
      )
      await deliverEventToSockets(
        this.#db,
        this.#asDeliverySockets(),
        evt,
        this.#authority(),
        this.#clock,
      )
    }
    return { status: channel?.status ?? 'interrupted' }
  }

  async #fanoutOutboxes(
    caller: ClinicCaller,
    outboxes: readonly OutboxRow[],
    fanout: boolean,
  ): Promise<{
    eventSeq: number | null
    fanout: { delivered: string[]; revoked: string[]; skippedUnavailable: string[] } | null
  }> {
    let eventSeq: number | null = null
    let fanoutResult: {
      delivered: string[]
      revoked: string[]
      skippedUnavailable: string[]
    } | null = null
    for (const ob of outboxes) {
      let payload: Record<string, unknown> = {}
      try {
        payload = JSON.parse(ob.payloadJson) as Record<string, unknown>
      } catch {
        payload = {}
      }
      const evt = appendRealtimeEvent(
        this.#db,
        {
          tenantId: caller.tenantId,
          type: ob.type,
          entityType: ob.aggregateType,
          entityId: ob.aggregateId,
          eventId: `rt:${ob.idempotencyKey}`,
          payload,
        },
        this.#clock,
      )
      eventSeq = evt.seq
      if (fanout) {
        fanoutResult = await deliverEventToSockets(
          this.#db,
          this.#asDeliverySockets(),
          evt,
          this.#authority(),
          this.#clock,
        )
      }
    }
    return { eventSeq, fanout: fanoutResult }
  }

  async listInboxConversations(caller: ClinicCaller, input: ListConversationsInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicInbox.listConversationsOp(this.#db, caller, input, this.#clock)
  }

  async getInboxConversation(
    caller: ClinicCaller,
    input: { conversationId: string; messageLimit?: number; before?: number | null },
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicInbox.getConversationDetailOp(this.#db, caller, input, this.#clock)
  }

  async getInboxContact(caller: ClinicCaller, contactId: string) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicInbox.getContactDetailOp(this.#db, caller, contactId, this.#clock)
  }

  async assignInboxConversation(caller: ClinicCaller, input: AssignConversationInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicInbox.assignConversationOp(this.#db, caller, input, this.#clock)
    await this.#fanoutOutboxes(caller, result.outbox, true)
    await this.#drain(caller)
    return result.value
  }

  async markInboxConversationRead(caller: ClinicCaller, input: MarkReadInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicInbox.markConversationReadOp(this.#db, caller, input, this.#clock)
    await this.#fanoutOutboxes(caller, result.outbox, true)
    await this.#drain(caller)
    return result.value
  }

  async closeInboxConversation(caller: ClinicCaller, input: CloseConversationInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicInbox.closeConversationOp(this.#db, caller, input, this.#clock)
    await this.#fanoutOutboxes(caller, result.outbox, true)
    await this.#drain(caller)
    return result.value
  }

  /**
   * Envio manual (#33). Devolve `inlineDispatch` para o Worker chamar a Meta
   * já no pedido (ctx.waitUntil); a mensagem de fila de `whatsapp.send` é
   * publicada com atraso e só envia se ninguém tiver reivindicado o envio.
   */
  async sendInboxOutbound(caller: ClinicCaller, input: SendOutboundInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    if (isDemoTenantId(caller.tenantId)) {
      // Contatos fictícios: nunca enfileirar envio WhatsApp.
      throw new ValidationError(
        'demo_clinic_outbound_disabled',
        'Clínica demo: o envio de mensagens está desativado.',
      )
    }
    await this.#sweepStuckOutbound(caller)
    const result = clinicInbox.sendOutboundMessageOp(this.#db, caller, input, this.#clock)
    await this.#fanoutOutboxes(caller, result.outbox, true)
    const sendRow = result.outbox.find((o) => o.type === 'whatsapp.send') ?? null
    await this.#drain(
      caller,
      sendRow
        ? { delayed: new Set([sendRow.id]), delaySeconds: OUTBOUND_INLINE_FALLBACK_DELAY_S }
        : undefined,
    )
    if (sendRow) {
      // Rede de segurança: resolve o envio se nem o inline nem a fila trouxerem resultado.
      await this.#scheduleAlarmNoLaterThan(
        this.#clock.nowMs() + OUTBOUND_PENDING_STALE_MS + 5_000,
      )
    }
    const inlineDispatch: ClinicOutboxQueueMessage | null = sendRow
      ? {
          source: 'clinic_outbox',
          tenantId: caller.tenantId,
          eventId: sendRow.id,
          type: sendRow.type,
          idempotencyKey: sendRow.idempotencyKey,
          entity: { type: sendRow.aggregateType, id: sendRow.aggregateId },
          occurredAt: sendRow.occurredAt,
          payload: JSON.parse(sendRow.payloadJson) as Record<string, unknown>,
        }
      : null
    return { ...result.value, inlineDispatch }
  }

  /** Reivindica o envio Meta de um outbox `whatsapp.send` (inline ou fila). */
  async claimOutboundSend(
    caller: ClinicCaller,
    input: { outboxEventId: string; idempotencyKey: string },
  ): Promise<ClaimOutboundSendResult> {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const r = claimOutboundSendOp(this.#db, caller, input, this.#clock)
    if (r.outbox.length > 0) {
      await this.#fanoutOutboxes(caller, r.outbox, true)
      await this.#drain(caller)
    }
    return r.value
  }

  /** Liberta o claim quando a Meta não chegou a ser chamada. */
  async releaseOutboundSend(
    caller: ClinicCaller,
    input: { outboxEventId: string; idempotencyKey: string },
  ): Promise<{ released: boolean }> {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return releaseOutboundSendOp(this.#db, caller, input)
  }

  async #sweepStuckOutbound(caller: ClinicCaller): Promise<number | null> {
    try {
      const swept = sweepStuckOutboundOp(this.#db, caller, this.#clock)
      if (swept.outbox.length > 0) {
        await this.#fanoutOutboxes(caller, swept.outbox, true)
        await this.#drain(caller)
      }
      return swept.nextCheckAt
    } catch {
      return null
    }
  }

  async #scheduleAlarmNoLaterThan(at: number): Promise<void> {
    const storage = this.ctx.storage as {
      getAlarm?: () => Promise<number | null>
      setAlarm?: (t: number) => Promise<void>
    }
    if (typeof storage.setAlarm !== 'function') return
    const current =
      typeof storage.getAlarm === 'function' ? await storage.getAlarm() : null
    if (current == null || current > at) await storage.setAlarm(at)
  }

  /**
   * Clínica demo de staging (backlog item 3). Só para `isDemoTenantId`;
   * a rota Worker exige staging + DEMO_SEED_ENABLED + DEMO_SEED_TOKEN.
   */
  async seedDemoClinic(
    caller: ClinicCaller,
    opts: { ownerClerkUserId: string; ownerDisplayName?: string },
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    if (!isDemoTenantId(caller.tenantId)) {
      throw new TenantMismatchError('seed demo só para a clínica demo')
    }
    return seedDemoClinicOp(this.#db, caller, this.#clock, opts)
  }

  async seedInboxDemo(caller: ClinicCaller, opts: { force?: boolean } = {}) {
    if (!isDevelopmentEnv(this.env)) {
      throw new TenantMismatchError('harness indisponível fora de development')
    }
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicInbox.seedSyntheticInboxOp(this.#db, caller, this.#clock, opts)
  }

  /** Metadados de anexo (#34) — sem I/O R2 neste DO. */
  async createPendingAttachment(
    caller: ClinicCaller,
    input: CreatePendingAttachmentInput,
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicAttachments.createPendingAttachmentOp(
      this.#db,
      caller,
      input,
      this.#clock,
    )
  }

  async markAttachmentReady(caller: ClinicCaller, input: MarkAttachmentReadyInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicAttachments.markAttachmentReadyOp(
      this.#db,
      caller,
      input,
      this.#clock,
    )
  }

  async markAttachmentFailed(caller: ClinicCaller, input: MarkAttachmentFailedInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicAttachments.markAttachmentFailedOp(
      this.#db,
      caller,
      input,
      this.#clock,
    )
  }

  async linkAttachmentToMessage(
    caller: ClinicCaller,
    input: LinkAttachmentToMessageInput,
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicAttachments.linkAttachmentToMessageOp(
      this.#db,
      caller,
      input,
      this.#clock,
    )
  }

  async getAttachment(caller: ClinicCaller, attachmentId: string) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicAttachments.getAttachmentOp(
      this.#db,
      caller,
      attachmentId,
      this.#clock,
    )
  }

  async listMessageAttachments(caller: ClinicCaller, messageId: string) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const meta = bindOrAssertTenant(this.#db, caller, this.#clock)
    return clinicAttachments.listAttachmentsForMessage(
      this.#db,
      meta.tenantId,
      messageId,
    )
  }

  async listConversationAttachments(caller: ClinicCaller, conversationId: string) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const meta = bindOrAssertTenant(this.#db, caller, this.#clock)
    return clinicAttachments.listAttachmentsForConversation(
      this.#db,
      meta.tenantId,
      conversationId,
    )
  }

  async listOrphanAttachments(caller: ClinicCaller) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const meta = bindOrAssertTenant(this.#db, caller, this.#clock)
    return clinicAttachments.listOrphanCandidates(
      this.#db,
      meta.tenantId,
      this.#clock.nowMs(),
    )
  }

  async softDeleteAttachment(caller: ClinicCaller, attachmentId: string) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicAttachments.softDeleteAttachmentOp(
      this.#db,
      caller,
      attachmentId,
      this.#clock,
    )
  }

  /**
   * Exclusão de contacto (#43 / REQ-071). R2 fica a cargo do Worker
   * com `deletedAttachmentIds` (fora de transactionSync).
   */
  async deleteContact(caller: ClinicCaller, contactId: string) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicRetention.deleteContactOp(
      this.#db,
      caller,
      contactId,
      this.#clock,
    )
    await this.#fanoutOutboxes(caller, result.outbox, true)
    await this.#drain(caller)
    return result.value
  }

  async wipeClinicOperationalData(caller: ClinicCaller) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicRetention.wipeClinicOperationalData(this.#db, caller, this.#clock)
  }

  async getClinicPurgeState(caller: ClinicCaller) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    bindOrAssertTenant(this.#db, caller, this.#clock)
    return clinicRetention.getClinicPurgeState(this.#db)
  }

  async listPipelineOpportunities(caller: ClinicCaller, input: ListOpportunitiesInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    await this.#sweepHolds(caller)
    return clinicPipeline.listOpportunitiesOp(this.#db, caller, input, this.#clock)
  }

  async getPipelineOpportunity(caller: ClinicCaller, opportunityId: string) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicPipeline.getOpportunityOp(this.#db, caller, opportunityId, this.#clock)
  }

  async movePipelineStage(caller: ClinicCaller, input: MoveStageInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicPipeline.moveOpportunityStageOp(
      this.#db,
      caller,
      input,
      this.#clock,
    )
    await this.#fanoutOutboxes(caller, result.outbox, true)
    await this.#drain(caller)
    return result.value
  }

  async linkPipelineAppointment(caller: ClinicCaller, input: LinkAppointmentInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicPipeline.linkAppointmentOp(
      this.#db,
      caller,
      input,
      this.#clock,
    )
    await this.#fanoutOutboxes(caller, result.outbox, true)
    await this.#drain(caller)
    return result.value
  }

  async reopenPipelineOpportunity(caller: ClinicCaller, input: ReopenOpportunityInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicPipeline.reopenOpportunityCycleOp(
      this.#db,
      caller,
      input,
      this.#clock,
    )
    await this.#fanoutOutboxes(caller, result.outbox, true)
    await this.#drain(caller)
    return result.value
  }

  async seedPipelineDemo(caller: ClinicCaller, opts: { force?: boolean } = {}) {
    if (!isDevelopmentEnv(this.env)) {
      throw new TenantMismatchError('harness indisponível fora de development')
    }
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicPipeline.seedSyntheticPipelineOp(this.#db, caller, this.#clock, opts)
  }

  /** Snapshot de reconciliação — lista recente + seq (REQ-021 / #23/#30). */
  async listInboxSnapshot(caller: ClinicCaller, viewerClerkUserId?: string) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const listed = clinicInbox.listConversationsOp(
      this.#db,
      caller,
      { filter: 'all', limit: 50, viewerClerkUserId },
      this.#clock,
    )
    const pipeline = clinicPipeline.listOpportunitiesOp(
      this.#db,
      caller,
      { limit: 100 },
      this.#clock,
    )
    return {
      eventSeq: getLastEventSeq(this.#db),
      conversations: listed.items,
      counts: listed.counts,
      opportunities: pipeline.items,
      opportunityCounts: pipeline.counts,
    }
  }

  async drainOutbox(caller: ClinicCaller): Promise<{ published: string[]; failed: string[] }> {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return this.#drain(caller)
  }

  async acknowledgeResult(
    caller: ClinicCaller,
    result: ConsumerResult,
  ): Promise<{ processingState: string }> {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    bindOrAssertTenant(this.#db, caller, this.#clock)
    if (result.tenantId !== caller.tenantId) {
      throw new TenantMismatchError(
        `result.tenantId=${result.tenantId} caller=${caller.tenantId}`,
      )
    }
    const row = acknowledgeOutboxResult(this.#db, result)
    return { processingState: row.processingState }
  }

  async listSyntheticContacts(caller: ClinicCaller): Promise<
    Array<{ id: string; waId: string; displayName: string | null }>
  > {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const meta = bindOrAssertTenant(this.#db, caller, this.#clock)
    return listContacts(this.#db, meta.tenantId).map((c) => ({
      id: c.id,
      waId: c.waId,
      displayName: c.displayName,
    }))
  }

  /**
   * Fence local + fecho de sockets (ADR-0009).
   * Chamado pelo Worker após commit D1; best-effort.
   */
  async applyUserFence(input: {
    tenantId: string
    clerkUserId: string
    reason: string
    source: FenceSource
  }): Promise<{ ok: true; closedConnections: string[]; authEpoch: number }> {
    this.#ensureReady()
    this.#assertInstanceTenant(workerCaller(input.tenantId))
    bindOrAssertTenant(this.#db, workerCaller(input.tenantId), this.#clock)

    const denial = denyUserAccess(this.#db, this.#clock, {
      clerkUserId: input.clerkUserId,
      reason: input.reason,
      source: input.source,
    })
    const closed = closeUserSockets(
      this.#asDeliverySockets(),
      input.tenantId,
      input.clerkUserId,
      input.reason === 'support_revoked' ? 'support_revoked' : 'membership_revoked',
    )
    return { ok: true, closedConnections: closed, authEpoch: denial.authEpoch }
  }

  async applyTenantSuspended(input: {
    tenantId: string
    source: FenceSource
  }): Promise<{ ok: true; closedConnections: string[]; authEpoch: number }> {
    this.#ensureReady()
    this.#assertInstanceTenant(workerCaller(input.tenantId))
    bindOrAssertTenant(this.#db, workerCaller(input.tenantId), this.#clock)

    const fence = setTenantSuspendedFence(this.#db, this.#clock, true)
    const closed = closeAllSockets(
      this.#asDeliverySockets(),
      input.tenantId,
      'tenant_not_active',
    )
    return { ok: true, closedConnections: closed, authEpoch: fence.authEpoch }
  }

  /** Reativação: limpa fence de tenant; não reabre memberships revogados. */
  async applyTenantReactivated(input: {
    tenantId: string
    source: FenceSource
  }): Promise<{ ok: true; closedConnections: string[]; authEpoch: number }> {
    this.#ensureReady()
    this.#assertInstanceTenant(workerCaller(input.tenantId))
    bindOrAssertTenant(this.#db, workerCaller(input.tenantId), this.#clock)

    const fence = setTenantSuspendedFence(this.#db, this.#clock, false)
    return { ok: true, closedConnections: [], authEpoch: fence.authEpoch }
  }

  /**
   * Test harness: força authority map (cache positivo antigo / unavailable).
   * Não expor em rotas de produto.
   */
  async setAuthorityOverrideForTests(
    grants: Record<string, 'owner' | 'attendant' | 'deny' | 'unavailable'>,
  ): Promise<{ ok: true }> {
    if (!isDevelopmentEnv(this.env)) {
      throw new TenantMismatchError('harness indisponível fora de development')
    }
    this.#ensureReady()
    const map = new Map(
      Object.entries(grants) as Array<[string, 'owner' | 'attendant' | 'deny' | 'unavailable']>,
    )
    this.#authorityOverride = createMapAccessAuthority(map)
    return { ok: true }
  }

  async clearAuthorityOverrideForTests(): Promise<{ ok: true }> {
    this.#authorityOverride = null
    return { ok: true }
  }

  /** Revalida sockets hibernados/ativos sem fan-out de domínio. */
  async revalidateOpenSockets(caller: ClinicCaller): Promise<{
    live: number
    revoked: number
    skippedUnavailable: number
  }> {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    bindOrAssertTenant(this.#db, caller, this.#clock)

    let live = 0
    let revoked = 0
    let skippedUnavailable = 0
    const authority = this.#authority()

    for (const ws of this.#asDeliverySockets()) {
      const attachment = ws.deserializeAttachment()
      if (!attachment || attachment.tenantId !== caller.tenantId) continue

      const decision = await authority.checkMembership(
        attachment.tenantId,
        attachment.clerkUserId,
      )
      if (decision.status === 'unavailable') {
        skippedUnavailable += 1
        continue
      }
      if (decision.status === 'deny') {
        denyUserAccess(this.#db, this.#clock, {
          clerkUserId: attachment.clerkUserId,
          reason: decision.reason,
          source: 'authority_recheck',
        })
        closeUserSockets(
          [ws],
          caller.tenantId,
          attachment.clerkUserId,
          decision.reason,
        )
        revoked += 1
        continue
      }
      live += 1
    }

    return { live, revoked, skippedUnavailable }
  }

  async #fanoutConfigEvent(
    caller: ClinicCaller,
    type: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const evt = appendRealtimeEvent(
      this.#db,
      {
        tenantId: caller.tenantId,
        type,
        entityType,
        entityId,
        payload,
        audience: 'all',
      },
      this.#clock,
    )
    await deliverEventToSockets(
      this.#db,
      this.#asDeliverySockets(),
      evt,
      this.#authority(),
      this.#clock,
    )
  }

  async getConfigSnapshot(caller: ClinicCaller) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicConfig.getConfigSnapshotOp(this.#db, caller, this.#clock)
  }

  async getConfigReadiness(caller: ClinicCaller) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicConfig.getReadinessOp(this.#db, caller, this.#clock)
  }

  /**
   * Espelho do canal WhatsApp (#31). Chamado pelo Worker após bind/release no D1.
   * Não armazena tokens — só estado de UI/readiness.
   */
  async syncWhatsappChannel(
    caller: ClinicCaller,
    input: {
      status: 'disconnected' | 'connected' | 'interrupted'
      bindingId?: string | null
      phoneNumberId?: string | null
      wabaId?: string | null
      displayPhone?: string | null
      displayName?: string | null
      connectedBy?: string | null
      connectedAt?: number | null
      interruptedAt?: number | null
      interruptReason?: string | null
      actor?: string | null
      action: string
    },
  ) {
    this.#ensureReady()
    const tenantId = this.#assertInstanceTenant(caller)
    const row = clinicWhatsapp.syncWhatsappChannel(
      this.#db,
      tenantId,
      input,
      this.#clock,
    )
    // Catálogo sintético de modelos no connect/reconnect (#33; GATE-10 para live).
    if (input.status === 'connected') {
      clinicInbox.seedSyntheticWhatsappTemplates(this.#db, tenantId, this.#clock)
    }
    await this.#fanoutConfigEvent(
      caller,
      'whatsapp.channel_updated',
      'whatsapp_channel',
      tenantId,
      {
        status: row.status,
        phoneNumberId: row.phoneNumberId,
        displayPhone: row.displayPhone,
        interruptedAt: row.interruptedAt,
        interruptReason: row.interruptReason,
      },
    )
    return row
  }

  async listWhatsappTemplates(
    caller: ClinicCaller,
    opts: { approvedOnly?: boolean } = {},
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const meta = bindOrAssertTenant(this.#db, caller, this.#clock)
    if (clinicInbox.listWhatsappTemplates(this.#db, meta.tenantId).length === 0) {
      clinicInbox.seedSyntheticWhatsappTemplates(this.#db, meta.tenantId, this.#clock)
    }
    return clinicInbox.listWhatsappTemplates(this.#db, meta.tenantId, opts)
  }

  async setClinicAiAssistEnabled(caller: ClinicCaller, enabled: boolean) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const settings = clinicConfig.setAiAssistEnabledOp(
      this.#db,
      caller,
      enabled,
      this.#clock,
    )
    await this.#fanoutConfigEvent(
      caller,
      'config.settings_updated',
      'clinic_settings',
      '1',
      { aiAssistEnabled: settings.aiAssistEnabled },
    )
    return settings
  }

  async updateClinicTimezone(caller: ClinicCaller, timezone: string) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const settings = clinicConfig.updateTimezoneOp(
      this.#db,
      caller,
      timezone,
      this.#clock,
    )
    await this.#fanoutConfigEvent(
      caller,
      'config.settings_updated',
      'clinic_settings',
      '1',
      { timezone: settings.timezone },
    )
    return settings
  }

  async upsertClinicService(caller: ClinicCaller, input: UpsertServiceInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const row = clinicConfig.upsertServiceOp(this.#db, caller, input, this.#clock)
    await this.#fanoutConfigEvent(
      caller,
      input.id ? 'config.service_updated' : 'config.service_created',
      'service',
      row.id,
      { name: row.name, active: row.active },
    )
    return row
  }

  async setClinicServiceActive(
    caller: ClinicCaller,
    serviceId: string,
    active: boolean,
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const row = clinicConfig.setServiceActiveOp(
      this.#db,
      caller,
      serviceId,
      active,
      this.#clock,
    )
    await this.#fanoutConfigEvent(
      caller,
      active ? 'config.service_activated' : 'config.service_deactivated',
      'service',
      row.id,
      { active: row.active },
    )
    return row
  }

  async upsertClinicResource(caller: ClinicCaller, input: UpsertResourceInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const row = clinicConfig.upsertResourceOp(this.#db, caller, input, this.#clock)
    await this.#fanoutConfigEvent(
      caller,
      input.id ? 'config.resource_updated' : 'config.resource_created',
      'resource',
      row.id,
      { kind: row.kind, name: row.name, active: row.active },
    )
    return row
  }

  async setClinicResourceActive(
    caller: ClinicCaller,
    resourceId: string,
    active: boolean,
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const row = clinicConfig.setResourceActiveOp(
      this.#db,
      caller,
      resourceId,
      active,
      this.#clock,
    )
    await this.#fanoutConfigEvent(
      caller,
      active ? 'config.resource_activated' : 'config.resource_deactivated',
      'resource',
      row.id,
      {
        active: row.active,
        futureAppointmentCount: row.futureAppointmentCount,
        servicesWithoutResource: row.servicesWithoutResource,
      },
    )
    return row
  }

  async setClinicWeeklyWindows(caller: ClinicCaller, input: SetWeeklyWindowsInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const windows = clinicConfig.setWeeklyWindowsOp(
      this.#db,
      caller,
      input,
      this.#clock,
    )
    await this.#fanoutConfigEvent(
      caller,
      'config.weekly_updated',
      'resource',
      input.resourceId,
      { windowCount: windows.length },
    )
    return windows
  }

  async createClinicBlock(caller: ClinicCaller, input: CreateBlockInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicConfig.createBlockOp(this.#db, caller, input, this.#clock)
    if (result.created && result.block) {
      await this.#fanoutConfigEvent(
        caller,
        'config.block_created',
        'resource_block',
        result.block.id,
        {
          resourceId: result.block.resourceId,
          affectedCount: result.affectedAppointments.length,
        },
      )
    }
    return result
  }

  async deleteClinicBlock(caller: ClinicCaller, blockId: string) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicConfig.deleteBlockOp(this.#db, caller, blockId, this.#clock)
    await this.#fanoutConfigEvent(
      caller,
      'config.block_deleted',
      'resource_block',
      blockId,
      {},
    )
    return result
  }

  async insertSyntheticAppointmentForTests(
    caller: ClinicCaller,
    input: {
      serviceId: string
      professionalId: string
      roomResourceId?: string | null
      startsAt: number
      endsAt: number
      contactLabel?: string | null
    },
  ) {
    if (!isDevelopmentEnv(this.env)) {
      throw new TenantMismatchError('harness indisponível fora de development')
    }
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    bindOrAssertTenant(this.#db, caller, this.#clock)
    return clinicConfig.insertSyntheticAppointment(
      this.#db,
      caller.tenantId,
      input,
      this.#clock,
    )
  }

  /** Consulta de disponibilidade (#35) — leitura pura, sem reserva. */
  async queryClinicAvailability(caller: ClinicCaller, input: AvailabilityQueryInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicScheduling.queryAvailabilityOp(this.#db, caller, input, this.#clock)
  }

  /** Revalidação de horário (#35; usada no confirmar #36). */
  async checkClinicSlot(caller: ClinicCaller, input: CheckSlotInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicScheduling.checkSlotAvailabilityOp(
      this.#db,
      caller,
      input,
      this.#clock,
    )
  }


  /** Confirmação atómica (#36 / REQ-031) — TX: apt + alocações + histórico + outbox. */
  async confirmClinicAppointment(
    caller: ClinicCaller,
    input: ConfirmAppointmentInput,
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicScheduling.confirmAppointmentOp(
      this.#db,
      caller,
      input,
      this.#clock,
    )
    if (result.outbox.length > 0) {
      await this.#fanoutOutboxes(caller, result.outbox, true)
      await this.#drain(caller)
    }
    return result
  }

  async cancelClinicAppointment(
    caller: ClinicCaller,
    input: CancelAppointmentInput,
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicScheduling.cancelAppointmentOp(
      this.#db,
      caller,
      input,
      this.#clock,
    )
    if (result.outbox.length > 0) {
      await this.#fanoutOutboxes(caller, result.outbox, true)
      await this.#drain(caller)
    }
    return result
  }

  async rescheduleClinicAppointment(
    caller: ClinicCaller,
    input: RescheduleAppointmentInput,
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicScheduling.rescheduleAppointmentOp(
      this.#db,
      caller,
      input,
      this.#clock,
    )
    if (result.outbox.length > 0) {
      await this.#fanoutOutboxes(caller, result.outbox, true)
      await this.#drain(caller)
    }
    return result
  }

  async getClinicAppointment(caller: ClinicCaller, appointmentId: string) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicScheduling.getAppointmentDetailOp(
      this.#db,
      caller,
      appointmentId,
      this.#clock,
    )
  }

  async queryClinicAgenda(caller: ClinicCaller, input: AgendaViewInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    await this.#sweepHolds(caller)
    return clinicScheduling.queryAgendaViewOp(this.#db, caller, input, this.#clock)
  }

  /** Reserva por bloco — vence blocos cujo período passou e agenda o próximo. */
  async #sweepHolds(caller: ClinicCaller): Promise<void> {
    try {
      const swept = clinicScheduling.sweepExpiredHoldsOp(this.#db, caller, this.#clock)
      if (swept.outbox.length > 0) {
        await this.#fanoutOutboxes(caller, swept.outbox, true)
        await this.#drain(caller)
      }
      const next = clinicScheduling.nextHoldExpiryAt(this.#db, caller.tenantId)
      if (next != null) await this.#scheduleAlarmNoLaterThan(next + 1_000)
    } catch {
      /* best-effort: leitura segue */
    }
  }

  async #afterHoldMutation(caller: ClinicCaller, outbox: OutboxRow[]): Promise<void> {
    if (outbox.length > 0) {
      await this.#fanoutOutboxes(caller, outbox, true)
      await this.#drain(caller)
    }
    const next = clinicScheduling.nextHoldExpiryAt(this.#db, caller.tenantId)
    if (next != null) await this.#scheduleAlarmNoLaterThan(next + 1_000)
  }

  async previewClinicHold(caller: ClinicCaller, input: HoldPreviewInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicScheduling.previewHoldOp(this.#db, caller, input, this.#clock)
  }

  async createClinicHold(caller: ClinicCaller, input: CreateHoldInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    await this.#sweepHolds(caller)
    const result = clinicScheduling.createHoldOp(this.#db, caller, input, this.#clock)
    await this.#afterHoldMutation(caller, result.outbox)
    return result
  }

  async resolveClinicHold(caller: ClinicCaller, input: ResolveHoldInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicScheduling.resolveHoldOp(this.#db, caller, input, this.#clock)
    await this.#afterHoldMutation(caller, result.outbox)
    return result
  }

  async cancelClinicHold(caller: ClinicCaller, input: CancelHoldInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicScheduling.cancelHoldOp(this.#db, caller, input, this.#clock)
    await this.#afterHoldMutation(caller, result.outbox)
    return result
  }

  async listClinicHolds(caller: ClinicCaller, input: ListHoldsInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    await this.#sweepHolds(caller)
    return clinicScheduling.listHoldsOp(this.#db, caller, input, this.#clock)
  }

  async listClinicHoldAlerts(caller: ClinicCaller) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    await this.#sweepHolds(caller)
    return clinicScheduling.listHoldAlertsOp(this.#db, caller, this.#clock)
  }

  async dismissClinicHoldAlert(
    caller: ClinicCaller,
    input: { holdId: string; actorClerkUserId: string },
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicScheduling.dismissHoldAlertOp(this.#db, caller, input, this.#clock)
    await this.#afterHoldMutation(caller, result.outbox)
    return result
  }

  /** Conta Pix + sinais (#37) + cobrança na conversa (#38). */
  async getPixAccount(caller: ClinicCaller) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicPix.getPixAccountOp(this.#db, caller, this.#clock)
  }

  async connectPixAccount(
    caller: ClinicCaller,
    input: ConnectPixInput,
    deps: PixConnectDeps,
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const account = await clinicPix.connectPixAccountOp(
      this.#db,
      caller,
      input,
      this.#clock,
      deps,
    )
    await this.#fanoutConfigEvent(
      caller,
      'pix.account_connected',
      'pix_account',
      account.accountId ?? '1',
      { status: account.status, credentialVersion: account.credentialVersion },
    )
    return account
  }

  async disconnectPixAccount(caller: ClinicCaller) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicPix.disconnectPixAccountOp(this.#db, caller, this.#clock)
    await this.#fanoutConfigEvent(
      caller,
      'pix.account_disconnected',
      'pix_account',
      result.account.accountId ?? '1',
      { chargesPreserved: result.chargesPreserved },
    )
    return result
  }

  async revokePixCredential(caller: ClinicCaller, reason: string) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const account = clinicPix.revokePixCredentialOp(
      this.#db,
      caller,
      reason,
      this.#clock,
    )
    await this.#fanoutConfigEvent(
      caller,
      'pix.credential_revoked',
      'pix_account',
      account.accountId ?? '1',
      { status: account.status },
    )
    return account
  }

  async getPixSignalSettings(caller: ClinicCaller) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicPix.getPixSignalSettingsOp(this.#db, caller, this.#clock)
  }

  async updatePixSignalSettings(
    caller: ClinicCaller,
    input: UpdateSignalSettingsInput,
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const settings = clinicPix.updatePixSignalSettingsOp(
      this.#db,
      caller,
      input,
      this.#clock,
    )
    await this.#fanoutConfigEvent(
      caller,
      'pix.signal_settings_updated',
      'clinic_settings',
      '1',
      { deadlineSeconds: settings.deadlineSeconds },
    )
    return settings
  }

  async listPixCharges(caller: ClinicCaller, accountId?: string) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicPix.listPixChargesOp(this.#db, caller, this.#clock, accountId)
  }

  async recordPixChargeForTests(caller: ClinicCaller, input: RecordChargeInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicPix.recordLocalPixChargeOp(this.#db, caller, input, this.#clock)
  }

  /**
   * Cria cobrança + envia sinal WhatsApp sem alocar horário (#38 / AC-46).
   * Adaptador: Woovi via deps, ou Simulated injectável nos testes do DO.
   */
  async createSignalChargeAndSend(
    caller: ClinicCaller,
    input: CreateSignalChargeInput,
    deps: PixConnectDeps & { simulatedAdapter?: PixProviderAdapter },
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const adapter = deps.simulatedAdapter
      ? deps.simulatedAdapter
      : (await clinicPix.buildClinicPixAdapter(this.#db, caller.tenantId, deps))
          .adapter
    const result = await clinicPix.createSignalChargeAndSendOp(
      this.#db,
      caller,
      input,
      this.#clock,
      { adapter },
    )
    if (result.outbox.length > 0) {
      await this.#fanoutOutboxes(caller, result.outbox, true)
      await this.#drain(caller)
    }
    await this.#scheduleNextPixExpiry(caller)
    return result
  }

  async reconcilePixChargeCreate(
    caller: ClinicCaller,
    chargeId: string,
    deps: PixConnectDeps & {
      simulatedAdapter?: PixProviderAdapter & {
        findChargeByIdempotencyKey?(
          key: string,
        ): Promise<
          | { ok: true; value: import('../pix').PixCharge }
          | { ok: false; code?: string; message?: string }
        >
      }
    },
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const adapter = deps.simulatedAdapter
      ? deps.simulatedAdapter
      : (await clinicPix.buildClinicPixAdapter(this.#db, caller.tenantId, deps))
          .adapter
    const findByIdempotencyKey = deps.simulatedAdapter?.findChargeByIdempotencyKey
      ? (key: string) =>
          deps.simulatedAdapter!.findChargeByIdempotencyKey!(key) as Promise<
            | { ok: true; value: import('../pix').PixCharge }
            | { ok: false }
          >
      : undefined
    return clinicPix.reconcileUncertainChargeOp(
      this.#db,
      caller,
      chargeId,
      this.#clock,
      { adapter, findByIdempotencyKey },
    )
  }

  async confirmAppointmentWithoutSignal(
    caller: ClinicCaller,
    input: ConfirmWithoutSignalInput,
    deps?: PixConnectDeps & { simulatedAdapter?: PixProviderAdapter },
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    let adapterDeps: { adapter: PixProviderAdapter } | undefined
    if (deps?.simulatedAdapter) {
      adapterDeps = { adapter: deps.simulatedAdapter }
    } else if (deps) {
      try {
        const built = await clinicPix.buildClinicPixAdapter(
          this.#db,
          caller.tenantId,
          deps,
        )
        adapterDeps = { adapter: built.adapter }
      } catch {
        adapterDeps = undefined
      }
    }
    const result = await clinicPix.confirmWithoutSignalOp(
      this.#db,
      caller,
      input,
      this.#clock,
      adapterDeps,
    )
    if (result.outbox.length > 0) {
      await this.#fanoutOutboxes(caller, result.outbox, true)
      await this.#drain(caller)
    }
    return result
  }

  async getPixChargeDetail(caller: ClinicCaller, chargeId: string) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicPix.getPixChargeDetailOp(this.#db, caller, chargeId, this.#clock)
  }

  async listConversationPixCharges(caller: ClinicCaller, conversationId: string) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicPix.listConversationPixChargesOp(
      this.#db,
      caller,
      conversationId,
      this.#clock,
    )
  }

  /**
   * Pagamento Pix validado (#39) — regista pagamento e disputa slot na mesma TX.
   */
  async processPixPayment(caller: ClinicCaller, input: ProcessPixPaymentInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicPix.processPixPaymentOp(
      this.#db,
      caller,
      input,
      this.#clock,
    )
    if (result.outbox.length > 0) {
      await this.#fanoutOutboxes(caller, result.outbox, true)
      await this.#drain(caller)
    }
    return result
  }

  async listOpenPixPaymentAlerts(
    caller: ClinicCaller,
    conversationId?: string,
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicPix.listOpenPaymentAlertsOp(
      this.#db,
      caller,
      this.#clock,
      conversationId,
    )
  }

  async #resolvePixAdapter(
    caller: ClinicCaller,
    deps?: PixConnectDeps & { simulatedAdapter?: PixProviderAdapter },
  ): Promise<PixProviderAdapter | undefined> {
    if (deps?.simulatedAdapter) return deps.simulatedAdapter
    if (!deps) return undefined
    try {
      const built = await clinicPix.buildClinicPixAdapter(
        this.#db,
        caller.tenantId,
        deps,
      )
      return built.adapter
    } catch {
      return undefined
    }
  }

  async #scheduleNextPixExpiry(caller: ClinicCaller): Promise<void> {
    const next = clinicPix.peekNextPixExpiryOp(this.#db, caller, this.#clock)
    if (next != null) {
      await this.#scheduleAlarmNoLaterThan(next)
    }
  }

  /** Expirar cobranças vencidas (#40) — local + provedor. */
  async expireDuePixCharges(
    caller: ClinicCaller,
    deps?: PixConnectDeps & { simulatedAdapter?: PixProviderAdapter },
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const adapter = await this.#resolvePixAdapter(caller, deps)
    const result = await clinicPix.expireDueChargesOp(
      this.#db,
      caller,
      this.#clock,
      { adapter },
    )
    const outboxes = result.expired.flatMap((e) => e.outbox)
    if (outboxes.length > 0) {
      await this.#fanoutOutboxes(caller, outboxes, true)
      await this.#drain(caller)
    }
    await this.#scheduleNextPixExpiry(caller)
    return result
  }

  async cancelUnpaidPixCharge(
    caller: ClinicCaller,
    input: CancelUnpaidChargeInput,
    deps?: PixConnectDeps & { simulatedAdapter?: PixProviderAdapter },
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const adapter = await this.#resolvePixAdapter(caller, deps)
    const result = await clinicPix.cancelUnpaidChargeOp(
      this.#db,
      caller,
      input,
      this.#clock,
      { adapter },
    )
    if (result.outbox.length > 0) {
      await this.#fanoutOutboxes(caller, result.outbox, true)
      await this.#drain(caller)
    }
    await this.#scheduleNextPixExpiry(caller)
    return result
  }

  async resolvePixAlertAltSlot(
    caller: ClinicCaller,
    input: ResolveAlertAltSlotInput,
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicPix.resolveAlertAltSlotOp(
      this.#db,
      caller,
      input,
      this.#clock,
    )
    if (result.outbox.length > 0) {
      await this.#fanoutOutboxes(caller, result.outbox, true)
      await this.#drain(caller)
    }
    return result
  }

  async resolvePixAlertRefund(
    caller: ClinicCaller,
    input: ResolveAlertRefundInput,
    deps: PixConnectDeps & { simulatedAdapter?: PixProviderAdapter },
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const adapter = await this.#resolvePixAdapter(caller, deps)
    if (!adapter) {
      throw new Error('pix_adapter_unavailable')
    }
    const result = await clinicPix.resolveAlertRefundOp(
      this.#db,
      caller,
      input,
      this.#clock,
      { adapter },
    )
    if (result.outbox.length > 0) {
      await this.#fanoutOutboxes(caller, result.outbox, true)
      await this.#drain(caller)
    }
    return result
  }

  async requestPixRefund(
    caller: ClinicCaller,
    input: RequestRefundInput,
    deps: PixConnectDeps & { simulatedAdapter?: PixProviderAdapter },
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const adapter = await this.#resolvePixAdapter(caller, deps)
    if (!adapter) {
      throw new Error('pix_adapter_unavailable')
    }
    const result = await clinicPix.requestRefundOp(
      this.#db,
      caller,
      input,
      this.#clock,
      { adapter },
    )
    if (result.outbox.length > 0) {
      await this.#fanoutOutboxes(caller, result.outbox, true)
      await this.#drain(caller)
    }
    return result
  }

  async cancelPaidAppointmentWithSignal(
    caller: ClinicCaller,
    input: CancelPaidWithSignalInput,
    deps?: PixConnectDeps & { simulatedAdapter?: PixProviderAdapter },
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const adapter = await this.#resolvePixAdapter(caller, deps)
    const result = await clinicPix.cancelPaidAppointmentWithSignalOp(
      this.#db,
      caller,
      input,
      this.#clock,
      { adapter },
    )
    if (result.outbox.length > 0) {
      await this.#fanoutOutboxes(caller, result.outbox, true)
      await this.#drain(caller)
    }
    return result
  }

  async getPaidSignalForAppointment(
    caller: ClinicCaller,
    appointmentId: string,
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicPix.getPaidSignalForAppointmentOp(
      this.#db,
      caller,
      appointmentId,
      this.#clock,
    )
  }

  /**
   * Webhooks charge.expired / charge.cancelled / refund.updated (#40).
   */
  async processPixLifecycle(
    caller: ClinicCaller,
    input: ProcessPixLifecycleInput,
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    if (
      input.eventType === 'charge.expired' ||
      input.eventType === 'charge.cancelled'
    ) {
      const result = clinicPix.processPixLifecycleExpireCancelOp(
        this.#db,
        caller,
        input,
        this.#clock,
      )
      if (result.outbox.length > 0) {
        await this.#fanoutOutboxes(caller, result.outbox, true)
        await this.#drain(caller)
      }
      await this.#scheduleNextPixExpiry(caller)
      return result
    }
    const result = clinicPix.processPixLifecycleRefundOp(
      this.#db,
      caller,
      input,
      this.#clock,
    )
    if (result.outbox.length > 0) {
      await this.#fanoutOutboxes(caller, result.outbox, true)
      await this.#drain(caller)
    }
    return result
  }

  async #drain(
    caller: ClinicCaller,
    opts?: { delayed: ReadonlySet<string>; delaySeconds: number },
  ): Promise<{ published: string[]; failed: string[] }> {
    const queue = this.env.INBOUND_EVENTS
    return publishPendingEffects(
      this.#db,
      caller,
      {
        async publish(envelope: EventEnvelope) {
          const sendOpts = opts?.delayed.has(envelope.eventId)
            ? { delaySeconds: opts.delaySeconds }
            : undefined
          await queue.send({
            source: 'clinic_outbox',
            tenantId: envelope.tenantId,
            eventId: envelope.eventId,
            type: envelope.type,
            idempotencyKey: envelope.idempotencyKey,
            entity: envelope.entity,
            occurredAt: envelope.occurredAt,
            payload: envelope.payload,
          }, sendOpts)
        },
      },
      this.#clock,
    )
  }

  async alarm(): Promise<void> {
    this.#ensureReady()
    const meta = getBoundTenant(this.#db)
    if (!meta) return
    const caller = workerCaller(meta.tenantId)
    try {
      // Expiração local (#40) — sem adapter se credencial indisponível; marca local.
      await this.expireDuePixCharges(caller)
    } catch {
      /* best-effort: drain outbox mesmo assim */
    }
    const nextSweep = await this.#sweepStuckOutbound(caller)
    await this.#sweepHolds(caller)
    await this.#drain(caller)
    if (nextSweep != null) await this.#scheduleAlarmNoLaterThan(nextSweep + 1_000)
  }

  async fetch(request: Request): Promise<Response> {
    this.#ensureReady()
    const upgrade = request.headers.get('Upgrade')
    if (upgrade?.toLowerCase() === 'websocket') {
      return this.#acceptProductWebSocket(request)
    }

    const url = new URL(request.url)
    if (url.pathname.endsWith('/ping')) {
      const tenantId = request.headers.get('x-tenant-id') ?? 'unknown'
      try {
        return Response.json(await this.ping(tenantId))
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : 'ping_failed' },
          { status: 400 },
        )
      }
    }

    return Response.json({ error: 'not_found', phase: 'f1-clinic-do' }, { status: 404 })
  }

  async #parseWsIdentity(request: Request): Promise<WsUpgradeIdentity | Response> {
    const assertion = request.headers.get(WS_INTERNAL_HEADERS.assertion)
    if (assertion !== WORKER_WS_ASSERTION) {
      return Response.json({ error: 'unauthorized_ws' }, { status: 403 })
    }
    const ticket = request.headers.get(WS_TICKET_HEADER)
    if (ticket !== null) {
      const tenantId = request.headers.get(WS_INTERNAL_HEADERS.tenantId)
      if (!tenantId) {
        return Response.json({ error: 'invalid_ws_identity' }, { status: 400 })
      }
      try {
        this.#assertInstanceTenant(workerCaller(tenantId))
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : 'tenant_mismatch' },
          { status: 403 },
        )
      }
      const redeemed = await redeemWsTicket(
        this.#ticketStorage(),
        ticket,
        tenantId,
        this.#clock.nowMs(),
      )
      if (!redeemed.ok) {
        return Response.json({ error: redeemed.reason }, { status: 401 })
      }
      return {
        tenantId,
        clerkUserId: redeemed.grant.clerkUserId,
        sessionId: redeemed.grant.sessionId,
        role: redeemed.grant.role,
      }
    }
    const tenantId = request.headers.get(WS_INTERNAL_HEADERS.tenantId)
    const clerkUserId = request.headers.get(WS_INTERNAL_HEADERS.clerkUserId)
    const sessionId = request.headers.get(WS_INTERNAL_HEADERS.sessionId)
    const role = request.headers.get(WS_INTERNAL_HEADERS.role)
    if (!tenantId || !clerkUserId || !sessionId || (role !== 'owner' && role !== 'attendant')) {
      return Response.json({ error: 'invalid_ws_identity' }, { status: 400 })
    }
    try {
      this.#assertInstanceTenant(workerCaller(tenantId))
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : 'tenant_mismatch' },
        { status: 403 },
      )
    }
    return { tenantId, clerkUserId, sessionId, role }
  }

  async #acceptProductWebSocket(request: Request): Promise<Response> {
    const identityOrErr = await this.#parseWsIdentity(request)
    if (identityOrErr instanceof Response) {
      // Harness legado F0: sem headers internos → eco mínimo (sem fan-out clínico).
      if (!request.headers.get(WS_INTERNAL_HEADERS.assertion) && isDevelopmentEnv(this.env)) {
        return this.#acceptHarnessEcho()
      }
      return identityOrErr
    }

    const identity = identityOrErr
    bindOrAssertTenant(this.#db, workerCaller(identity.tenantId), this.#clock)
    const fence = ensureRealtimeFence(this.#db, this.#clock)

    // Revalidação D1 no accept (não confiar só no Worker se fence local já nega).
    const decision = await this.#authority().checkMembership(
      identity.tenantId,
      identity.clerkUserId,
    )
    if (decision.status === 'unavailable') {
      return Response.json({ error: 'authority_unavailable' }, { status: 503 })
    }
    if (decision.status === 'deny') {
      return Response.json({ error: decision.reason }, { status: 403 })
    }
    // Role autoritativa = D1 no momento do accept (não a do bilhete/header).
    const role: 'owner' | 'attendant' =
      decision.role === 'owner' || decision.role === 'attendant' ? decision.role : identity.role

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    const connectionId = newId('ws')
    const attachment: SocketAttachment = {
      connectionId,
      clerkUserId: identity.clerkUserId,
      sessionId: identity.sessionId,
      role,
      tenantId: identity.tenantId,
      authEpoch: fence.authEpoch,
      connectedAt: this.#clock.nowMs(),
    }

    this.ctx.acceptWebSocket(server, [identity.clerkUserId, identity.tenantId])
    server.serializeAttachment(attachment)

    server.send(
      encodeServerMessage({
        v: 1,
        type: 'hello',
        connectionId,
        tenantId: identity.tenantId,
        eventSeq: fence.lastEventSeq,
        role,
        connectionState: 'live',
      }),
    )

    return new Response(null, { status: 101, webSocket: client })
  }

  /** IA assistiva (#41) — sob demanda; nunca envia WhatsApp. */
  async suggestAiReply(
    caller: ClinicCaller,
    input: SuggestReplyInput,
    rpcDeps: AiAssistRpcDeps,
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const deps = clinicAi.toAiAssistDeps(rpcDeps)
    return clinicAi.suggestReplyOp(this.#db, caller, input, this.#clock, deps)
  }

  async summarizeAiConversation(
    caller: ClinicCaller,
    input: SummarizeInput,
    rpcDeps: AiAssistRpcDeps,
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const deps = clinicAi.toAiAssistDeps(rpcDeps)
    return clinicAi.summarizeConversationOp(
      this.#db,
      caller,
      input,
      this.#clock,
      deps,
    )
  }

  async decideAiSuggestion(caller: ClinicCaller, input: DecideSuggestionInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicAi.decideSuggestionOp(this.#db, caller, input, this.#clock)
  }

  async listAiSuggestions(
    caller: ClinicCaller,
    conversationId: string,
    opts: { kind?: 'reply' | 'summary'; limit?: number } = {},
  ) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicAi.listConversationSuggestionsOp(
      this.#db,
      caller,
      conversationId,
      this.#clock,
      opts,
    )
  }

  async getAiSuggestion(caller: ClinicCaller, suggestionId: string) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return clinicAi.getSuggestionOp(this.#db, caller, suggestionId, this.#clock)
  }

  #acceptHarnessEcho(): Response {
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ harness: true, phase: 'f1' })
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message)
    const attachment = (() => {
      try {
        return ws.deserializeAttachment() as SocketAttachment | { harness?: boolean } | null
      } catch {
        return null
      }
    })()

    // Eco de harness F0/F1 — sem fan-out clínico.
    if (attachment && 'harness' in attachment && attachment.harness) {
      ws.send(JSON.stringify({ echo: text, phase: 'f1' }))
      return
    }

    const parsed = parseClientMessage(text)
    if (parsed?.type === 'ping') {
      ws.send(JSON.stringify({ v: 1, type: 'pong' }))
      return
    }
    if (parsed?.type === 'presence') {
      if (attachment && 'clerkUserId' in attachment) {
        ws.serializeAttachment({
          ...attachment,
          visible: parsed.visible,
          presenceAt: this.#clock.nowMs(),
        } satisfies SocketAttachment)
      }
      return
    }

    ws.send(
      encodeServerMessage({
        v: 1,
        type: 'error',
        code: 'unknown_message',
        message: 'mensagem não reconhecida',
      }),
    )
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    void wasClean
    try {
      ws.close(code, reason)
    } catch {
      // Já fechado.
    }
  }
}
