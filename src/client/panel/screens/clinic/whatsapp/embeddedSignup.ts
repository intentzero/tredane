/**
 * Embedded Signup v4 (Meta JS SDK) — launch + captura de code + IDs.
 * Doc: developers.facebook.com/.../whatsapp/embedded-signup/implementation
 * v4: config_id na Login for Business; sem version/sessionInfoVersion em extras.
 */

const SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js'

export type EmbeddedSignupAssets = {
  code: string
  phoneNumberId: string
  wabaId: string
  displayPhone: string | null
  displayName: string | null
}

export type EmbeddedSignupErrorKind =
  | 'cancelled'
  | 'missing_phone'
  | 'missing_code'
  | 'reported'
  | 'sdk'
  | 'config'

export class EmbeddedSignupError extends Error {
  readonly kind: EmbeddedSignupErrorKind

  constructor(kind: EmbeddedSignupErrorKind, message: string) {
    super(message)
    this.name = 'EmbeddedSignupError'
    this.kind = kind
  }
}

type FbLoginResponse = {
  authResponse?: { code?: string } | null
}

type FbSdk = {
  init: (opts: {
    appId: string
    autoLogAppEvents?: boolean
    xfbml?: boolean
    version: string
  }) => void
  login: (
    cb: (response: FbLoginResponse) => void,
    opts: {
      config_id: string
      response_type: string
      override_default_response_type: boolean
      extras: { setup: Record<string, never> }
    },
  ) => void
}

type FbWindow = Window & {
  FB?: FbSdk
  fbAsyncInit?: () => void
}

let sdkLoadPromise: Promise<FbSdk> | null = null

function readFb(): FbSdk | undefined {
  return (window as FbWindow).FB
}

/** Carrega o SDK uma vez; reutiliza se já estiver no documento. */
export function ensureFacebookSdk(): Promise<FbSdk> {
  const existing = readFb()
  if (existing) return Promise.resolve(existing)
  if (sdkLoadPromise) return sdkLoadPromise

  sdkLoadPromise = new Promise<FbSdk>((resolve, reject) => {
    const w = window as FbWindow
    const previous = w.fbAsyncInit
    w.fbAsyncInit = () => {
      try {
        previous?.()
      } catch {
        /* ignore previous init errors */
      }
      const fb = readFb()
      if (!fb) {
        reject(
          new EmbeddedSignupError(
            'sdk',
            'Não foi possível iniciar a conexão com o Facebook. Atualize a página e tente de novo.',
          ),
        )
        return
      }
      resolve(fb)
    }

    const already = document.querySelector<HTMLScriptElement>(`script[src="${SDK_SRC}"]`)
    if (already) {
      const fb = readFb()
      if (fb) {
        resolve(fb)
        return
      }
      // script no DOM, ainda a carregar — fbAsyncInit resolve
      return
    }

    const script = document.createElement('script')
    script.async = true
    script.defer = true
    script.crossOrigin = 'anonymous'
    script.src = SDK_SRC
    script.onerror = () => {
      sdkLoadPromise = null
      reject(
        new EmbeddedSignupError(
          'sdk',
          'Não foi possível carregar a conexão com o Facebook. Verifique a internet e tente de novo.',
        ),
      )
    }
    document.head.appendChild(script)
  })

  return sdkLoadPromise
}

/** @internal testes — limpa cache do loader. */
export function resetFacebookSdkLoaderForTests(): void {
  sdkLoadPromise = null
}

export type WaEmbeddedSignupMessage = {
  type?: string
  event?: string
  data?: {
    phone_number_id?: string
    waba_id?: string
    display_phone_number?: string
    current_step?: string
    error_message?: string
    error_code?: string
  }
}

/** Origem Meta segura: facebook.com ou *.facebook.com (não «evilfacebook.com»). */
export function isFacebookMessageOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase()
    return host === 'facebook.com' || host.endsWith('.facebook.com')
  } catch {
    return false
  }
}

/** Extrai payload WA_EMBEDDED_SIGNUP de um MessageEvent (origem facebook.com). */
export function parseWaEmbeddedSignupMessage(
  event: Pick<MessageEvent, 'origin' | 'data'>,
): WaEmbeddedSignupMessage | null {
  if (typeof event.origin !== 'string' || !isFacebookMessageOrigin(event.origin)) {
    return null
  }
  let raw: unknown = event.data
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }
  if (!raw || typeof raw !== 'object') return null
  const msg = raw as WaEmbeddedSignupMessage
  if (msg.type !== 'WA_EMBEDDED_SIGNUP') return null
  return msg
}

type SessionIds = {
  phoneNumberId: string
  wabaId: string
  displayPhone: string | null
}

function sessionIdsFromMessage(msg: WaEmbeddedSignupMessage): SessionIds | null {
  const phone = msg.data?.phone_number_id?.trim()
  const waba = msg.data?.waba_id?.trim()
  if (!phone || !waba) return null
  const display = msg.data?.display_phone_number?.trim() || null
  return { phoneNumberId: phone, wabaId: waba, displayPhone: display }
}

/**
 * Abre o popup Embedded Signup v4 e resolve com code + phone/waba.
 * O code só chega no callback do FB.login (Finish); os IDs no postMessage.
 */
export async function launchWhatsAppEmbeddedSignup(input: {
  appId: string
  configId: string
  graphApiVersion: string
  ensureSdk?: () => Promise<FbSdk>
}): Promise<EmbeddedSignupAssets> {
  const appId = input.appId.trim()
  const configId = input.configId.trim()
  const version = (input.graphApiVersion.trim() || 'v25.0').replace(/^\/+/, '')
  if (!appId || !configId) {
    throw new EmbeddedSignupError(
      'config',
      'A conexão com o WhatsApp ainda não está configurada. Fale com o suporte do Tredane.',
    )
  }

  const fb = await (input.ensureSdk ?? ensureFacebookSdk)()
  fb.init({
    appId,
    autoLogAppEvents: true,
    xfbml: false,
    version,
  })

  let session: SessionIds | null = null
  let cancelled = false
  let missingPhone = false
  let reported: string | null = null

  const onMessage = (event: MessageEvent) => {
    const msg = parseWaEmbeddedSignupMessage(event)
    if (!msg) return
    const eventName = (msg.event ?? '').toUpperCase()
    if (eventName === 'CANCEL') {
      cancelled = true
      return
    }
    if (eventName === 'ERROR') {
      reported =
        msg.data?.error_message?.trim() ||
        'A Meta reportou um erro na conexão. Tente de novo ou fale com o suporte.'
      return
    }
    if (eventName.startsWith('FINISH')) {
      const ids = sessionIdsFromMessage(msg)
      if (ids) {
        session = ids
        missingPhone = false
        return
      }
      // FINISH sem phone_number_id (ex. FINISH_ONLY_WABA) — canal de chat precisa de número.
      missingPhone = true
    }
  }

  window.addEventListener('message', onMessage)
  try {
    const login = await new Promise<FbLoginResponse>((resolve) => {
      fb.login((response) => resolve(response ?? {}), {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {} },
      })
    })

    if (reported) {
      throw new EmbeddedSignupError('reported', reported)
    }
    if (cancelled) {
      throw new EmbeddedSignupError(
        'cancelled',
        'Você cancelou a conexão com o WhatsApp. Pode tentar de novo quando quiser.',
      )
    }
    if (!session && !missingPhone) {
      // postMessage costuma chegar antes do callback; espera curta se ainda não veio.
      session = await waitForSession(() => session, 2500)
    }
    if (!session) {
      if (missingPhone) {
        throw new EmbeddedSignupError(
          'missing_phone',
          'Essa conta do Facebook não tem número de WhatsApp. Escolha ou crie um número e tente de novo.',
        )
      }
      throw new EmbeddedSignupError(
        'cancelled',
        'Você cancelou a conexão com o WhatsApp. Pode tentar de novo quando quiser.',
      )
    }

    const code = login.authResponse?.code?.trim()
    if (!code) {
      // Fechou o popup no ecrã final sem Finish — IDs existem, code não.
      throw new EmbeddedSignupError(
        'missing_code',
        'Para concluir, finalize no Facebook com o botão de concluir (não feche só a janela).',
      )
    }

    return {
      code,
      phoneNumberId: session.phoneNumberId,
      wabaId: session.wabaId,
      displayPhone: session.displayPhone,
      displayName: null,
    }
  } finally {
    window.removeEventListener('message', onMessage)
  }
}

function waitForSession(
  read: () => SessionIds | null,
  ms: number,
): Promise<SessionIds | null> {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      const value = read()
      if (value) {
        resolve(value)
        return
      }
      if (Date.now() - started >= ms) {
        resolve(null)
        return
      }
      window.setTimeout(tick, 50)
    }
    tick()
  })
}
