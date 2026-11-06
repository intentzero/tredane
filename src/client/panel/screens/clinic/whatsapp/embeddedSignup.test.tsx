/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EmbeddedSignupError,
  launchWhatsAppEmbeddedSignup,
  parseWaEmbeddedSignupMessage,
  resetFacebookSdkLoaderForTests,
} from './embeddedSignup'

afterEach(() => {
  resetFacebookSdkLoaderForTests()
  vi.restoreAllMocks()
  document.head.innerHTML = ''
})

describe('parseWaEmbeddedSignupMessage', () => {
  it('aceita JSON string de facebook.com', () => {
    const msg = parseWaEmbeddedSignupMessage({
      origin: 'https://www.facebook.com',
      data: JSON.stringify({
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'FINISH',
        data: { phone_number_id: 'pn1', waba_id: 'waba1' },
      }),
    })
    expect(msg?.event).toBe('FINISH')
    expect(msg?.data?.phone_number_id).toBe('pn1')
  })

  it('aceita objecto já parseado', () => {
    const msg = parseWaEmbeddedSignupMessage({
      origin: 'https://web.facebook.com',
      data: {
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'CANCEL',
        data: { current_step: 'PHONE_NUMBER_SETUP' },
      },
    })
    expect(msg?.event).toBe('CANCEL')
  })

  it('ignora origem e type errados', () => {
    expect(
      parseWaEmbeddedSignupMessage({
        origin: 'https://evil.example',
        data: { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH' },
      }),
    ).toBeNull()
    expect(
      parseWaEmbeddedSignupMessage({
        origin: 'https://evilfacebook.com',
        data: { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH' },
      }),
    ).toBeNull()
    expect(
      parseWaEmbeddedSignupMessage({
        origin: 'https://www.facebook.com',
        data: { type: 'OTHER', event: 'FINISH' },
      }),
    ).toBeNull()
  })
})

describe('launchWhatsAppEmbeddedSignup', () => {
  function mockFb(opts: {
    code?: string | null
    postMessage?: object | null
    postBeforeLogin?: boolean
  }) {
    const login = vi.fn((cb: (r: { authResponse?: { code?: string } | null }) => void) => {
      if (opts.postMessage && !opts.postBeforeLogin) {
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: 'https://www.facebook.com',
            data: opts.postMessage,
          }),
        )
      }
      queueMicrotask(() => {
        cb({
          authResponse:
            opts.code === null ? null : opts.code !== undefined ? { code: opts.code } : { code: 'exch_code' },
        })
      })
    })
    const init = vi.fn()
    const fb = { init, login }
    if (opts.postMessage && opts.postBeforeLogin) {
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: 'https://www.facebook.com',
            data: opts.postMessage,
          }),
        )
      })
    }
    return {
      fb,
      ensureSdk: async () => fb,
    }
  }

  it('devolve code + phone + waba no FINISH', async () => {
    const { ensureSdk, fb } = mockFb({
      code: 'code_abc',
      postMessage: {
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'FINISH',
        data: {
          phone_number_id: '1457274720794019',
          waba_id: '1387322233420162',
          display_phone_number: '+1 555-182-0342',
        },
      },
    })
    const result = await launchWhatsAppEmbeddedSignup({
      appId: '3651532788318487',
      configId: '1876604960374955',
      graphApiVersion: 'v25.0',
      ensureSdk,
    })
    expect(result).toEqual({
      code: 'code_abc',
      phoneNumberId: '1457274720794019',
      wabaId: '1387322233420162',
      displayPhone: '+1 555-182-0342',
      displayName: null,
    })
    expect(fb.init).toHaveBeenCalledWith(
      expect.objectContaining({ appId: '3651532788318487', version: 'v25.0' }),
    )
    expect(fb.login).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        config_id: '1876604960374955',
        response_type: 'code',
        override_default_response_type: true,
      }),
    )
  })

  it('cancela no CANCEL', async () => {
    const { ensureSdk } = mockFb({
      code: null,
      postMessage: {
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'CANCEL',
        data: { current_step: 'PHONE_NUMBER_SETUP' },
      },
    })
    await expect(
      launchWhatsAppEmbeddedSignup({
        appId: 'app',
        configId: 'cfg',
        graphApiVersion: 'v25.0',
        ensureSdk,
      }),
    ).rejects.toMatchObject({ kind: 'cancelled' } satisfies Partial<EmbeddedSignupError>)
  })

  it('exige número quando FINISH_ONLY_WABA', async () => {
    const { ensureSdk } = mockFb({
      code: 'code_only_waba',
      postMessage: {
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'FINISH_ONLY_WABA',
        data: { waba_id: 'waba_only' },
      },
    })
    await expect(
      launchWhatsAppEmbeddedSignup({
        appId: 'app',
        configId: 'cfg',
        graphApiVersion: 'v25.0',
        ensureSdk,
      }),
    ).rejects.toMatchObject({ kind: 'missing_phone' })
  })

  it('exige Finish quando há IDs sem code', async () => {
    const { ensureSdk } = mockFb({
      code: null,
      postMessage: {
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'FINISH',
        data: { phone_number_id: 'pn', waba_id: 'waba' },
      },
    })
    await expect(
      launchWhatsAppEmbeddedSignup({
        appId: 'app',
        configId: 'cfg',
        graphApiVersion: 'v25.0',
        ensureSdk,
      }),
    ).rejects.toMatchObject({ kind: 'missing_code' })
  })

  it('falha fechado sem config_id', async () => {
    await expect(
      launchWhatsAppEmbeddedSignup({
        appId: 'app',
        configId: '  ',
        graphApiVersion: 'v25.0',
        ensureSdk: async () => ({ init: vi.fn(), login: vi.fn() }),
      }),
    ).rejects.toMatchObject({ kind: 'config' })
  })
})
