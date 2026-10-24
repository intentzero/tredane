import { DurableObject } from 'cloudflare:workers'
import {
  acknowledgeOutboxResult,
  assertSyntheticTenantId,
  bindOrAssertTenant,
  clinicAttachments,
  clinicConfig,
  clinicInbox,
  clinicPipeline,
  clinicWhatsapp,
  fromDurableObjectSql,
  getBoundTenant,
  ingestContactMessage,
  listContacts,
  listPendingOutbox,
  publishPendingEffects,
  runClinicMigrations,
  TenantMismatchError,
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
  setTenantSuspendedFence,
  WORKER_WS_ASSERTION,
  WS_INTERNAL_HEADERS,
  type AccessAuthority,
  type DeliverySocket,
  type FenceSource,
  type SocketAttachment,
} from '../realtime'
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
    assertSyntheticTenantId(name)
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
    contactId: string
    conversationId: string | null
    messageId: string | null
    inboundId: string
    outboxId: string | null
    eventSeq: number | null
    drained: string[]
    fanout: { delivered: string[]; revoked: string[]; skippedUnavailable: string[] } | null
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
      contactId: result.contact.id,
      conversationId: result.conversation?.id ?? null,
      messageId: result.message?.id ?? null,
      inboundId: result.inbound.id,
      outboxId: result.outbox?.id ?? null,
      eventSeq,
      drained,
      fanout: fanoutResult,
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

  async sendInboxOutbound(caller: ClinicCaller, input: SendOutboundInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = clinicInbox.sendOutboundMessageOp(this.#db, caller, input, this.#clock)
    await this.#fanoutOutboxes(caller, result.outbox, true)
    await this.#drain(caller)
    return result.value
  }

  async seedInboxDemo(caller: ClinicCaller, opts: { force?: boolean } = {}) {
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

  async listPipelineOpportunities(caller: ClinicCaller, input: ListOpportunitiesInput) {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
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
    assertSyntheticTenantId(input.tenantId)
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
    assertSyntheticTenantId(input.tenantId)
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
    assertSyntheticTenantId(input.tenantId)
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

  async #drain(caller: ClinicCaller): Promise<{ published: string[]; failed: string[] }> {
    const queue = this.env.INBOUND_EVENTS
    return publishPendingEffects(
      this.#db,
      caller,
      {
        async publish(envelope: EventEnvelope) {
          await queue.send({
            source: 'clinic_outbox',
            tenantId: envelope.tenantId,
            eventId: envelope.eventId,
            type: envelope.type,
            idempotencyKey: envelope.idempotencyKey,
            entity: envelope.entity,
            occurredAt: envelope.occurredAt,
            payload: envelope.payload,
          })
        },
      },
      this.#clock,
    )
  }

  async alarm(): Promise<void> {
    this.#ensureReady()
    const meta = getBoundTenant(this.#db)
    if (!meta) return
    await this.#drain(workerCaller(meta.tenantId))
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

  #parseWsIdentity(request: Request): WsUpgradeIdentity | Response {
    const assertion = request.headers.get(WS_INTERNAL_HEADERS.assertion)
    if (assertion !== WORKER_WS_ASSERTION) {
      return Response.json({ error: 'unauthorized_ws' }, { status: 403 })
    }
    const tenantId = request.headers.get(WS_INTERNAL_HEADERS.tenantId)
    const clerkUserId = request.headers.get(WS_INTERNAL_HEADERS.clerkUserId)
    const sessionId = request.headers.get(WS_INTERNAL_HEADERS.sessionId)
    const role = request.headers.get(WS_INTERNAL_HEADERS.role)
    if (!tenantId || !clerkUserId || !sessionId || (role !== 'owner' && role !== 'attendant')) {
      return Response.json({ error: 'invalid_ws_identity' }, { status: 400 })
    }
    try {
      assertSyntheticTenantId(tenantId)
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
    const identityOrErr = this.#parseWsIdentity(request)
    if (identityOrErr instanceof Response) {
      // Harness legado F0: sem headers internos → eco mínimo (sem fan-out clínico).
      if (!request.headers.get(WS_INTERNAL_HEADERS.assertion)) {
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

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    const connectionId = newId('ws')
    const attachment: SocketAttachment = {
      connectionId,
      clerkUserId: identity.clerkUserId,
      sessionId: identity.sessionId,
      role: identity.role,
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
        role: identity.role,
        connectionState: 'live',
      }),
    )

    return new Response(null, { status: 101, webSocket: client })
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
