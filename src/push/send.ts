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

/** Texto legado DEC-040 — já não disparado (DEC-173). Mantido para harness/testes. */
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

export function appointmentPushTag(tenantId: string, appointmentId: string): string {
  return `appointment:${tenantId}:${appointmentId}`
}

/**
 * DEC-173 — inbound só em fio assumido/handoff.
 * Contacto opcional no corpo (rótulo da agenda; sem telefone).
 */
export function buildNewMessagePayload(input: {
  tenantId: string
  tenantName: string
  conversationId: string
  contactLabel?: string | null
}): NewConversationPushPayload {
  const clinic = input.tenantName.trim() || 'clínica'
  const contact = sanitizePushLabel(input.contactLabel)
  const body = contact
    ? `Nova mensagem — ${contact} na ${clinic}`
    : `Nova mensagem na ${clinic}`
  return {
    kind: 'new_message',
    title: 'Nova mensagem',
    body,
    tag: conversationPushTag(input.tenantId, input.conversationId),
    url: `/c/${encodeURIComponent(input.tenantId)}/conversas/${encodeURIComponent(input.conversationId)}`,
    tenantId: input.tenantId,
    conversationId: input.conversationId,
  }
}

/** DEC-156 — cliente pediu equipe / handoff (sem telefone nem corpo WhatsApp). */
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
    body: `Chamada de atendente na ${clinic}`,
    tag: conversationPushTag(input.tenantId, input.conversationId),
    url: `/c/${encodeURIComponent(input.tenantId)}/conversas/${encodeURIComponent(input.conversationId)}`,
    tenantId: input.tenantId,
    conversationId: input.conversationId,
  }
}

/**
 * DEC-173 — agendamento confirmado (botão Confirmar, Pix, painel).
 * Contacto/serviço só como rótulos curtos já usados na agenda (sem telefone).
 */
export function buildAppointmentConfirmedPayload(input: {
  tenantId: string
  tenantName: string
  appointmentId: string
  conversationId?: string | null
  contactLabel?: string | null
  serviceName?: string | null
}): NewConversationPushPayload {
  const clinic = input.tenantName.trim() || 'clínica'
  const contact = sanitizePushLabel(input.contactLabel)
  const service = sanitizePushLabel(input.serviceName)
  const detail = [contact, service].filter(Boolean).join(' · ')
  const body = detail
    ? `Agendamento confirmado — ${detail} na ${clinic}`
    : `Agendamento confirmado na ${clinic}`
  const conversationId = input.conversationId?.trim() || ''
  const url = conversationId
    ? `/c/${encodeURIComponent(input.tenantId)}/conversas/${encodeURIComponent(conversationId)}`
    : `/c/${encodeURIComponent(input.tenantId)}/agenda/compromisso/${encodeURIComponent(input.appointmentId)}`
  return {
    kind: 'appointment_confirmed',
    title: 'Agendamento confirmado',
    body,
    tag: appointmentPushTag(input.tenantId, input.appointmentId),
    url,
    tenantId: input.tenantId,
    conversationId: conversationId || input.appointmentId,
  }
}

/** Rótulo curto para o corpo do push — sem telefone / control chars. */
export function sanitizePushLabel(raw: string | null | undefined): string | null {
  if (!raw) return null
  let cleaned = ''
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    cleaned += code <= 0x1f || code === 0x7f ? ' ' : raw[i]!
  }
  let s = cleaned.replace(/\s+/g, ' ').trim()
  if (!s) return null
  // Recusa se parecer número de telefone (E.164 / nacional denso).
  if (/^\+?\d[\d\s().-]{6,}$/.test(s)) return null
  if (s.length > 48) s = `${s.slice(0, 45).trimEnd()}…`
  return s
}

/** Rejeita payloads que incluam campos sensíveis (defesa em profundidade). */
export function assertSafePushPayload(payload: NewConversationPushPayload): void {
  const allowed = new Set([
    'new_conversation',
    'new_message',
    'needs_person',
    'needs_person_escalate',
    'appointment_confirmed',
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
  // Corpo tipado: só o template sem trecho de mensagem WhatsApp.
  const prefixes: Record<NewConversationPushPayload['kind'], string> = {
    new_conversation: 'Nova conversa na ',
    new_message: 'Nova mensagem',
    needs_person: 'Chamada de atendente na ',
    needs_person_escalate: 'Continua a aguardar a equipe na ',
    appointment_confirmed: 'Agendamento confirmado',
  }
  if (!payload.body.startsWith(prefixes[payload.kind])) {
    throw new Error('push_body_unexpected')
  }
}
