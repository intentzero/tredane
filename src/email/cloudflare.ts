/**
 * Adaptador Cloudflare Email Sending (Workers binding `EMAIL`).
 * Confirmado Paulo 2026-11-11 — não Resend. Sem API key no path binding.
 * Nunca registar inviteUrl/token/PHI em logs.
 */
import type {
  EmailSendResult,
  EmailTransport,
  InvitationEmailPayload,
  SupportAccessRequestEmailPayload,
  SupportSessionStartedEmailPayload,
} from './types'
import {
  renderInvitationEmail,
  renderSupportAccessRequestEmail,
  renderSupportSessionStartedEmail,
} from './templates'

/** Superfície mínima do binding `send_email` (Workers Email Sending). */
export type SendEmailBinding = {
  send(message: {
    to: string
    from: string
    subject: string
    html?: string
    text?: string
  }): Promise<{ messageId: string }>
}

const RETRYABLE_CODES = new Set([
  'E_RATE_LIMIT_EXCEEDED',
  'E_DAILY_LIMIT_EXCEEDED',
])

function errorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code
    return typeof code === 'string' ? code : null
  }
  return null
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === 'string' && msg) return msg
  }
  return 'cloudflare_email_send_failed'
}

function mapSendError(err: unknown): EmailSendResult {
  const code = errorCode(err)
  const retryable = code != null && RETRYABLE_CODES.has(code)
  return {
    ok: false,
    error: code ?? errorMessage(err),
    retryable,
  }
}

function assertAppBaseUrl(appBaseUrl: string): EmailSendResult | null {
  const base = appBaseUrl.trim()
  if (!base) {
    return { ok: false, error: 'app_base_url_required', retryable: false }
  }
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(base)) {
    return { ok: false, error: 'app_base_url_not_public', retryable: false }
  }
  // Links de convite em staging/prod têm de ser HTTPS públicos.
  if (!/^https:\/\//i.test(base)) {
    return { ok: false, error: 'app_base_url_https_required', retryable: false }
  }
  return null
}

export function createCloudflareEmailTransport(opts: {
  sendEmail: SendEmailBinding
  from: string
}): EmailTransport {
  const from = opts.from.trim()
  const sendEmail = opts.sendEmail

  async function sendRendered(
    toEmail: string,
    rendered: { subject: string; text: string; html: string },
  ): Promise<EmailSendResult> {
    if (!from) {
      return { ok: false, error: 'email_from_required', retryable: false }
    }
    try {
      const response = await sendEmail.send({
        from,
        to: toEmail,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      })
      return { ok: true, providerMessageId: response.messageId }
    } catch (err) {
      return mapSendError(err)
    }
  }

  return {
    name: 'cloudflare',
    async sendInvitation(payload: InvitationEmailPayload): Promise<EmailSendResult> {
      const baseErr = assertAppBaseUrl(payload.appBaseUrl)
      if (baseErr) return baseErr
      return sendRendered(payload.toEmail, renderInvitationEmail(payload))
    },
    async sendSupportAccessRequest(
      payload: SupportAccessRequestEmailPayload,
    ): Promise<EmailSendResult> {
      const baseErr = assertAppBaseUrl(payload.appBaseUrl)
      if (baseErr) return baseErr
      return sendRendered(payload.toEmail, renderSupportAccessRequestEmail(payload))
    },
    async sendSupportSessionStarted(
      payload: SupportSessionStartedEmailPayload,
    ): Promise<EmailSendResult> {
      const baseErr = assertAppBaseUrl(payload.appBaseUrl)
      if (baseErr) return baseErr
      return sendRendered(payload.toEmail, renderSupportSessionStartedEmail(payload))
    },
  }
}
