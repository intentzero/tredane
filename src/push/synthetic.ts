/**
 * Transporte synthetic de push (#42) — regista envios sem HTTP a FCM/APNs.
 * Espelha o padrão EMAIL_TRANSPORT=simulated / AI_MODE=synthetic.
 */
import type { Clock } from '../db/clock'
import type {
  PushSendRecord,
  PushTransport,
  PushTransportResult,
} from './types'

export type SimulatedPushTransport = PushTransport & {
  readonly mailbox: PushSendRecord[]
  clear(): void
}

let seq = 0

export function createSimulatedPushTransport(opts?: {
  clock?: Clock
  /** Endpoints que simulam 410 Gone (limpeza de subs). */
  goneEndpoints?: Set<string> | string[]
}): SimulatedPushTransport {
  const mailbox: PushSendRecord[] = []
  const gone = new Set(
    opts?.goneEndpoints
      ? [...opts.goneEndpoints]
      : [],
  )

  return {
    mailbox,
    clear() {
      mailbox.length = 0
    },
    async send(subscription, payload): Promise<PushTransportResult> {
      const sentAt = opts?.clock?.nowMs() ?? Date.now()
      if (gone.has(subscription.endpoint)) {
        mailbox.push({
          id: `psend_gone_${++seq}`,
          tenantId: payload.tenantId,
          clerkUserId: '',
          endpoint: subscription.endpoint,
          conversationId: payload.conversationId,
          payload,
          sentAt,
          mode: 'synthetic',
          status: 'gone',
          errorCode: 'gone',
        })
        return { ok: false, gone: true, status: 410 }
      }

      // Guardrail: nunca aceitar campos sensíveis no payload synthetic.
      const raw = JSON.stringify(payload)
      if (
        /bodyPreview|waId|"body":\s*"[^"]{20,}/.test(raw) &&
        payload.kind !== 'new_conversation'
      ) {
        return { ok: false, gone: false, status: 400, errorCode: 'payload_rejected' }
      }

      mailbox.push({
        id: `psend_${++seq}`,
        tenantId: payload.tenantId,
        clerkUserId: '',
        endpoint: subscription.endpoint,
        conversationId: payload.conversationId,
        payload,
        sentAt,
        mode: 'synthetic',
        status: 'sent',
      })
      return { ok: true, status: 201 }
    },
  }
}
