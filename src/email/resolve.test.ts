import { describe, expect, it, vi } from 'vitest'
import {
  createCloudflareEmailTransport,
  createFailClosedEmailTransport,
  resolveAppBaseUrlFromEnv,
  resolveEmailTransport,
  resolveEmailTransportName,
  type SendEmailBinding,
} from './index'
import type { WorkerBindings } from '../worker/bindings'

function env(over: Partial<WorkerBindings> = {}): WorkerBindings {
  return {
    DB: null as unknown as WorkerBindings['DB'],
    CLINIC: null as unknown as WorkerBindings['CLINIC'],
    ATTACHMENTS: null as unknown as WorkerBindings['ATTACHMENTS'],
    INBOUND_EVENTS: null as unknown as WorkerBindings['INBOUND_EVENTS'],
    ...over,
  }
}

describe('resolveEmailTransport — selecção', () => {
  it('default e EMAIL_TRANSPORT=simulated usam mailbox em memória', () => {
    expect(resolveEmailTransportName(env())).toBe('simulated')
    expect(resolveEmailTransportName(env({ EMAIL_TRANSPORT: 'simulated' }))).toBe(
      'simulated',
    )
    expect(resolveEmailTransport(env()).name).toBe('simulated')
  })

  it('cloudflare com EMAIL + EMAIL_FROM resolve o adaptador real', () => {
    const send = vi.fn(async () => ({ messageId: 'msg_cf_1' }))
    const transport = resolveEmailTransport(
      env({
        EMAIL_TRANSPORT: 'cloudflare',
        EMAIL_FROM: 'noreply@tredane.com',
        EMAIL: { send },
      }),
    )
    expect(transport.name).toBe('cloudflare')
  })

  it('binding EMAIL presente sem EMAIL_TRANSPORT escolhe cloudflare', () => {
    expect(
      resolveEmailTransportName(
        env({
          EMAIL_FROM: 'noreply@tredane.com',
          EMAIL: { send: async () => ({ messageId: 'x' }) },
        }),
      ),
    ).toBe('cloudflare')
  })

  it('cloudflare sem EMAIL_FROM ou binding falha fechado (não simulated)', () => {
    expect(
      resolveEmailTransport(
        env({ EMAIL_TRANSPORT: 'cloudflare', EMAIL_FROM: 'noreply@tredane.com' }),
      ).name,
    ).toBe('unavailable')
    expect(
      resolveEmailTransport(
        env({
          EMAIL_TRANSPORT: 'cloudflare',
          EMAIL: { send: async () => ({ messageId: 'x' }) },
        }),
      ).name,
    ).toBe('unavailable')
  })

  it('transporte desconhecido falha fechado', () => {
    const t = resolveEmailTransport(env({ EMAIL_TRANSPORT: 'resend' }))
    expect(t.name).toBe('unavailable')
  })

  it('fail-closed devolve emailSent=false sem retry', async () => {
    const t = createFailClosedEmailTransport('email_binding_missing')
    const result = await t.sendInvitation({
      toEmail: 'a@example.test',
      tenantId: 'clinic-demo-a',
      tenantName: 'Demo',
      invitationId: 'inv_1',
      rawToken: 'tok_secret',
      expiresAt: Date.now() + 60_000,
      appBaseUrl: 'https://staging.app.tredane.com',
    })
    expect(result).toEqual({
      ok: false,
      error: 'email_binding_missing',
      retryable: false,
    })
  })
})

describe('createCloudflareEmailTransport', () => {
  it('envia convite com from/to/subject e devolve messageId', async () => {
    const send = vi.fn(async () => ({ messageId: 'cf_msg_42' }))
    const binding: SendEmailBinding = { send }
    const transport = createCloudflareEmailTransport({
      sendEmail: binding,
      from: 'noreply@tredane.com',
    })
    const result = await transport.sendInvitation({
      toEmail: 'guest@example.test',
      tenantId: 'clinic-demo-a',
      tenantName: 'Clínica Demo',
      invitationId: 'inv_9',
      rawToken: 'tok_plain',
      expiresAt: Date.now() + 7 * 24 * 3600_000,
      appBaseUrl: 'https://staging.app.tredane.com',
    })
    expect(result).toEqual({ ok: true, providerMessageId: 'cf_msg_42' })
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'noreply@tredane.com',
        to: 'guest@example.test',
        subject: expect.stringContaining('Clínica Demo'),
        text: expect.stringContaining(
          'https://staging.app.tredane.com/invite/accept?token=tok_plain',
        ),
        html: expect.stringContaining('invite/accept?token=tok_plain'),
      }),
    )
  })

  it('recusa APP_BASE_URL localhost/http e mapeia E_SENDER_NOT_VERIFIED como não retryable', async () => {
    const transport = createCloudflareEmailTransport({
      sendEmail: {
        send: async () => {
          throw Object.assign(new Error('sender domain not verified'), {
            code: 'E_SENDER_NOT_VERIFIED',
          })
        },
      },
      from: 'noreply@tredane.com',
    })
    const local = await transport.sendInvitation({
      toEmail: 'a@example.test',
      tenantId: 't',
      tenantName: 'T',
      invitationId: 'i',
      rawToken: 'tok',
      expiresAt: 1,
      appBaseUrl: 'http://localhost:5173',
    })
    expect(local).toEqual({
      ok: false,
      error: 'app_base_url_not_public',
      retryable: false,
    })

    const plainHttp = await transport.sendInvitation({
      toEmail: 'a@example.test',
      tenantId: 't',
      tenantName: 'T',
      invitationId: 'i',
      rawToken: 'tok',
      expiresAt: 1,
      appBaseUrl: 'http://staging.app.tredane.com',
    })
    expect(plainHttp).toEqual({
      ok: false,
      error: 'app_base_url_https_required',
      retryable: false,
    })

    const unverified = await transport.sendInvitation({
      toEmail: 'a@example.test',
      tenantId: 't',
      tenantName: 'T',
      invitationId: 'i',
      rawToken: 'tok',
      expiresAt: 1,
      appBaseUrl: 'https://staging.app.tredane.com',
    })
    expect(unverified).toEqual({
      ok: false,
      error: 'E_SENDER_NOT_VERIFIED',
      retryable: false,
    })
  })

  it('sanitiza CRLF no subject do convite', async () => {
    const send = vi.fn(async () => ({ messageId: 'cf_msg_safe' }))
    const transport = createCloudflareEmailTransport({
      sendEmail: { send },
      from: 'noreply@tredane.com',
    })
    await transport.sendInvitation({
      toEmail: 'a@example.test',
      tenantId: 't',
      tenantName: 'Clinica\r\nBcc: evil@x.test',
      invitationId: 'i',
      rawToken: 'tok',
      expiresAt: 1,
      appBaseUrl: 'https://staging.app.tredane.com',
    })
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Convite Tredane — Clinica Bcc: evil@x.test',
      }),
    )
    const subject = (send.mock.calls as unknown as Array<[{ subject: string }]>)[0]?.[0]
      ?.subject
    expect(subject).toBeDefined()
    expect(subject!).not.toMatch(/[\r\n]/)
  })

  it('marca E_RATE_LIMIT_EXCEEDED como retryable', async () => {
    const transport = createCloudflareEmailTransport({
      sendEmail: {
        send: async () => {
          throw Object.assign(new Error('throttled'), {
            code: 'E_RATE_LIMIT_EXCEEDED',
          })
        },
      },
      from: 'noreply@tredane.com',
    })
    const result = await transport.sendInvitation({
      toEmail: 'a@example.test',
      tenantId: 't',
      tenantName: 'T',
      invitationId: 'i',
      rawToken: 'tok',
      expiresAt: 1,
      appBaseUrl: 'https://staging.app.tredane.com',
    })
    expect(result).toEqual({
      ok: false,
      error: 'E_RATE_LIMIT_EXCEEDED',
      retryable: true,
    })
  })
})

describe('resolveAppBaseUrlFromEnv', () => {
  it('usa APP_BASE_URL; fallback localhost só em development', () => {
    expect(
      resolveAppBaseUrlFromEnv(
        env({ APP_BASE_URL: 'https://staging.app.tredane.com/' }),
      ),
    ).toBe('https://staging.app.tredane.com')
    expect(resolveAppBaseUrlFromEnv(env({ ENVIRONMENT: 'development' }))).toBe(
      'http://localhost:5173',
    )
    expect(resolveAppBaseUrlFromEnv(env({ ENVIRONMENT: 'staging' }))).toBe('')
  })
})
