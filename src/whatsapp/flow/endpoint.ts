/**
 * Lógica do endpoint de dados do Flow (ADR-0016 §5).
 * HTTP: assinatura → decifra → ping/INIT/data_exchange → resposta cifrada.
 * Não escreve BookingFrame; não chama o modelo; não envia WhatsApp.
 * Sessão multi-ecrã: persistida por `flow_token` (D1), não só Map de isolate.
 */
import type { Clock } from '../../db/clock'
import { verifyHubSignature256 } from '../webhook-verify'
import { FLOW_COPY } from './copy'
import {
  decryptFlowRequest,
  encryptFlowResponse,
  importFlowPrivateKey,
  type FlowEncryptedRequest,
} from './crypto'
import {
  applyScreenSubmission,
  nextFlowScreen,
  successPayload,
  type FlowBookingSnapshot,
  type FlowCatalogService,
  type FlowChatFallbackReason,
  type FlowClearedField,
  type FlowScreenId,
  type FlowSlotOption,
} from './screens'
import { EMPTY_FLOW_SESSION, isFlowTokenUsable, type FlowTokenRow } from './tokens'

export type FlowEndpointEnv = {
  WHATSAPP_FLOW_PRIVATE_KEY?: string
  META_APP_SECRET?: string
}

export type FlowDataLookup = (input: {
  token: FlowTokenRow
  frame: FlowBookingSnapshot
}) => Promise<{
  catalog: FlowCatalogService[]
  slots: FlowSlotOption[]
  frame: FlowBookingSnapshot
  catalogMismatch?: boolean
  clearedFields?: FlowClearedField[]
}>

/** Lookup async (D1 em produção). */
export type FlowTokenLookup = (token: string) => Promise<FlowTokenRow | null>

/** Persistência da sessão por token (D1 / memória de teste). */
export type FlowSessionStore = {
  get(token: string): Promise<FlowBookingSnapshot>
  set(token: string, frame: FlowBookingSnapshot): Promise<void>
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function parseActionPayload(payload: unknown): {
  version: string | null
  action: string
  screen: FlowScreenId | null
  data: Record<string, unknown>
  flowToken: string | null
} {
  const root = asRecord(payload) ?? {}
  const action = typeof root.action === 'string' ? root.action : ''
  const version = typeof root.version === 'string' ? root.version : null
  const screen =
    root.screen === 'SERVICO' ||
    root.screen === 'GENERO' ||
    root.screen === 'VARIANTES' ||
    root.screen === 'HORARIO'
      ? root.screen
      : null
  const data = asRecord(root.data) ?? {}
  const flowToken =
    typeof root.flow_token === 'string'
      ? root.flow_token
      : typeof data.flow_token === 'string'
        ? data.flow_token
        : null
  return { version, action, screen, data, flowToken }
}

function mergeFrames(
  preferred: FlowBookingSnapshot,
  fallback: FlowBookingSnapshot,
): FlowBookingSnapshot {
  return {
    serviceId: preferred.serviceId ?? fallback.serviceId,
    line: preferred.line ?? fallback.line,
    variantIds: preferred.variantIds ?? fallback.variantIds,
    slotKey: preferred.slotKey ?? fallback.slotKey,
  }
}

/**
 * Store em memória — só cache/teste. Em produção usa D1 (`createD1SessionStore`).
 * O teste de «perda do Map» passa um store que ignora writes locais.
 */
export function createFlowSessionStore(seed?: Map<string, FlowBookingSnapshot>): FlowSessionStore {
  const map = seed ?? new Map<string, FlowBookingSnapshot>()
  return {
    async get(token) {
      return map.get(token) ? { ...map.get(token)! } : { ...EMPTY_FLOW_SESSION }
    },
    async set(token, frame) {
      map.set(token, { ...frame })
    },
  }
}

/** Sessão lida/escrita na linha do token (D1 ou memory store de tokens). */
export function createTokenBackedSessionStore(ops: {
  getToken: (token: string) => Promise<FlowTokenRow | null>
  saveSession: (token: string, session: FlowBookingSnapshot) => Promise<void>
}): FlowSessionStore {
  return {
    async get(token) {
      const row = await ops.getToken(token)
      return row ? { ...row.session } : { ...EMPTY_FLOW_SESSION }
    },
    async set(token, frame) {
      await ops.saveSession(token, frame)
    },
  }
}

export type HandleFlowDataRequestResult =
  | { status: 200; body: string; contentType: 'text/plain' }
  | { status: 200; body: Record<string, unknown>; contentType: 'application/json' }
  | {
      status: 421 | 427 | 432 | 503
      body: Record<string, unknown>
      /** Códigos estáveis (sem PEM/payload) para o log do Worker. */
      logDetail?: Record<string, string>
    }

function asFallbackReason(reason: string): FlowChatFallbackReason {
  if (
    reason === 'no_slots' ||
    reason === 'too_many_variants' ||
    reason === 'no_bookable_services' ||
    reason === 'too_many_services'
  ) {
    return reason
  }
  return 'no_slots'
}

/**
 * Processa um POST do endpoint Flow.
 * `sessions` deve ser durável por token (D1); Map de isolate não basta entre ecrãs.
 */
export async function handleFlowDataRequest(input: {
  rawBody: string
  signatureHeader: string | null | undefined
  env: FlowEndpointEnv
  clock: Clock
  tokenLookup: FlowTokenLookup
  dataLookup: FlowDataLookup
  sessions: FlowSessionStore
}): Promise<HandleFlowDataRequestResult> {
  const appSecret = (input.env.META_APP_SECRET ?? '').trim()
  if (!appSecret) {
    return { status: 503, body: { error: 'flow_endpoint_unconfigured' } }
  }
  const sigOk = await verifyHubSignature256(
    input.rawBody,
    input.signatureHeader,
    appSecret,
  )
  if (!sigOk) {
    return { status: 432, body: { error: 'signature_invalid' } }
  }

  let encrypted: FlowEncryptedRequest
  try {
    encrypted = JSON.parse(input.rawBody) as FlowEncryptedRequest
  } catch {
    return { status: 421, body: { error: 'body_invalid' } }
  }
  if (
    typeof encrypted.encrypted_flow_data !== 'string' ||
    typeof encrypted.encrypted_aes_key !== 'string' ||
    typeof encrypted.initial_vector !== 'string'
  ) {
    return { status: 421, body: { error: 'body_invalid' } }
  }

  const pem = (input.env.WHATSAPP_FLOW_PRIVATE_KEY ?? '').trim()
  if (!pem) {
    return { status: 503, body: { error: 'flow_endpoint_unconfigured' } }
  }

  let privateKey: CryptoKey
  try {
    privateKey = await importFlowPrivateKey(pem)
  } catch {
    return { status: 503, body: { error: 'flow_key_invalid' } }
  }

  let decrypted: Awaited<ReturnType<typeof decryptFlowRequest>>
  try {
    decrypted = await decryptFlowRequest(privateKey, encrypted)
  } catch (err) {
    // Razão estável (flow_iv_invalid, flow_aes_key_decrypt_failed, …) só para
    // log do Worker — Meta só vê decrypt_failed / 421.
    const reason = err instanceof Error ? err.message : 'decrypt_failed'
    return {
      status: 421,
      body: { error: 'decrypt_failed' },
      logDetail: { reason },
    }
  }

  const parsed = parseActionPayload(decrypted.payload)

  if (parsed.action === 'ping') {
    const body = await encryptFlowResponse(decrypted.aesKey, decrypted.iv, {
      data: { status: 'active' },
    })
    return { status: 200, body, contentType: 'text/plain' }
  }

  if (!parsed.flowToken) {
    return { status: 427, body: { error_msg: FLOW_COPY.tokenExpired } }
  }
  const tokenRow = await input.tokenLookup(parsed.flowToken)
  if (!tokenRow || !isFlowTokenUsable(tokenRow, input.clock.nowMs())) {
    return { status: 427, body: { error_msg: FLOW_COPY.tokenExpired } }
  }

  // Fonte de verdade: sessão do token (sem overlay contínuo do BookingFrame — #537).
  // BACK: re-renderiza a partir da sessão sem aplicar submissão (T15).
  let frame = await input.sessions.get(parsed.flowToken)

  let looked = await input.dataLookup({ token: tokenRow, frame })
  frame = mergeFrames(looked.frame, frame)

  const mismatchMessage = (info: {
    catalogMismatch?: boolean
    clearedFields?: FlowClearedField[]
  }): string | undefined => {
    if (!info.catalogMismatch || !info.clearedFields?.length) return undefined
    if (info.clearedFields.length === 1 && info.clearedFields[0] === 'slotKey') {
      return FLOW_COPY.slotGone
    }
    return FLOW_COPY.catalogChanged
  }

  if (parsed.action === 'data_exchange' && parsed.screen) {
    const applied = applyScreenSubmission(
      looked.catalog,
      frame,
      parsed.screen,
      parsed.data,
      { offeredSlots: looked.slots },
    )
    if (!applied.ok) {
      const again = nextFlowScreen({
        catalog: looked.catalog,
        frame: applied.frame,
        slots: looked.slots,
        errorMessage: applied.errorMessage,
      })
      if ('screen' in again) {
        const body = await encryptFlowResponse(decrypted.aesKey, decrypted.iv, again)
        return { status: 200, body, contentType: 'text/plain' }
      }
      const body = await encryptFlowResponse(decrypted.aesKey, decrypted.iv, {
        screen: parsed.screen,
        data: { error_message: applied.errorMessage },
      })
      return { status: 200, body, contentType: 'text/plain' }
    }
    frame = applied.frame
    await input.sessions.set(parsed.flowToken, frame)
    looked = await input.dataLookup({ token: tokenRow, frame })
    frame = mergeFrames(looked.frame, frame)
  }
  await input.sessions.set(parsed.flowToken, frame)

  const next = nextFlowScreen({
    catalog: looked.catalog,
    frame,
    slots: looked.slots,
    errorMessage: mismatchMessage(looked),
  })

  if ('kind' in next && next.kind === 'ready') {
    const body = await encryptFlowResponse(
      decrypted.aesKey,
      decrypted.iv,
      successPayload(parsed.flowToken, frame),
    )
    return { status: 200, body, contentType: 'text/plain' }
  }

  if ('kind' in next && next.kind === 'chat_fallback') {
    // ADR §3: Flow termina; o chat envia a frase (via nfm_reply + fallback_reason).
    // Não SUCCESS «vazio» sem marcador — Finding 3.
    const body = await encryptFlowResponse(
      decrypted.aesKey,
      decrypted.iv,
      successPayload(parsed.flowToken, frame, {
        fallbackReason: asFallbackReason(next.reason),
      }),
    )
    return { status: 200, body, contentType: 'text/plain' }
  }

  if ('screen' in next) {
    const body = await encryptFlowResponse(decrypted.aesKey, decrypted.iv, next)
    return { status: 200, body, contentType: 'text/plain' }
  }

  return { status: 503, body: { error: 'flow_unexpected' } }
}
