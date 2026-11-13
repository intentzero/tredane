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

/** Fallback quando o contacto não tem nome de apresentação (DEC-040 / copy 13/11/2026). */
export const PUSH_CONTACT_FALLBACK = 'Cliente'

/**
 * Motivos de handoff → rótulo curto e fixo no corpo do push (DEC-156).
 * Desconhecido → omitir o segmento (não inventar).
 */
export const HANDOFF_REASON_PUSH_LABELS: Readonly<Record<string, string>> = {
  customer_requested: 'pediu a equipe',
  off_purpose: 'fora do assunto',
  payment_proof: 'comprovativo',
  human_only: 'outro',
  media_after_ask: 'outro',
}

const ALLOWED_HANDOFF_REASON_LABELS = new Set(
  Object.values(HANDOFF_REASON_PUSH_LABELS),
)

export function handoffReasonPushLabel(
  reason: string | null | undefined,
): string | null {
  if (!reason) return null
  return HANDOFF_REASON_PUSH_LABELS[reason] ?? null
}

/** Nome da clínica no corpo — mesma sanitização do contacto (sem « · »). */
function clinicLabel(tenantName: string): string {
  return sanitizePushLabel(tenantName) ?? 'clínica'
}

/** Nome do contacto no corpo do push — sanitizado ou «Cliente». */
export function resolvePushContactLabel(
  raw: string | null | undefined,
): string {
  return sanitizePushLabel(raw) ?? PUSH_CONTACT_FALLBACK
}

/**
 * Texto legado DEC-040 / harness — DEC-173 já não dispara no ingest.
 * Corpo: `{contacto} · {clínica}` (sem preview da mensagem).
 */
export function buildNewConversationPayload(input: {
  tenantId: string
  tenantName: string
  conversationId: string
  contactLabel?: string | null
}): NewConversationPushPayload {
  const clinic = clinicLabel(input.tenantName)
  const contact = resolvePushContactLabel(input.contactLabel)
  return {
    kind: 'new_conversation',
    title: 'Nova conversa',
    body: `${contact} · ${clinic}`,
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
 * Corpo: `Mensagem de {contacto} · {clínica}` (sem telefone nem texto WhatsApp).
 */
export function buildNewMessagePayload(input: {
  tenantId: string
  tenantName: string
  conversationId: string
  contactLabel?: string | null
}): NewConversationPushPayload {
  const clinic = clinicLabel(input.tenantName)
  const contact = resolvePushContactLabel(input.contactLabel)
  return {
    kind: 'new_message',
    title: 'Nova mensagem',
    body: `Mensagem de ${contact} · ${clinic}`,
    tag: conversationPushTag(input.tenantId, input.conversationId),
    url: `/c/${encodeURIComponent(input.tenantId)}/conversas/${encodeURIComponent(input.conversationId)}`,
    tenantId: input.tenantId,
    conversationId: input.conversationId,
  }
}

/**
 * DEC-156 — cliente pediu equipe / handoff.
 * Corpo: `{contacto} · {clínica}` [· motivo]; escalate acrescenta «há 5 min».
 */
export function buildNeedsPersonPayload(input: {
  tenantId: string
  tenantName: string
  conversationId: string
  contactLabel?: string | null
  /** `ai_reply_pause_reason` — só rótulos do mapa curto entram no corpo. */
  handoffReason?: string | null
  escalate?: boolean
}): NewConversationPushPayload {
  const clinic = clinicLabel(input.tenantName)
  const contact = resolvePushContactLabel(input.contactLabel)
  if (input.escalate) {
    return {
      kind: 'needs_person_escalate',
      title: 'Ainda precisa de alguém',
      body: `${contact} · ${clinic} · há 5 min`,
      tag: conversationPushTag(input.tenantId, input.conversationId),
      url: `/c/${encodeURIComponent(input.tenantId)}/conversas/${encodeURIComponent(input.conversationId)}`,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
    }
  }
  const reason = handoffReasonPushLabel(input.handoffReason)
  const body = reason
    ? `${contact} · ${clinic} · ${reason}`
    : `${contact} · ${clinic}`
  return {
    kind: 'needs_person',
    title: 'Precisa de alguém',
    body,
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
  const clinic = clinicLabel(input.tenantName)
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

/** Rótulo curto para o corpo do push — sem telefone / control chars / separador. */
export function sanitizePushLabel(raw: string | null | undefined): string | null {
  if (!raw) return null
  let cleaned = ''
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    cleaned += code <= 0x1f || code === 0x7f ? ' ' : raw[i]!
  }
  // O corpo usa « · » como separador de segmentos — não deixar no rótulo.
  let s = cleaned.replace(/·/g, ' ').replace(/\s+/g, ' ').trim()
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
  // Chaves proibidas no JSON (o nome do contacto só pode ir no `body`, nunca como campo).
  const forbidden = ['waId', 'bodyPreview', 'phone', 'messageBody', 'displayName']
  const json = JSON.stringify(payload)
  for (const key of forbidden) {
    if (json.includes(`"${key}"`)) {
      throw new Error('push_payload_contains_sensitive_field')
    }
  }
  const body = payload.body
  if (!body || /\r|\n/.test(body) || body.length > 160) {
    throw new Error('push_body_unexpected')
  }
  // Templates Confirmados (13/11/2026): título = tipo; corpo = segmentos com « · ».
  // Sem preview de mensagem WhatsApp — rejeita corpos que não casem o formato.
  switch (payload.kind) {
    case 'new_conversation': {
      if (!/^[^·]+ · [^·]+$/.test(body)) throw new Error('push_body_unexpected')
      break
    }
    case 'new_message': {
      if (!/^Mensagem de [^·]+ · [^·]+$/.test(body)) {
        throw new Error('push_body_unexpected')
      }
      break
    }
    case 'needs_person': {
      const parts = body.split(' · ')
      if (parts.length === 2) {
        if (!parts[0]?.trim() || !parts[1]?.trim()) {
          throw new Error('push_body_unexpected')
        }
      } else if (parts.length === 3) {
        if (
          !parts[0]?.trim() ||
          !parts[1]?.trim() ||
          !ALLOWED_HANDOFF_REASON_LABELS.has(parts[2]!)
        ) {
          throw new Error('push_body_unexpected')
        }
      } else {
        throw new Error('push_body_unexpected')
      }
      break
    }
    case 'needs_person_escalate': {
      if (!/^[^·]+ · [^·]+ · há 5 min$/.test(body)) {
        throw new Error('push_body_unexpected')
      }
      break
    }
    case 'appointment_confirmed': {
      if (!body.startsWith('Agendamento confirmado')) {
        throw new Error('push_body_unexpected')
      }
      break
    }
    default:
      throw new Error('unsupported_push_kind')
  }
}
