/**
 * Envio Web Push (#42) — live via @block65/webcrypto-web-push; synthetic em CI.
 */
import { buildPushPayload } from '@block65/webcrypto-web-push'
import type { VapidConfig } from './vapid'
import { createSimulatedPushTransport, type SimulatedPushTransport } from './synthetic'
import type {
  NewConversationPushPayload,
  PushSubscriptionKeys,
  PushTransport,
  PushTransportResult,
} from './types'

export function createLivePushTransport(vapid: VapidConfig): PushTransport {
  return {
    async send(
      subscription: { endpoint: string; keys: PushSubscriptionKeys },
      payload: NewConversationPushPayload,
    ): Promise<PushTransportResult> {
      try {
        const requestInit = await buildPushPayload(
          {
            data: JSON.stringify(payload),
            options: { ttl: 3600, urgency: 'high' },
          },
          {
            endpoint: subscription.endpoint,
            expirationTime: null,
            keys: {
              p256dh: subscription.keys.p256dh,
              auth: subscription.keys.auth,
            },
          },
          {
            subject: vapid.subject,
            publicKey: vapid.publicKey,
            privateKey: vapid.privateKey,
          },
        )
        const res = await fetch(subscription.endpoint, requestInit)
        if (res.status === 404 || res.status === 410) {
          return { ok: false, gone: true, status: res.status }
        }
        if (!res.ok) {
          return {
            ok: false,
            gone: false,
            status: res.status,
            errorCode: `http_${res.status}`,
          }
        }
        return { ok: true, status: res.status }
      } catch (err) {
        return {
          ok: false,
          gone: false,
          status: 0,
          errorCode: err instanceof Error ? err.message.slice(0, 80) : 'send_failed',
        }
      }
    },
  }
}

export function createPushTransport(
  vapid: VapidConfig,
  opts?: { simulated?: SimulatedPushTransport },
): PushTransport {
  if (vapid.mode === 'synthetic') {
    return opts?.simulated ?? createSimulatedPushTransport()
  }
  return createLivePushTransport(vapid)
}

/** Texto Confirmado DEC-040 — sem conteúdo da mensagem. */
export function buildNewConversationPayload(input: {
  tenantId: string
  tenantName: string
  conversationId: string
}): NewConversationPushPayload {
  const clinic = input.tenantName.trim() || 'clínica'
  return {
    kind: 'new_conversation',
    title: 'Nova conversa',
    body: `Nova conversa na ${clinic}`,
    tag: conversationPushTag(input.tenantId, input.conversationId),
    url: `/c/${encodeURIComponent(input.tenantId)}/conversas/${encodeURIComponent(input.conversationId)}`,
    tenantId: input.tenantId,
    conversationId: input.conversationId,
  }
}

/**
 * Tag por conversa: avisos repetidos da mesma conversa substituem-se
 * (não empilham) no centro de notificações.
 */
export function conversationPushTag(tenantId: string, conversationId: string): string {
  return `conversation:${tenantId}:${conversationId}`
}

/** Nova mensagem numa conversa existente — mesmo formato, sem conteúdo. */
export function buildNewMessagePayload(input: {
  tenantId: string
  tenantName: string
  conversationId: string
}): NewConversationPushPayload {
  const clinic = input.tenantName.trim() || 'clínica'
  return {
    kind: 'new_message',
    title: 'Nova mensagem',
    body: `Nova mensagem na ${clinic}`,
    tag: conversationPushTag(input.tenantId, input.conversationId),
    url: `/c/${encodeURIComponent(input.tenantId)}/conversas/${encodeURIComponent(input.conversationId)}`,
    tenantId: input.tenantId,
    conversationId: input.conversationId,
  }
}

/** DEC-156 — cliente pediu equipe / handoff (sem PII). */
export function buildNeedsPersonPayload(input: {
  tenantId: string
  tenantName: string
  conversationId: string
  escalate?: boolean
}): NewConversationPushPayload {
  const clinic = input.tenantName.trim() || 'clínica'
  if (input.escalate) {
    return {
      kind: 'needs_person_escalate',
      title: 'Ainda precisa de alguém',
      body: `Continua a aguardar a equipe na ${clinic}`,
      tag: conversationPushTag(input.tenantId, input.conversationId),
      url: `/c/${encodeURIComponent(input.tenantId)}/conversas/${encodeURIComponent(input.conversationId)}`,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
    }
  }
  return {
    kind: 'needs_person',
    title: 'Precisa de alguém',
    body: `Equipe necessária na ${clinic}`,
    tag: conversationPushTag(input.tenantId, input.conversationId),
    url: `/c/${encodeURIComponent(input.tenantId)}/conversas/${encodeURIComponent(input.conversationId)}`,
    tenantId: input.tenantId,
    conversationId: input.conversationId,
  }
}

/** Rejeita payloads que incluam campos sensíveis (defesa em profundidade). */
export function assertSafePushPayload(payload: NewConversationPushPayload): void {
  const allowed = new Set([
    'new_conversation',
    'new_message',
    'needs_person',
    'needs_person_escalate',
  ])
  if (!allowed.has(payload.kind)) {
    throw new Error('unsupported_push_kind')
  }
  const forbidden = ['waId', 'bodyPreview', 'phone', 'messageBody', 'displayName']
  const json = JSON.stringify(payload)
  for (const key of forbidden) {
    if (json.includes(`"${key}"`)) {
      throw new Error('push_payload_contains_sensitive_field')
    }
  }
  // Corpo tipado: só o template sem trecho de mensagem.
  const prefixes: Record<NewConversationPushPayload['kind'], string> = {
    new_conversation: 'Nova conversa na ',
    new_message: 'Nova mensagem na ',
    needs_person: 'Equipe necessária na ',
    needs_person_escalate: 'Continua a aguardar a equipe na ',
  }
  if (!payload.body.startsWith(prefixes[payload.kind])) {
    throw new Error('push_body_unexpected')
  }
}
