/**
 * Envio live: resposta Graph não-OK expõe error.code/error_subcode no errorCode
 * (ex.: meta_http_400_131030) e loga só números — nunca corpo, token ou waId.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLiveMetaAdapter, metaHttpErrorCode } from './meta'

const ENV = { META_MODE: 'live', META_APP_ID: 'app', META_APP_SECRET: 'secret' }
const TOKEN = 'EAAG-secret-token-value'
const WA_ID = '556181882769'
const BODY = 'mensagem privada do paciente'

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function captureLogs() {
  const lines: string[] = []
  for (const m of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
    })
  }
  return lines
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('metaHttpErrorCode', () => {
  it('formats status, code and subcode', () => {
    expect(metaHttpErrorCode(400, { code: null, subcode: null })).toBe('meta_http_400')
    expect(metaHttpErrorCode(400, { code: 131030, subcode: null })).toBe('meta_http_400_131030')
    expect(metaHttpErrorCode(400, { code: 100, subcode: 2494010 })).toBe(
      'meta_http_400_100_2494010',
    )
  })
})

describe('live send — Graph error codes', () => {
  it('returns meta_http_400_131030 and logs only numeric codes', async () => {
    stubFetch(400, {
      error: {
        message: `(#131030) Recipient phone number not in allowed list ${WA_ID}`,
        type: 'OAuthException',
        code: 131030,
        error_data: { messaging_product: 'whatsapp', details: `to ${WA_ID}` },
        fbtrace_id: 'trace123',
      },
    })
    const logs = captureLogs()
    const meta = createLiveMetaAdapter(ENV)
    const r = await meta.sendTextMessage({
      phoneNumberId: '1457274720794019',
      accessToken: TOKEN,
      toWaId: WA_ID,
      body: BODY,
    })
    expect(r).toEqual({ outcome: 'failed', errorCode: 'meta_http_400_131030' })
    const all = logs.join('\n')
    expect(all).toContain('meta.send_http_error')
    expect(all).toContain('131030')
    expect(all).not.toContain(TOKEN)
    expect(all).not.toContain(WA_ID)
    expect(all).not.toContain(BODY)
    expect(all).not.toContain('allowed list')
    expect(all).not.toContain('trace123')
  })

  it('includes error_subcode when present (template send)', async () => {
    stubFetch(400, { error: { code: 100, error_subcode: 2494010, message: 'x' } })
    captureLogs()
    const meta = createLiveMetaAdapter(ENV)
    const r = await meta.sendTemplateMessage({
      phoneNumberId: 'p',
      accessToken: TOKEN,
      toWaId: WA_ID,
      templateName: 't',
      language: 'pt_BR',
      bodyParams: [],
    })
    expect(r).toEqual({ outcome: 'failed', errorCode: 'meta_http_400_100_2494010' })
  })

  it('falls back to meta_http_<status> for non-JSON or malformed bodies', async () => {
    captureLogs()
    const meta = createLiveMetaAdapter(ENV)
    stubFetch(502, '<html>bad gateway</html>')
    expect(
      await meta.sendTextMessage({ phoneNumberId: 'p', accessToken: TOKEN, toWaId: WA_ID, body: BODY }),
    ).toEqual({ outcome: 'failed', errorCode: 'meta_http_502' })
    stubFetch(400, { error: { code: 'abc', error_subcode: -1 } })
    expect(
      await meta.sendTextMessage({ phoneNumberId: 'p', accessToken: TOKEN, toWaId: WA_ID, body: BODY }),
    ).toEqual({ outcome: 'failed', errorCode: 'meta_http_400' })
  })

  it('still returns the wamid on success', async () => {
    stubFetch(200, { messages: [{ id: 'wamid.OK' }] })
    const meta = createLiveMetaAdapter(ENV)
    expect(
      await meta.sendTextMessage({ phoneNumberId: 'p', accessToken: TOKEN, toWaId: WA_ID, body: BODY }),
    ).toEqual({ outcome: 'succeeded', providerMessageId: 'wamid.OK' })
  })
})
