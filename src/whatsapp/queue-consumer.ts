/**
 * Consumer da fila INBOUND_EVENTS (#32/#33).
 * whatsapp_webhook → DO ingest (dedup) / status / interrupção.
 * clinic_outbox → envio Meta + reconciliação (`whatsapp.send`).
 */
import { queueCaller, workerCaller } from '../clinic'
import { systemClock, type Clock } from '../db/clock'
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
  } & Partial<OutboundSendClinicStub>
  metaAdapter?: MetaAdapter
  mediaAdapter?: MetaMediaAdapter
  log?: (entry: {
    level: 'info' | 'warn' | 'error'
    event: string
    detail: Record<string, unknown>
  }) => void
}

function defaultLog(entry: {
  level: 'info' | 'warn' | 'error'
  event: string
  detail: Record<string, unknown>
}): void {
  const line = JSON.stringify({ channel: 'inbound_queue', event: entry.event, ...entry.detail })
  if (entry.level === 'error') console.error(line)
  else if (entry.level === 'warn') console.warn(line)
  else console.info(line)
}

function clinicFromEnv(env: WorkerBindings, tenantId: string) {
  const id = env.CLINIC.idFromName(tenantId)
  return env.CLINIC.get(id)
}

async function processWhatsappMessage(
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
    } else if (msg.kind === 'media') {
      const mediaStub: MediaIngestClinicStub = {
        ingestMessage: async (c, input, opts) => {
          const r = await stub.ingestMessage(c, input, opts)
          const row = r as {
            messageId?: string | null
            conversationId?: string | null
            duplicate?: boolean
          }
          return {
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
      if (mediaOutcome === 'retry') return 'retry'
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
      await stub.ingestMessage(
        caller,
        {
          providerEventKey: msg.providerEventKey,
          waId: msg.waId,
          displayName: msg.displayName,
          body: msg.body,
          occurredAtMs: msg.providerTimestamp ?? undefined,
        },
        { drain: true, fanout: true },
      )
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
        await processClinicOutboxMessage(body, {
          env: deps.env,
          clock: deps.clock,
          syncAdminDb: deps.syncAdminDb,
          metaAdapter: deps.metaAdapter,
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
                }
              }
            : undefined,
          log,
        })
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
          },
        })
        // Não retry automático de efeito externo incerto — ack e deixa unknown/failed no DO.
      }
      message.ack()
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

    const outcome = await processWhatsappMessage(deps, body, attempts)
    if (outcome === 'ack') message.ack()
    else message.retry()
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
