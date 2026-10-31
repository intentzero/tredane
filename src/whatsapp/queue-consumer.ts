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
    } else if (msg.kind === 'button_reply') {
      // S4→S5: clique autenticado — regista mensagem e executa book/Pix (idempotente).
      // Reentrega após commit-antes-do-ack: ainda chama o handler (duplicate ingest).
      if (!msg.waId || !msg.buttonId) {
        log({
          level: 'warn',
          event: 'queue.invalid_button_reply_shape',
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
      const buttonTitle = msg.buttonTitle?.trim() || 'Botão'
      const ingested = (await stub.ingestMessage(
        caller,
        {
          providerEventKey: msg.providerEventKey,
          waId: msg.waId,
          displayName: msg.displayName,
          body: `[Botão] ${buttonTitle}`,
          occurredAtMs: msg.providerTimestamp ?? undefined,
        },
        { drain: true, fanout: true },
      )) as Awaited<ReturnType<ClinicDurableObject['ingestMessage']>>

      if (
        ingested &&
        ingested.conversationId &&
        typeof stub.handleProposalButtonClick === 'function'
      ) {
        // contactId: o DO resolve a partir da conversa se vazio.
        // duplicate=true (crash após commit / reentrega) → executor devolve resultado existente.
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

    if (deps.syncAdminDb) {
      markWebhookReceiptProcessed(deps.syncAdminDb, msg.receiptId, clock, {
        kind: msg.kind,
      })
    } else {
      const ops = deps.webhookOps ?? createD1WebhookOps(deps.env.DB, clock)
      await ops.markProcessed(msg.receiptId, { kind: msg.kind })
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
      log({
        level: 'info',
        event: 'queue.inline_fallback_skip',
        detail: { receiptId: body.receiptId, tenantId: body.tenantId, kind: body.kind },
      })
      message.ack()
      continue
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
