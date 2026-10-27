/**
 * Consumo de outbox `whatsapp.send` (#33).
 * Carrega credenciais D1, chama Meta (synthetic/live), devolve resultado ao DO.
 * Timeout → uncertain (Desconhecido); sem retry automático de efeito externo.
 */
import { isDemoTenantId } from '../clinic/demo/ids'
import { queueCaller } from '../clinic'
import { systemClock, type Clock } from '../db/clock'
import type { AdminDb } from '../db/admin/store'
import type { WorkerBindings } from '../worker/bindings'
import type { ClinicDurableObject } from '../worker/clinic-do'
import {
  getActiveBindingForTenant,
  getCredentialCipher,
} from './bindings'
import { openAccessToken } from './crypto'
import { metaSealKeys } from '../security/sealed-secret'
import { createMetaSendAdapter, type MetaAdapter, type MetaSendResult } from './meta'
import type { ClinicOutboxQueueMessage } from './queue-types'
import { SYNTHETIC_WHATSAPP_TEMPLATES } from '../clinic/inbox/templates'
import type { ClaimOutboundSendResult } from '../clinic/inbox/dispatch'

export type OutboundSendClinicStub = {
  applyOutboundSendResult: (
    ...args: Parameters<ClinicDurableObject['applyOutboundSendResult']>
  ) => ReturnType<ClinicDurableObject['applyOutboundSendResult']> | Promise<unknown>
  /** Opcional em stubs de teste antigos; o DO real implementa sempre. */
  claimOutboundSend?: (
    ...args: Parameters<ClinicDurableObject['claimOutboundSend']>
  ) => Promise<ClaimOutboundSendResult>
  releaseOutboundSend?: (
    ...args: Parameters<ClinicDurableObject['releaseOutboundSend']>
  ) => Promise<unknown>
}

/** Resultado para o consumer da fila. */
export type OutboxProcessOutcome = 'ack' | { retryDelaySeconds: number }

/** Tipo de mensagem de fila que só transporta o resultado Meta (fallback). */
export const SEND_RESULT_TYPE = 'whatsapp.send_result'

const APPLY_ATTEMPTS = 3

export type ProcessOutboundSendDeps = {
  env: WorkerBindings
  clock?: Clock
  syncAdminDb?: AdminDb | null
  metaAdapter?: MetaAdapter
  clinicStub?: (tenantId: string) => OutboundSendClinicStub
  /** 'inline' = chamada no pedido HTTP de envio; 'queue' = consumer (fallback). */
  mode?: 'inline' | 'queue'
  /** Fila para publicar resultado/reintento quando o DO falha (por omissão INBOUND_EVENTS). */
  resultQueue?: { send(body: ClinicOutboxQueueMessage, opts?: { delaySeconds?: number }): Promise<void> }
  sleep?: (ms: number) => Promise<void>
  log?: (entry: {
    level: 'info' | 'warn' | 'error'
    event: string
    detail: Record<string, unknown>
  }) => void
}

function clinicFromEnv(env: WorkerBindings, tenantId: string) {
  const id = env.CLINIC.idFromName(tenantId)
  return env.CLINIC.get(id)
}

async function resolveAccessToken(
  deps: ProcessOutboundSendDeps,
  tenantId: string,
): Promise<{ phoneNumberId: string; accessToken: string } | { errorCode: string }> {
  const clock = deps.clock ?? systemClock
  if (deps.syncAdminDb) {
    const binding = getActiveBindingForTenant(deps.syncAdminDb, tenantId)
    if (!binding || binding.status !== 'active') {
      return { errorCode: 'whatsapp_binding_inactive' }
    }
    const cipher = getCredentialCipher(deps.syncAdminDb, binding.id)
    if (!cipher) return { errorCode: 'whatsapp_credential_missing' }
    const accessToken = await openAccessToken(
      cipher,
      metaSealKeys(deps.env),
    )
    return { phoneNumberId: binding.phoneNumberId, accessToken }
  }

  // D1 async — consulta mínima via prepare (sem ops dedicadas ainda).
  const row = await deps.env.DB.prepare(
    `SELECT b.phone_number_id AS phone_number_id, b.status AS status,
            c.access_token_cipher AS access_token_cipher, b.id AS binding_id
     FROM whatsapp_phone_bindings b
     LEFT JOIN whatsapp_credentials c ON c.binding_id = b.id
     WHERE b.tenant_id = ? AND b.status IN ('active', 'interrupted')
     LIMIT 1`,
  )
    .bind(tenantId)
    .first<{
      phone_number_id: string
      status: string
      access_token_cipher: string | null
      binding_id: string
    }>()

  void clock
  if (!row || row.status !== 'active') {
    return { errorCode: 'whatsapp_binding_inactive' }
  }
  if (!row.access_token_cipher) {
    return { errorCode: 'whatsapp_credential_missing' }
  }
  const accessToken = await openAccessToken(
    row.access_token_cipher,
    metaSealKeys(deps.env),
  )
  return { phoneNumberId: row.phone_number_id, accessToken }
}

function orderedTemplateParams(
  templateName: string,
  language: string,
  params: Record<string, string> | null | undefined,
): string[] {
  const catalog = SYNTHETIC_WHATSAPP_TEMPLATES.find(
    (t) => t.name === templateName && t.language === language,
  )
  const keys = catalog?.paramKeys ?? Object.keys(params ?? {})
  return keys.map((k) => (params?.[k] ?? '').trim())
}

type ApplyInput = Parameters<OutboundSendClinicStub['applyOutboundSendResult']>[1]

async function applyWithRetry(
  stub: OutboundSendClinicStub,
  tenantId: string,
  input: ApplyInput,
  deps: ProcessOutboundSendDeps,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  let last = 'apply_failed'
  for (let i = 0; i < APPLY_ATTEMPTS; i++) {
    try {
      await stub.applyOutboundSendResult(queueCaller(tenantId), input)
      return { ok: true }
    } catch (err) {
      last = err instanceof Error ? err.message : 'apply_failed'
      // Intenção/outbox inexistente não melhora com retry.
      if (last.includes('outbound_not_found') || last.includes('outbox_not_found')) break
      if (i < APPLY_ATTEMPTS - 1) await sleep(200 * (i + 1))
    }
  }
  return { ok: false, error: last }
}

function stubFor(deps: ProcessOutboundSendDeps, tenantId: string): OutboundSendClinicStub {
  return (
    deps.clinicStub?.(tenantId) ??
    (clinicFromEnv(deps.env, tenantId) as unknown as OutboundSendClinicStub)
  )
}

function resultQueueFor(deps: ProcessOutboundSendDeps) {
  if (deps.resultQueue) return deps.resultQueue
  const q = deps.env?.INBOUND_EVENTS
  if (!q) return null
  return {
    send: (body: ClinicOutboxQueueMessage, opts?: { delaySeconds?: number }) =>
      q.send(body, opts),
  }
}

/**
 * Resultado Meta que não conseguiu ser gravado no DO: a fila só reaplica
 * (nunca chama a Meta de novo).
 */
async function processSendResultMessage(
  msg: ClinicOutboxQueueMessage,
  deps: ProcessOutboundSendDeps,
): Promise<OutboxProcessOutcome> {
  const log = deps.log ?? (() => undefined)
  const p = msg.payload ?? {}
  const input: ApplyInput = {
    outboundId: String(p.outboundId ?? ''),
    outboxEventId: String(p.outboxEventId ?? ''),
    idempotencyKey: String(p.idempotencyKey ?? ''),
    outcome:
      p.outcome === 'succeeded' || p.outcome === 'failed' ? p.outcome : 'uncertain',
    providerMessageId: typeof p.providerMessageId === 'string' ? p.providerMessageId : null,
    errorCode: typeof p.errorCode === 'string' ? p.errorCode : null,
  }
  if (!input.outboundId || !input.outboxEventId) return 'ack'
  const applied = await applyWithRetry(stubFor(deps, msg.tenantId), msg.tenantId, input, {
    ...deps,
    sleep: deps.sleep ?? (async () => undefined),
  })
  log({
    level: applied.ok ? 'info' : 'error',
    event: applied.ok ? 'queue.whatsapp_send_result_applied' : 'queue.whatsapp_send_result_failed',
    detail: {
      tenantId: msg.tenantId,
      eventId: input.outboxEventId,
      errorCode: applied.ok ? null : applied.error.slice(0, 80),
    },
  })
  if (applied.ok) return 'ack'
  // Retry da fila (→ DLQ após max_retries). O sweep do DO resolve se nunca aplicar.
  throw new Error(applied.error)
}

/**
 * Processa uma mensagem de fila `clinic_outbox` do tipo `whatsapp.send`.
 * Outros tipos → ack (message.created / delivery_updated são fan-out já feito no DO).
 */
export async function processClinicOutboxMessage(
  msg: ClinicOutboxQueueMessage,
  deps: ProcessOutboundSendDeps,
): Promise<OutboxProcessOutcome> {
  const log = deps.log ?? (() => undefined)
  const clock = deps.clock ?? systemClock

  if (msg.type === SEND_RESULT_TYPE) {
    return processSendResultMessage(msg, deps)
  }

  if (msg.type !== 'whatsapp.send') {
    log({
      level: 'info',
      event: 'queue.clinic_outbox_skip',
      detail: { tenantId: msg.tenantId, eventId: msg.eventId, type: msg.type },
    })
    return 'ack'
  }

  const payload = msg.payload ?? {}
  const outboundId = typeof payload.outboundId === 'string' ? payload.outboundId : ''
  const clientRequestId =
    typeof payload.clientRequestId === 'string' ? payload.clientRequestId : ''
  const kind = payload.kind === 'template' ? 'template' : 'text'
  const waId = typeof payload.waId === 'string' ? payload.waId : ''
  const body = typeof payload.body === 'string' ? payload.body : ''
  const templateName =
    typeof payload.templateName === 'string' ? payload.templateName : ''
  const templateLanguage =
    typeof payload.templateLanguage === 'string' ? payload.templateLanguage : 'pt_BR'
  const templateParams =
    payload.templateParams && typeof payload.templateParams === 'object'
      ? (payload.templateParams as Record<string, string>)
      : null

  if (isDemoTenantId(msg.tenantId)) {
    // Clínica demo (contatos fictícios): nunca chamar a Meta.
    log({
      level: 'warn',
      event: 'whatsapp_send.demo_tenant_skip',
      detail: { tenantId: msg.tenantId, eventId: msg.eventId },
    })
    return 'ack'
  }

  if (!outboundId || !waId) {
    log({
      level: 'error',
      event: 'queue.clinic_outbox_invalid',
      detail: { tenantId: msg.tenantId, eventId: msg.eventId },
    })
    return 'ack'
  }

  const mode = deps.mode ?? 'queue'
  const stub = stubFor(deps, msg.tenantId)
  const claimInput = { outboxEventId: msg.eventId, idempotencyKey: msg.idempotencyKey }

  // 1) Idempotência: só quem reivindica chama a Meta (inline vs fila).
  if (typeof stub.claimOutboundSend === 'function') {
    const claim = await stub.claimOutboundSend(queueCaller(msg.tenantId), claimInput)
    if (claim.status !== 'claimed') {
      log({
        level: 'info',
        event: 'whatsapp_send.claim_skip',
        detail: { tenantId: msg.tenantId, eventId: msg.eventId, mode, status: claim.status },
      })
      if (claim.status === 'in_flight') {
        // Outro envio em curso: volta mais tarde (sweep resolve se ficar órfão).
        return { retryDelaySeconds: 60 }
      }
      return 'ack'
    }
  }

  const startedAt = clock.nowMs()
  // 2) Credenciais. Falha aqui = Meta não chamada → liberta o claim e deixa a fila tentar.
  let creds: Awaited<ReturnType<typeof resolveAccessToken>>
  try {
    creds = await resolveAccessToken(deps, msg.tenantId)
  } catch (err) {
    if (typeof stub.releaseOutboundSend === 'function') {
      try {
        await stub.releaseOutboundSend(queueCaller(msg.tenantId), claimInput)
      } catch {
        /* claim fica e o sweep resolve */
      }
    }
    throw err
  }

  // 3) Meta (uma única chamada por claim).
  let sendResult: MetaSendResult
  if ('errorCode' in creds) {
    sendResult = { outcome: 'failed', errorCode: creds.errorCode }
  } else {
    const meta = deps.metaAdapter ?? createMetaSendAdapter(deps.env)
    try {
      if (kind === 'template') {
        sendResult = await meta.sendTemplateMessage({
          phoneNumberId: creds.phoneNumberId,
          accessToken: creds.accessToken,
          toWaId: waId,
          templateName,
          language: templateLanguage,
          bodyParams: orderedTemplateParams(templateName, templateLanguage, templateParams),
          clientRequestId,
        })
      } else {
        sendResult = await meta.sendTextMessage({
          phoneNumberId: creds.phoneNumberId,
          accessToken: creds.accessToken,
          toWaId: waId,
          body,
          clientRequestId,
        })
      }
    } catch {
      sendResult = { outcome: 'uncertain', errorCode: 'meta_adapter_error' }
    }
  }
  const metaMs = clock.nowMs() - startedAt

  // 4) Persistir resultado no DO (fan-out WS acontece lá). Nunca descartar.
  const applyInput: ApplyInput = {
    outboundId,
    outboxEventId: msg.eventId,
    idempotencyKey: msg.idempotencyKey,
    outcome: sendResult.outcome,
    providerMessageId:
      sendResult.outcome === 'succeeded' ? sendResult.providerMessageId : null,
    errorCode: sendResult.outcome === 'succeeded' ? null : sendResult.errorCode,
  }
  const applied = await applyWithRetry(stub, msg.tenantId, applyInput, deps)
  if (!applied.ok) {
    log({
      level: 'error',
      event: 'whatsapp_send.apply_failed',
      detail: {
        tenantId: msg.tenantId,
        eventId: msg.eventId,
        mode,
        errorCode: applied.error.slice(0, 80),
      },
    })
    const rq = resultQueueFor(deps)
    if (!rq) throw new Error(applied.error)
    await rq.send({
      source: 'clinic_outbox',
      tenantId: msg.tenantId,
      eventId: `${msg.eventId}:result`,
      type: SEND_RESULT_TYPE,
      idempotencyKey: `${msg.idempotencyKey}:result`,
      payload: { ...applyInput },
    })
  }

  log({
    level: 'info',
    event: 'queue.whatsapp_send_done',
    detail: {
      tenantId: msg.tenantId,
      eventId: msg.eventId,
      mode,
      outcome: sendResult.outcome,
      errorCode: sendResult.outcome === 'succeeded' ? null : sendResult.errorCode,
      metaMs,
      queueLagMs: typeof msg.occurredAt === 'number' ? startedAt - msg.occurredAt : null,
      applied: applied.ok,
      // Sem corpo, waId ou token.
      occurredAt: clock.nowMs(),
    },
  })

  return 'ack'
}
