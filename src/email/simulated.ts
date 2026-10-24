import { generateOpaqueToken } from '../db/tokens'
import type {
  EmailSendResult,
  EmailTransport,
  InvitationEmailPayload,
  SimulatedMailboxMessage,
} from './types'

export type SimulatedEmailTransport = EmailTransport & {
  readonly mailbox: SimulatedMailboxMessage[]
  /** Força as próximas N tentativas a falhar (retryable). */
  failNext(n: number, error?: string): void
  clear(): void
}

/**
 * Adaptador de e-mail para development/testes.
 * Guarda mensagens só em memória; o token existe apenas no inviteUrl do mailbox.
 */
export function createSimulatedEmailTransport(opts: {
  clock?: { nowMs(): number }
} = {}): SimulatedEmailTransport {
  const mailbox: SimulatedMailboxMessage[] = []
  let failRemaining = 0
  let failError = 'simulated_delivery_failure'
  const clock = opts.clock ?? { nowMs: () => Date.now() }

  return {
    name: 'simulated',
    mailbox,
    failNext(n: number, error = 'simulated_delivery_failure') {
      failRemaining = n
      failError = error
    },
    clear() {
      mailbox.length = 0
      failRemaining = 0
    },
    async sendInvitation(payload: InvitationEmailPayload): Promise<EmailSendResult> {
      if (failRemaining > 0) {
        failRemaining -= 1
        return { ok: false, error: failError, retryable: true }
      }
      const id = `msg_${generateOpaqueToken(8)}`
      const inviteUrl = buildInviteUrl(payload.appBaseUrl, payload.rawToken)
      mailbox.push({
        id,
        toEmail: payload.toEmail,
        template: 'tenant_invitation',
        subject: `Convite Tredane — ${payload.tenantName}`,
        inviteUrl,
        tenantId: payload.tenantId,
        invitationId: payload.invitationId,
        sentAt: clock.nowMs(),
      })
      return { ok: true, providerMessageId: id }
    },
  }
}

export function buildInviteUrl(appBaseUrl: string, rawToken: string): string {
  const base = appBaseUrl.replace(/\/+$/, '')
  return `${base}/invite/accept?token=${encodeURIComponent(rawToken)}`
}

/** Extrai token do inviteUrl do mailbox (testes). */
export function tokenFromInviteUrl(inviteUrl: string): string | null {
  try {
    const url = new URL(inviteUrl)
    return url.searchParams.get('token')
  } catch {
    return null
  }
}
