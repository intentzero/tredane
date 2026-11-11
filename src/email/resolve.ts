/**
 * Escolha do transporte de e-mail a partir de env / binding.
 * simulated → mailbox em memória (dev/CI).
 * cloudflare → Workers Email Sending; fail-closed sem EMAIL + EMAIL_FROM.
 */
import type { Clock } from '../db/clock'
import type { WorkerBindings } from '../worker/bindings'
import { createCloudflareEmailTransport, type SendEmailBinding } from './cloudflare'
import { createSimulatedEmailTransport } from './simulated'
import type { EmailSendResult, EmailTransport } from './types'

export type EmailTransportName = 'simulated' | 'cloudflare' | 'unavailable'

export function createFailClosedEmailTransport(reason: string): EmailTransport {
  const fail = (): Promise<EmailSendResult> =>
    Promise.resolve({ ok: false, error: reason, retryable: false })
  return {
    name: 'unavailable',
    sendInvitation() {
      return fail()
    },
    sendSupportAccessRequest() {
      return fail()
    },
    sendSupportSessionStarted() {
      return fail()
    },
  }
}

function hasSendEmailBinding(env: WorkerBindings | undefined): env is WorkerBindings & {
  EMAIL: SendEmailBinding
} {
  const binding = env?.EMAIL
  return Boolean(binding && typeof binding.send === 'function')
}

/**
 * Lê `EMAIL_TRANSPORT`.
 * - unset / `simulated` → simulated (default local/test)
 * - `cloudflare` → binding EMAIL + EMAIL_FROM; senão fail-closed
 * - outro → fail-closed
 *
 * Se `EMAIL_TRANSPORT` estiver vazio mas o binding EMAIL existir, usa cloudflare
 * (staging/prod com binding presente).
 */
export function resolveEmailTransportName(
  env: WorkerBindings | undefined,
): EmailTransportName {
  const requested = (env?.EMAIL_TRANSPORT ?? '').trim().toLowerCase()
  if (requested === 'simulated') return 'simulated'
  if (requested === 'cloudflare') return 'cloudflare'
  if (!requested && hasSendEmailBinding(env)) return 'cloudflare'
  if (!requested) return 'simulated'
  return 'unavailable'
}

export function resolveEmailTransport(
  env: WorkerBindings | undefined,
  opts: { clock?: Clock } = {},
): EmailTransport {
  const name = resolveEmailTransportName(env)
  if (name === 'simulated') {
    return createSimulatedEmailTransport({ clock: opts.clock })
  }
  if (name === 'unavailable') {
    return createFailClosedEmailTransport('email_transport_unsupported')
  }

  const from = env?.EMAIL_FROM?.trim() ?? ''
  if (!from) {
    return createFailClosedEmailTransport('email_from_required')
  }
  if (!hasSendEmailBinding(env)) {
    return createFailClosedEmailTransport('email_binding_missing')
  }
  return createCloudflareEmailTransport({
    sendEmail: env.EMAIL,
    from,
  })
}

/** Base pública dos links de convite. Local fallback só em development. */
export function resolveAppBaseUrlFromEnv(env: WorkerBindings | undefined): string {
  const configured = env?.APP_BASE_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  const environment = (env?.ENVIRONMENT ?? '').trim().toLowerCase()
  if (!environment || environment === 'development') {
    return 'http://localhost:5173'
  }
  return ''
}
