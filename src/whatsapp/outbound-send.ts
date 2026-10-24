/**
 * Consumo de outbox `whatsapp.send` (#33).
 * Carrega credenciais D1, chama Meta (synthetic/live), devolve resultado ao DO.
 * Timeout → uncertain (Desconhecido); sem retry automático de efeito externo.
 */
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
import { createMetaAdapter, type MetaAdapter, type MetaSendResult } from './meta'
import type { ClinicOutboxQueueMessage } from './queue-types'
import { SYNTHETIC_WHATSAPP_TEMPLATES } from '../clinic/inbox/templates'

export type OutboundSendClinicStub = {
  applyOutboundSendResult: (
    ...args: Parameters<ClinicDurableObject['applyOutboundSendResult']>
  ) => ReturnType<ClinicDurableObject['applyOutboundSendResult']> | Promise<unknown>
}

export type ProcessOutboundSendDeps = {
  env: WorkerBindings
  clock?: Clock
  syncAdminDb?: AdminDb | null
  metaAdapter?: MetaAdapter
  clinicStub?: (tenantId: string) => OutboundSendClinicStub
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
      deps.env.META_TOKEN_SECRET ?? deps.env.META_APP_SECRET,
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
    deps.env.META_TOKEN_SECRET ?? deps.env.META_APP_SECRET,
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

/**
 * Processa uma mensagem de fila `clinic_outbox` do tipo `whatsapp.send`.
 * Outros tipos → ack (message.created / delivery_updated são fan-out já feito no DO).
 */
export async function processClinicOutboxMessage(
  msg: ClinicOutboxQueueMessage,
  deps: ProcessOutboundSendDeps,
): Promise<'ack'> {
  const log = deps.log ?? (() => undefined)
  const clock = deps.clock ?? systemClock

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

  if (!outboundId || !waId) {
    log({
      level: 'error',
      event: 'queue.clinic_outbox_invalid',
      detail: { tenantId: msg.tenantId, eventId: msg.eventId },
    })
    return 'ack'
  }

  const creds = await resolveAccessToken(deps, msg.tenantId)
  let sendResult: MetaSendResult
  if ('errorCode' in creds) {
    sendResult = { outcome: 'failed', errorCode: creds.errorCode }
  } else {
    const meta = deps.metaAdapter ?? createMetaAdapter(deps.env)
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
  }

  const stub =
    deps.clinicStub?.(msg.tenantId) ??
    (clinicFromEnv(deps.env, msg.tenantId) as unknown as OutboundSendClinicStub)

  await stub.applyOutboundSendResult(queueCaller(msg.tenantId), {
    outboundId,
    outboxEventId: msg.eventId,
    idempotencyKey: msg.idempotencyKey,
    outcome: sendResult.outcome,
    providerMessageId:
      sendResult.outcome === 'succeeded' ? sendResult.providerMessageId : null,
    errorCode: sendResult.outcome === 'succeeded' ? null : sendResult.errorCode,
  })

  log({
    level: 'info',
    event: 'queue.whatsapp_send_done',
    detail: {
      tenantId: msg.tenantId,
      eventId: msg.eventId,
      outcome: sendResult.outcome,
      errorCode: sendResult.outcome === 'succeeded' ? null : sendResult.errorCode,
      // Sem corpo, waId ou token.
      occurredAt: clock.nowMs(),
    },
  })

  return 'ack'
}
