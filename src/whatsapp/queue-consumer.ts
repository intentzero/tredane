/**
 * Consumer da fila INBOUND_EVENTS (#32/#33).
 * whatsapp_webhook → DO ingest (dedup) / status / interrupção.
 * clinic_outbox → envio Meta + reconciliação (`whatsapp.send`).
 */
import { queueCaller, workerCaller } from '../clinic'
import { systemClock, type Clock } from '../db/clock'
import { createChannelLogger } from '../ops/log'
import type { WorkerBindings } from '../worker/bindings'
import { createD1WebhookOps, type D1WebhookOps } from './webhook-d1'
import {
  isClinicOutboxMessage,
  isPixWebhookMessage,
  isWhatsappWebhookMessage,
  type InboundQueueMessage,
  type PixWebhookQueueMessage,
  type WhatsappWebhookQueueMessage,
} from './queue-types'
import { createD1PixWebhookOps, type D1PixWebhookOps } from '../pix/webhook-d1'
import {
  markPixWebhookReceiptFailed,
  markPixWebhookReceiptProcessed,
} from '../pix/webhook-receipts'
import type { AdminDb } from '../db/admin/store'
import {
  getWebhookReceiptById,
  markWebhookReceiptFailed,
  markWebhookReceiptProcessed,
} from './webhook-receipts'
import { markBindingInterrupted } from './bindings'
import type { ClinicDurableObject } from '../worker/clinic-do'
import {
  processClinicOutboxMessage,
  type OutboundSendClinicStub,
} from './outbound-send'
import type { MetaAdapter } from './meta'
import {
  ingestWhatsappMediaMessage,
  type MediaIngestClinicStub,
} from './media-ingest'
import type { MetaMediaAdapter } from './media'
import { assertTenantAcceptsClinicalIngest } from '../retention/guards'
import { createD1FlowOps } from './flow/flow-d1'
import {
  consumeFlowToken,
  getFlowToken,
  isFlowTokenUsable,
} from './flow/tokens'
import { parseNfmResponseJson } from './flow/nfm-reply'
import { INBOUND_INLINE_BUDGET_MS } from './webhook-routes'

export type QueueConsumerDeps = {
  env: WorkerBindings
  clock?: Clock
  /** Testes: AdminDb sync + stub do DO. */
  syncAdminDb?: AdminDb | null
  webhookOps?: D1WebhookOps
  pixWebhookOps?: D1PixWebhookOps
  clinicStub?: (tenantId: string) => {
    ingestMessage: (
      ...args: Parameters<ClinicDurableObject['ingestMessage']>
    ) => ReturnType<ClinicDurableObject['ingestMessage']> | Promise<unknown>
    applyWhatsappInterrupt: (
      ...args: Parameters<ClinicDurableObject['applyWhatsappInterrupt']>
    ) => ReturnType<ClinicDurableObject['applyWhatsappInterrupt']> | Promise<unknown>
    recordInboundStatus: (
      ...args: Parameters<ClinicDurableObject['recordInboundStatus']>
    ) => ReturnType<ClinicDurableObject['recordInboundStatus']> | Promise<unknown>
    processPixPayment?: (
      ...args: Parameters<ClinicDurableObject['processPixPayment']>
    ) => ReturnType<ClinicDurableObject['processPixPayment']> | Promise<unknown>
    processPixLifecycle?: (
      ...args: Parameters<ClinicDurableObject['processPixLifecycle']>
    ) => ReturnType<ClinicDurableObject['processPixLifecycle']> | Promise<unknown>
    createPendingAttachment?: MediaIngestClinicStub['createPendingAttachment']
    markAttachmentReady?: MediaIngestClinicStub['markAttachmentReady']
    markAttachmentFailed?: MediaIngestClinicStub['markAttachmentFailed']
    linkAttachmentToMessage?: MediaIngestClinicStub['linkAttachmentToMessage']
    handleProposalButtonClick?: (
      ...args: Parameters<ClinicDurableObject['handleProposalButtonClick']>
    ) => ReturnType<ClinicDurableObject['handleProposalButtonClick']> | Promise<unknown>
    handleFlowNfmReply?: (
      ...args: Parameters<ClinicDurableObject['handleFlowNfmReply']>
    ) => ReturnType<ClinicDurableObject['handleFlowNfmReply']> | Promise<unknown>
  } & Partial<OutboundSendClinicStub>
  metaAdapter?: MetaAdapter
  mediaAdapter?: MetaMediaAdapter
  log?: (entry: {
    level: 'info' | 'warn' | 'error'
    event: string
    detail: Record<string, unknown>
  }) => void
}

const defaultLog = createChannelLogger('inbound_queue')

function clinicFromEnv(env: WorkerBindings, tenantId: string) {
  const id = env.CLINIC.idFromName(tenantId)
  return env.CLINIC.get(id)
}

export async function processWhatsappMessage(
  deps: QueueConsumerDeps,
  msg: WhatsappWebhookQueueMessage,
  attempts: number,
): Promise<'ack' | 'retry'> {
  const clock = deps.clock ?? systemClock
  const log = deps.log ?? defaultLog
  const turnStartedMs = clock.nowMs()

  if (msg.__poison) {
    log({
      level: 'error',
      event: 'queue.poison',
      detail: {
        receiptId: msg.receiptId,
        tenantId: msg.tenantId,
        attempts,
      },
    })
    if (deps.syncAdminDb) {
      markWebhookReceiptFailed(deps.syncAdminDb, msg.receiptId, 'poison')
    } else {
      const ops = deps.webhookOps ?? createD1WebhookOps(deps.env.DB, clock)
      await ops.markFailed(msg.receiptId, 'poison')
    }
    // retry até max_retries → DLQ
    return 'retry'
  }

  try {
    // #43: tenant purgado / em exclusão — ack sem mutar clínica (anti-reintrodução).
    if (deps.syncAdminDb) {
      const gate = assertTenantAcceptsClinicalIngest(deps.syncAdminDb, msg.tenantId)
      if (!gate.ok) {
        log({
          level: 'info',
          event: 'queue.skip_tenant_gate',
          detail: {
            receiptId: msg.receiptId,
            tenantId: msg.tenantId,
            reason: gate.reason,
          },
        })
        markWebhookReceiptProcessed(deps.syncAdminDb, msg.receiptId, clock, {
          skipped: gate.reason,
        })
        return 'ack'
      }
    }

    const stub =
      deps.clinicStub?.(msg.tenantId) ?? clinicFromEnv(deps.env, msg.tenantId)
    const caller = queueCaller(msg.tenantId)

    if (msg.kind === 'status') {
      await stub.recordInboundStatus(caller, {
        providerEventKey: msg.providerEventKey,
        statusMessageId: msg.statusMessageId ?? '',
        status: msg.status ?? 'unknown',
        providerTimestamp: msg.providerTimestamp ?? null,
      })
    } else if (msg.kind === 'account_interrupt') {
      if (deps.syncAdminDb) {
        markBindingInterrupted(deps.syncAdminDb, clock, {
          tenantId: msg.tenantId,
          reason: msg.interruptReason ?? 'webhook_account_update',
        })
      } else {
        const ops = deps.webhookOps ?? createD1WebhookOps(deps.env.DB, clock)
        await ops.markBindingInterrupted({
          phoneNumberId: msg.phoneNumberId,
          reason: msg.interruptReason ?? 'webhook_account_update',
        })
      }
      await stub.applyWhatsappInterrupt(workerCaller(msg.tenantId), {
        reason: msg.interruptReason ?? 'webhook_account_update',
        phoneNumberId: msg.phoneNumberId,
      })
    } else if (msg.kind === 'nfm_reply') {
      // #514 / ADR-0016: fecho do Flow → quadro + proposta (não marca).
      // #538: consumir token no 1.º fecho aceite; passar catalogVersion do token.
      if (!msg.waId || !msg.responseJson) {
        log({
          level: 'warn',
          event: 'queue.invalid_nfm_reply_shape',
          detail: { receiptId: msg.receiptId, tenantId: msg.tenantId },
        })
        if (deps.syncAdminDb) {
          markWebhookReceiptProcessed(deps.syncAdminDb, msg.receiptId, clock, {
            skipped: 'invalid_shape',
          })
        } else {
          const ops = deps.webhookOps ?? createD1WebhookOps(deps.env.DB, clock)
          await ops.markProcessed(msg.receiptId, { skipped: 'invalid_shape' })
        }
        return 'ack'
      }

      const nfmParams = parseNfmResponseJson(msg.responseJson)
      let tokenCatalogVersion: string | undefined
      if (nfmParams?.flowToken) {
        const rejectToken = async (reason: string) => {
          log({
            level: 'info',
            event: 'queue.flow_token_unusable',
            detail: { receiptId: msg.receiptId, tenantId: msg.tenantId, reason },
          })
          if (deps.syncAdminDb) {
            markWebhookReceiptProcessed(deps.syncAdminDb, msg.receiptId, clock, {
              skipped: reason,
            })
          } else {
            const ops = deps.webhookOps ?? createD1WebhookOps(deps.env.DB, clock)
            await ops.markProcessed(msg.receiptId, { skipped: reason })
          }
        }
        if (deps.syncAdminDb) {
          const row = getFlowToken(deps.syncAdminDb, nfmParams.flowToken)
          if (!row || !isFlowTokenUsable(row, clock.nowMs())) {
            await rejectToken('flow_token_consumed')
            return 'ack'
          }
          // Isolamento: token de outra clínica não entra neste DO.
          if (row.tenantId !== msg.tenantId || row.bindingId !== msg.bindingId) {
            await rejectToken('flow_token_tenant_mismatch')
            return 'ack'
          }
          tokenCatalogVersion = row.catalogVersion
          // Claim antes de processar — 2.º nfm não repropõe (T08 / #538).
          consumeFlowToken(deps.syncAdminDb, nfmParams.flowToken, clock)
        } else {
          const flowOps = createD1FlowOps(deps.env.DB, clock)
          const row = await flowOps.getToken(nfmParams.flowToken)
          if (!row || !isFlowTokenUsable(row, clock.nowMs())) {
            await rejectToken('flow_token_consumed')
            return 'ack'
          }
          if (row.tenantId !== msg.tenantId || row.bindingId !== msg.bindingId) {
            await rejectToken('flow_token_tenant_mismatch')
            return 'ack'
          }
          tokenCatalogVersion = row.catalogVersion
          await flowOps.consumeToken(nfmParams.flowToken)
        }
      }

      const ingested = (await stub.ingestMessage(
        caller,
        {
          providerEventKey: msg.providerEventKey,
          waId: msg.waId,
          displayName: msg.displayName,
          body: '[Flow]',
          occurredAtMs: msg.providerTimestamp ?? undefined,
        },
        { drain: true, fanout: true },
      )) as Awaited<ReturnType<ClinicDurableObject['ingestMessage']>>

      if (
        ingested &&
        ingested.conversationId &&
        typeof stub.handleFlowNfmReply === 'function'
      ) {
        // Fumo staging 04/11/2026: ack (C16) + typing *antes* do tryAiAutoBook.
        // O DO é single-thread — se o claim Meta do ack esperar o autobook, a
        // cliente fica em vácuo e reabre o Flow. Envio inline fora do DO.
        const nfmInput = {
          tenantId: msg.tenantId,
          conversationId: ingested.conversationId,
          providerEventKey: msg.providerEventKey,
          responseJson: msg.responseJson,
          contextMessageId: msg.contextMessageId ?? null,
          catalogVersion: tokenCatalogVersion,
        }
        const ackPhase = (await stub.handleFlowNfmReply(caller, {
          ...nfmInput,
          phase: 'ack',
        })) as Awaited<ReturnType<ClinicDurableObject['handleFlowNfmReply']>>
        for (const dispatch of ackPhase.inlineDispatches ?? []) {
          try {
            await processClinicOutboxMessage(dispatch, {
              env: deps.env,
              mode: 'inline',
              clinicStub: () => stub as OutboundSendClinicStub,
              metaAdapter: deps.metaAdapter,
              clock,
              log,
            })
          } catch (err) {
            log({
              level: 'warn',
              event: 'queue.flow_ack_inline_failed',
              detail: {
                receiptId: msg.receiptId,
                tenantId: msg.tenantId,
                eventId: dispatch.eventId,
                error: err instanceof Error ? err.message.slice(0, 120) : 'inline_failed',
              },
            })
          }
        }
        if (ackPhase.needsProposal) {
          const propPhase = (await stub.handleFlowNfmReply(caller, {
            ...nfmInput,
            phase: 'proposal',
          })) as Awaited<ReturnType<ClinicDurableObject['handleFlowNfmReply']>>
          for (const dispatch of propPhase.inlineDispatches ?? []) {
            try {
              await processClinicOutboxMessage(dispatch, {
                env: deps.env,
                mode: 'inline',
                clinicStub: () => stub as OutboundSendClinicStub,
                metaAdapter: deps.metaAdapter,
                clock,
                log,
              })
            } catch (err) {
              log({
                level: 'warn',
                event: 'queue.flow_proposal_inline_failed',
                detail: {
                  receiptId: msg.receiptId,
                  tenantId: msg.tenantId,
                  eventId: dispatch.eventId,
                  error:
                    err instanceof Error ? err.message.slice(0, 120) : 'inline_failed',
                },
              })
            }
          }
        }
      }

      const isNewMessage = Boolean(
        ingested &&
          !ingested.suppressedTombstone &&
          !ingested.duplicate &&
          ingested.messageId,
      )
      if (
        !ingested?.suppressedTombstone &&
        (ingested?.createdConversation || isNewMessage) &&
        ingested?.conversationId
      ) {
        const { maybeNotifyNewConversationPush } = await import('../push/queue-hook')
        await maybeNotifyNewConversationPush({
          env: deps.env,
          clock,
          syncAdminDb: deps.syncAdminDb,
          tenantId: msg.tenantId,
          conversationId: ingested.conversationId,
          createdConversation: Boolean(ingested.createdConversation),
          newMessage: isNewMessage,
          badgeCount: ingested.unreadConversations,
          suppressUserIds: ingested.activeViewerUserIds,
          log,
          receiptId: msg.receiptId,
        })
      }
    } else if (msg.kind === 'button_reply' || msg.kind === 'list_reply') {
      // S4→S5 + M5 (#415): clique autenticado (botão ou lista).
      // Reentrega após commit-antes-do-ack: ainda chama o handler (duplicate ingest).
      if (!msg.waId || !msg.buttonId) {
        log({
          level: 'warn',
          event:
            msg.kind === 'list_reply'
              ? 'queue.invalid_list_reply_shape'
              : 'queue.invalid_button_reply_shape',
          detail: { receiptId: msg.receiptId, tenantId: msg.tenantId },
        })
        if (deps.syncAdminDb) {
          markWebhookReceiptProcessed(deps.syncAdminDb, msg.receiptId, clock, {
            skipped: 'invalid_shape',
          })
        } else {
          const ops = deps.webhookOps ?? createD1WebhookOps(deps.env.DB, clock)
          await ops.markProcessed(msg.receiptId, { skipped: 'invalid_shape' })
        }
        return 'ack'
      }
      const buttonTitle = msg.buttonTitle?.trim() || (msg.kind === 'list_reply' ? 'Lista' : 'Botão')
      const ingested = (await stub.ingestMessage(
        caller,
        {
          providerEventKey: msg.providerEventKey,
          waId: msg.waId,
          displayName: msg.displayName,
          body:
            msg.kind === 'list_reply'
              ? `[Lista] ${buttonTitle}`
              : `[Botão] ${buttonTitle}`,
          occurredAtMs: msg.providerTimestamp ?? undefined,
        },
        // O handler publica outbound + drain; evita fanout/drain duplicado no ingest.
        { drain: false, fanout: false },
      )) as Awaited<ReturnType<ClinicDurableObject['ingestMessage']>>

      if (
        ingested &&
        ingested.conversationId &&
        typeof stub.handleProposalButtonClick === 'function'
      ) {
        // contactId: o DO resolve a partir da conversa se vazio.
        // duplicate=true (crash após commit / reentrega) → executor devolve resultado existente.
        // M5: choice ids (ch1~…) entram no mesmo handler antes da proposta.
        await stub.handleProposalButtonClick(caller, {
          tenantId: msg.tenantId,
          contactId: ingested.contactId ?? '',
          conversationId: ingested.conversationId,
          buttonId: msg.buttonId,
          buttonTitle: msg.buttonTitle ?? null,
          contextMessageId: msg.contextMessageId ?? null,
          providerEventKey: msg.providerEventKey,
        })
      }

      // Replay suprimido (DEC-099): o recibo segue como processado, sem conversa nova.
      const isNewMessage = Boolean(
        ingested &&
          !ingested.suppressedTombstone &&
          !ingested.duplicate &&
          ingested.messageId,
      )
      if (
        !ingested?.suppressedTombstone &&
        (ingested?.createdConversation || isNewMessage) &&
        ingested?.conversationId
      ) {
        const { maybeNotifyNewConversationPush } = await import('../push/queue-hook')
        await maybeNotifyNewConversationPush({
          env: deps.env,
          clock,
          syncAdminDb: deps.syncAdminDb,
          tenantId: msg.tenantId,
          conversationId: ingested.conversationId,
          createdConversation: Boolean(ingested.createdConversation),
          newMessage: isNewMessage,
          badgeCount: ingested.unreadConversations,
          suppressUserIds: ingested.activeViewerUserIds,
          log,
          receiptId: msg.receiptId,
        })
      }
    } else if (msg.kind === 'media') {
      const mediaStub: MediaIngestClinicStub = {
        ingestMessage: async (c, input, opts) => {
          const r = await stub.ingestMessage(c, input, opts)
          const row = r as {
            messageId?: string | null
            conversationId?: string | null
            duplicate?: boolean
            activeViewerUserIds?: string[]
            unreadConversations?: number
          }
          return {
            ...row,
            duplicate: row.duplicate,
            messageId: row.messageId ?? null,
            conversationId: row.conversationId ?? null,
          }
        },
        createPendingAttachment: (c, input) => {
          if (!stub.createPendingAttachment) {
            throw new Error('createPendingAttachment_missing')
          }
          return stub.createPendingAttachment(c, input)
        },
        markAttachmentReady: (c, input) => {
          if (!stub.markAttachmentReady) throw new Error('markAttachmentReady_missing')
          return stub.markAttachmentReady(c, input)
        },
        markAttachmentFailed: (c, input) => {
          if (!stub.markAttachmentFailed) throw new Error('markAttachmentFailed_missing')
          return stub.markAttachmentFailed(c, input)
        },
        linkAttachmentToMessage: (c, input) => {
          if (!stub.linkAttachmentToMessage) {
            throw new Error('linkAttachmentToMessage_missing')
          }
          return stub.linkAttachmentToMessage(c, input)
        },
      }
      const mediaOutcome = await ingestWhatsappMediaMessage(
        {
          env: deps.env,
          clock,
          syncAdminDb: deps.syncAdminDb,
          clinicStub: mediaStub,
          mediaAdapter: deps.mediaAdapter,
          log,
        },
        msg,
      )
      if (mediaOutcome.result === 'retry') return 'retry'
      // Idempotente por wamid: a DO devolve duplicate=true na 2.ª entrega
      // (inline + fallback da fila), logo só a 1.ª dispara push.
      if (
        (mediaOutcome.createdConversation || mediaOutcome.newMessage) &&
        mediaOutcome.conversationId
      ) {
        const { maybeNotifyNewConversationPush } = await import('../push/queue-hook')
        await maybeNotifyNewConversationPush({
          env: deps.env,
          clock,
          syncAdminDb: deps.syncAdminDb,
          tenantId: msg.tenantId,
          conversationId: mediaOutcome.conversationId,
          createdConversation: Boolean(mediaOutcome.createdConversation),
          newMessage: Boolean(mediaOutcome.newMessage),
          badgeCount: mediaOutcome.badgeCount,
          suppressUserIds: mediaOutcome.suppressUserIds,
          log,
          receiptId: msg.receiptId,
        })
      }
    } else {
      // message | unsupported — ambos criam mensagem lógica (unsupported com texto explícito)
      if (!msg.waId || typeof msg.body !== 'string') {
        log({
          level: 'warn',
          event: 'queue.invalid_message_shape',
          detail: { receiptId: msg.receiptId, tenantId: msg.tenantId, kind: msg.kind },
        })
        if (deps.syncAdminDb) {
          markWebhookReceiptProcessed(deps.syncAdminDb, msg.receiptId, clock, {
            skipped: 'invalid_shape',
          })
        } else {
          const ops = deps.webhookOps ?? createD1WebhookOps(deps.env.DB, clock)
          await ops.markProcessed(msg.receiptId, { skipped: 'invalid_shape' })
        }
        return 'ack'
      }
      const ingested = (await stub.ingestMessage(
        caller,
        {
          providerEventKey: msg.providerEventKey,
          waId: msg.waId,
          displayName: msg.displayName,
          body: msg.body,
          occurredAtMs: msg.providerTimestamp ?? undefined,
        },
        { drain: true, fanout: true },
      )) as Awaited<ReturnType<ClinicDurableObject['ingestMessage']>>

      // Replay suprimido (DEC-099): ack do recibo, sem fingir conversa nova.
      const isNewMessage = Boolean(
        ingested &&
          !ingested.suppressedTombstone &&
          !ingested.duplicate &&
          ingested.messageId,
      )
      if (
        !ingested?.suppressedTombstone &&
        (ingested?.createdConversation || isNewMessage) &&
        ingested?.conversationId
      ) {
        const { maybeNotifyNewConversationPush } = await import('../push/queue-hook')
        await maybeNotifyNewConversationPush({
          env: deps.env,
          clock,
          syncAdminDb: deps.syncAdminDb,
          tenantId: msg.tenantId,
          conversationId: ingested.conversationId,
          createdConversation: Boolean(ingested.createdConversation),
          newMessage: isNewMessage,
          badgeCount: ingested.unreadConversations,
          suppressUserIds: ingested.activeViewerUserIds,
          log,
          receiptId: msg.receiptId,
        })
      }
    }

    const turnMs = clock.nowMs() - turnStartedMs
    if (
      turnMs > INBOUND_INLINE_BUDGET_MS &&
      (msg.kind === 'list_reply' || msg.kind === 'button_reply')
    ) {
      log({
        level: 'warn',
        event: 'queue.interactive_turn_budget_exceeded',
        detail: {
          receiptId: msg.receiptId,
          tenantId: msg.tenantId,
          kind: msg.kind,
          turnMs,
          budgetMs: INBOUND_INLINE_BUDGET_MS,
        },
      })
      return 'retry'
    }

    if (deps.syncAdminDb) {
      markWebhookReceiptProcessed(deps.syncAdminDb, msg.receiptId, clock, {
        kind: msg.kind,
        turnMs,
      })
    } else {
      const ops = deps.webhookOps ?? createD1WebhookOps(deps.env.DB, clock)
      await ops.markProcessed(msg.receiptId, { kind: msg.kind, turnMs })
    }

    log({
      level: 'info',
      event: 'queue.processed',
      detail: {
        receiptId: msg.receiptId,
        tenantId: msg.tenantId,
        kind: msg.kind,
        providerEventKey: msg.providerEventKey,
      },
    })
    return 'ack'
  } catch (err) {
    const code = err instanceof Error ? err.message : 'process_failed'
    log({
      level: 'error',
      event: 'queue.process_failed',
      detail: {
        receiptId: msg.receiptId,
        tenantId: msg.tenantId,
        kind: msg.kind,
        errorCode: code.slice(0, 80),
        attempts,
      },
    })
    if (deps.syncAdminDb) {
      markWebhookReceiptFailed(deps.syncAdminDb, msg.receiptId, code)
    } else {
      try {
        const ops = deps.webhookOps ?? createD1WebhookOps(deps.env.DB, clock)
        await ops.markFailed(msg.receiptId, code)
      } catch {
        /* best-effort */
      }
    }
    return 'retry'
  }
}

async function processPixWebhookMessage(
  deps: QueueConsumerDeps,
  msg: PixWebhookQueueMessage,
  attempts: number,
): Promise<'ack' | 'retry'> {
  const clock = deps.clock ?? systemClock
  const log = deps.log ?? defaultLog

  try {
    const stub =
      deps.clinicStub?.(msg.tenantId) ?? clinicFromEnv(deps.env, msg.tenantId)
    const caller = queueCaller(msg.tenantId)
    const doStub = stub as unknown as ClinicDurableObject

    if (msg.eventType === 'charge.paid') {
      const process =
        stub.processPixPayment?.bind(stub) ??
        doStub.processPixPayment.bind(doStub)
      await process(caller, {
        eventId: msg.providerEventKey,
        eventType: 'charge.paid',
        providerChargeId: msg.providerChargeId,
        accountId: msg.accountId,
        amountCents: msg.amountCents,
        occurredAt: msg.occurredAt,
        receiptId: msg.receiptId,
      })
    } else {
      const process =
        stub.processPixLifecycle?.bind(stub) ??
        doStub.processPixLifecycle.bind(doStub)
      await process(caller, {
        eventId: msg.providerEventKey,
        eventType: msg.eventType,
        providerChargeId: msg.providerChargeId,
        accountId: msg.accountId,
        amountCents: msg.amountCents,
        occurredAt: msg.occurredAt,
        receiptId: msg.receiptId,
        refund: msg.refund ?? null,
      })
    }

    if (deps.syncAdminDb) {
      markPixWebhookReceiptProcessed(deps.syncAdminDb, msg.receiptId, clock)
    } else {
      const ops =
        deps.pixWebhookOps ?? createD1PixWebhookOps(deps.env.DB, clock)
      await ops.markProcessed(msg.receiptId)
    }

    log({
      level: 'info',
      event: 'queue.pix_processed',
      detail: {
        receiptId: msg.receiptId,
        tenantId: msg.tenantId,
        providerEventKey: msg.providerEventKey,
        eventType: msg.eventType,
      },
    })
    return 'ack'
  } catch (err) {
    const code = err instanceof Error ? err.message : 'pix_process_failed'
    log({
      level: 'error',
      event: 'queue.pix_process_failed',
      detail: {
        receiptId: msg.receiptId,
        tenantId: msg.tenantId,
        errorCode: code.slice(0, 80),
        attempts,
      },
    })
    if (deps.syncAdminDb) {
      markPixWebhookReceiptFailed(deps.syncAdminDb, msg.receiptId, code, clock)
    } else {
      try {
        const ops =
          deps.pixWebhookOps ?? createD1PixWebhookOps(deps.env.DB, clock)
        await ops.markFailed(msg.receiptId, code)
      } catch {
        /* best-effort */
      }
    }
    return 'retry'
  }
}

/**
 * Processa um batch Cloudflare Queues.
 * Mensagens poison / falhas transitórias usam retry → DLQ após max_retries.
 */
export async function handleInboundQueueBatch(
  batch: MessageBatch<InboundQueueMessage>,
  deps: QueueConsumerDeps,
): Promise<void> {
  const log = deps.log ?? defaultLog

  for (const message of batch.messages) {
    const body = message.body
    const attempts = message.attempts

    if (isClinicOutboxMessage(body)) {
      try {
        const outcome = await processClinicOutboxMessage(body, {
          env: deps.env,
          clock: deps.clock,
          syncAdminDb: deps.syncAdminDb,
          metaAdapter: deps.metaAdapter,
          mode: 'queue',
          clinicStub: deps.clinicStub
            ? (tenantId) => {
                const s = deps.clinicStub!(tenantId)
                return {
                  applyOutboundSendResult: (caller, input) => {
                    if (!s.applyOutboundSendResult) {
                      throw new Error('applyOutboundSendResult_missing')
                    }
                    return s.applyOutboundSendResult(caller, input)
                  },
                  claimOutboundSend: s.claimOutboundSend
                    ? (caller, input) => s.claimOutboundSend!(caller, input)
                    : undefined,
                  releaseOutboundSend: s.releaseOutboundSend
                    ? (caller, input) => s.releaseOutboundSend!(caller, input)
                    : undefined,
                }
              }
            : undefined,
          log,
        })
        if (outcome === 'ack') message.ack()
        else message.retry({ delaySeconds: outcome.retryDelaySeconds })
      } catch (err) {
        const code = err instanceof Error ? err.message : 'outbox_process_failed'
        log({
          level: 'error',
          event: 'queue.clinic_outbox_failed',
          detail: {
            tenantId: body.tenantId,
            eventId: body.eventId,
            type: body.type,
            errorCode: code.slice(0, 80),
            attempts,
          },
        })
        // Seguro reintentar: a Meta só é chamada com claim novo (sem duplo envio);
        // um resultado já obtido segue por `whatsapp.send_result`. Após max_retries → DLQ
        // e o sweep do DO resolve o envio para «Verificando envio…».
        message.retry()
      }
      continue
    }

    if (isPixWebhookMessage(body)) {
      const outcome = await processPixWebhookMessage(deps, body, attempts)
      if (outcome === 'ack') message.ack()
      else message.retry()
      continue
    }

    if (!isWhatsappWebhookMessage(body)) {
      log({
        level: 'warn',
        event: 'queue.unknown_source',
        detail: { attempts },
      })
      message.ack()
      continue
    }

    if (body.inlineFallback && (await receiptAlreadyProcessed(deps, body.receiptId))) {
      if (body.kind !== 'list_reply' && body.kind !== 'button_reply') {
        log({
          level: 'info',
          event: 'queue.inline_fallback_skip',
          detail: { receiptId: body.receiptId, tenantId: body.tenantId, kind: body.kind },
        })
        message.ack()
        continue
      }
      log({
        level: 'info',
        event: 'queue.interactive_fallback_resume',
        detail: {
          receiptId: body.receiptId,
          tenantId: body.tenantId,
          kind: body.kind,
          providerEventKey: body.providerEventKey,
        },
      })
    }

    const outcome = await processWhatsappMessage(deps, body, attempts)
    if (outcome === 'ack') message.ack()
    else message.retry()
  }
}

/** Fallback de webhook já processado inline → não reprocessar. */
async function receiptAlreadyProcessed(
  deps: QueueConsumerDeps,
  receiptId: string,
): Promise<boolean> {
  try {
    if (deps.syncAdminDb) {
      return getWebhookReceiptById(deps.syncAdminDb, receiptId)?.processingState === 'processed'
    }
    const ops = deps.webhookOps ?? createD1WebhookOps(deps.env.DB, deps.clock ?? systemClock)
    return (await ops.getReceiptById(receiptId))?.processingState === 'processed'
  } catch {
    // Na dúvida processa: ingest é idempotente por wamid (dedup no DO).
    return false
  }
}

/** Handler exportado pelo Worker. */
export async function handleInboundQueue(
  batch: MessageBatch<InboundQueueMessage>,
  env: WorkerBindings,
  _ctx?: ExecutionContext,
): Promise<void> {
  void _ctx
  await handleInboundQueueBatch(batch, { env })
}
