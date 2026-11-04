/**
 * Lógica do endpoint de dados do Flow (ADR-0016 §5).
 * HTTP: assinatura → decifra → ping/INIT/data_exchange → resposta cifrada.
 * Não escreve BookingFrame; não chama o modelo; não envia WhatsApp.
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
  type FlowScreenId,
  type FlowSlotOption,
} from './screens'
import {
  getFlowToken,
  isFlowTokenUsable,
  type FlowTokenRow,
} from './tokens'

export type FlowEndpointEnv = {
  WHATSAPP_FLOW_PRIVATE_KEY?: string
  META_APP_SECRET?: string
}

export type FlowSessionState = FlowBookingSnapshot

export type FlowDataLookup = (input: {
  token: FlowTokenRow
  frame: FlowBookingSnapshot
}) => Promise<{
  catalog: FlowCatalogService[]
  slots: FlowSlotOption[]
  frame: FlowBookingSnapshot
}>

export type FlowTokenLookup = (token: string) => FlowTokenRow | null

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

/** Estado em memória por token durante a sessão do endpoint (tests / single-worker). */
export function createFlowSessionStore(): {
  get(token: string): FlowBookingSnapshot
  set(token: string, frame: FlowBookingSnapshot): void
} {
  const map = new Map<string, FlowBookingSnapshot>()
  return {
    get(token) {
      return (
        map.get(token) ?? {
          serviceId: null,
          line: null,
          variantIds: null,
          slotKey: null,
        }
      )
    },
    set(token, frame) {
      map.set(token, frame)
    },
  }
}

export type HandleFlowDataRequestResult =
  | { status: 200; body: string; contentType: 'text/plain' }
  | { status: 200; body: Record<string, unknown>; contentType: 'application/json' }
  | { status: 421 | 427 | 432 | 503; body: Record<string, unknown> }

/**
 * Processa um POST do endpoint Flow.
 * `lookup` é injectável: em produção consulta o DO da clínica do token.
 */
export async function handleFlowDataRequest(input: {
  rawBody: string
  signatureHeader: string | null | undefined
  env: FlowEndpointEnv
  clock: Clock
  tokenLookup: FlowTokenLookup
  dataLookup: FlowDataLookup
  sessions?: ReturnType<typeof createFlowSessionStore>
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
  } catch {
    return { status: 421, body: { error: 'decrypt_failed' } }
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
  const tokenRow = input.tokenLookup(parsed.flowToken)
  if (!tokenRow || !isFlowTokenUsable(tokenRow, input.clock.nowMs())) {
    return { status: 427, body: { error_msg: FLOW_COPY.tokenExpired } }
  }

  const sessions = input.sessions ?? createFlowSessionStore()
  let frame = sessions.get(parsed.flowToken)

  let looked = await input.dataLookup({ token: tokenRow, frame })
  // Preferir o frame do DO (texto livre pode ter preenchido campos).
  frame = {
    serviceId: looked.frame.serviceId ?? frame.serviceId,
    line: looked.frame.line ?? frame.line,
    variantIds: looked.frame.variantIds ?? frame.variantIds,
    slotKey: looked.frame.slotKey ?? frame.slotKey,
  }

  if (parsed.action === 'data_exchange' && parsed.screen) {
    const applied = applyScreenSubmission(
      looked.catalog,
      frame,
      parsed.screen,
      parsed.data,
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
    sessions.set(parsed.flowToken, frame)
    looked = await input.dataLookup({ token: tokenRow, frame })
  }
  sessions.set(parsed.flowToken, frame)

  const next = nextFlowScreen({
    catalog: looked.catalog,
    frame,
    slots: looked.slots,
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
    // Sem ecrã útil: termina o Flow; o chat assume (ADR).
    const body = await encryptFlowResponse(
      decrypted.aesKey,
      decrypted.iv,
      successPayload(parsed.flowToken, frame),
    )
    return { status: 200, body, contentType: 'text/plain' }
  }

  if ('screen' in next) {
    const body = await encryptFlowResponse(decrypted.aesKey, decrypted.iv, next)
    return { status: 200, body, contentType: 'text/plain' }
  }

  return { status: 503, body: { error: 'flow_unexpected' } }
}

/** Atalho de testes: lookup síncrono de token via getFlowToken + AdminDb fake. */
export function tokenLookupFromDb(
  get: typeof getFlowToken,
  db: Parameters<typeof getFlowToken>[0],
): FlowTokenLookup {
  return (token) => get(db, token)
}
