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
import { isFlowHubStubAction, type FlowHubAction } from './copy'
import {
  applyScreenSubmission,
  entryFlowScreen,
  FLOW_ENTRY_SCREEN,
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
  /** Total cotado para o corpo do HORARIO. Ausente = não acrescentar linha. */
  visitTotalLine?: string | null
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
    root.screen === 'HUB' ||
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

/**
 * Após dataLookup, o frame do DO/revalidação é autoritativo — inclusive `null`
 * explícito (ex.: slot stale limpo). Não usar `??` com a sessão: restauraria
 * o valor stale e saltaria para SUCCESS sem C15 (finding S1 review #542).
 */
function takeLookedFrame(looked: FlowBookingSnapshot): FlowBookingSnapshot {
  return {
    serviceId: looked.serviceId,
    line: looked.line,
    variantIds: looked.variantIds,
    slotKey: looked.slotKey,
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
  | {
      status: 200
      body: string
      contentType: 'text/plain'
      /** Códigos estáveis (sem PEM/payload) para o log do Worker. */
      logDetail?: Record<string, string>
    }
  | {
      status: 200
      body: Record<string, unknown>
      contentType: 'application/json'
      logDetail?: Record<string, string>
    }
  | {
      status: 421 | 427 | 432 | 503
      body: Record<string, unknown>
      /** Códigos estáveis (sem PEM/payload) para o log do Worker. */
      logDetail?: Record<string, string>
    }

function withVersion(
  version: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return { version, ...payload }
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
  // Protocolo data API: pedido traz version (Meta: "3.0" mesmo com
  // data_api_version 4.0 no Flow JSON). Ecoamos na resposta cifrada.
  const responseVersion = parsed.version ?? '3.0'

  if (parsed.action === 'ping') {
    const body = await encryptFlowResponse(
      decrypted.aesKey,
      decrypted.iv,
      withVersion(responseVersion, { data: { status: 'active' } }),
    )
    return {
      status: 200,
      body,
      contentType: 'text/plain',
      logDetail: { action: 'ping' },
    }
  }

  // Meta: pedido assíncrono quando a resposta anterior violou o schema
  // (ex.: payload-schema-error). Só acusar; não tentar montar ecrã.
  if (typeof parsed.data.error === 'string') {
    const body = await encryptFlowResponse(
      decrypted.aesKey,
      decrypted.iv,
      withVersion(responseVersion, { data: { acknowledged: true } }),
    )
    return {
      status: 200,
      body,
      contentType: 'text/plain',
      logDetail: {
        action: parsed.action || 'error_notification',
        client_error: parsed.data.error,
        ...(typeof parsed.data.error_message === 'string'
          ? { client_error_message: parsed.data.error_message.slice(0, 200) }
          : {}),
      },
    }
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

  let looked: Awaited<ReturnType<FlowDataLookup>>
  try {
    looked = await input.dataLookup({ token: tokenRow, frame })
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'data_lookup_failed'
    return {
      status: 503,
      body: { error: 'flow_unexpected' },
      logDetail: { reason, action: parsed.action || 'unknown' },
    }
  }
  frame = takeLookedFrame(looked.frame)

  const mismatchMessage = (info: {
    catalogMismatch?: boolean
    clearedFields?: FlowClearedField[]
  }): string | undefined => {
    if (!info.clearedFields?.length) return undefined
    // Slot deixou de estar livre (com ou sem mudança de catálogo) → C15.
    if (info.clearedFields.every((f) => f === 'slotKey')) {
      return FLOW_COPY.slotGone
    }
    if (info.catalogMismatch) return FLOW_COPY.catalogChanged
    if (info.clearedFields.includes('slotKey')) return FLOW_COPY.slotGone
    return undefined
  }

  let hubActionFromSubmit: FlowHubAction | null = null

  if (parsed.action === 'data_exchange' && parsed.screen) {
    const applied = applyScreenSubmission(
      looked.catalog,
      frame,
      parsed.screen,
      parsed.data,
      { offeredSlots: looked.slots },
    )
    if (!applied.ok) {
      // HUB inválido: re-mostrar o entry, não o funil Agendar.
      if (parsed.screen === 'HUB') {
        const hubAgain = entryFlowScreen({
          catalog: looked.catalog,
          frame: applied.frame,
          errorMessage: applied.errorMessage,
        })
        if ('screen' in hubAgain) {
          const body = await encryptFlowResponse(
            decrypted.aesKey,
            decrypted.iv,
            withVersion(responseVersion, hubAgain),
          )
          return {
            status: 200,
            body,
            contentType: 'text/plain',
            logDetail: {
              action: 'data_exchange',
              screen: 'HUB',
              outcome: 'validation_error',
            },
          }
        }
      }
      const again = nextFlowScreen({
        catalog: looked.catalog,
        frame: applied.frame,
        slots: looked.slots,
        visitTotalLine: looked.visitTotalLine,
        errorMessage: applied.errorMessage,
      })
      if ('screen' in again) {
        const body = await encryptFlowResponse(
          decrypted.aesKey,
          decrypted.iv,
          withVersion(responseVersion, again),
        )
        return {
          status: 200,
          body,
          contentType: 'text/plain',
          logDetail: {
            action: 'data_exchange',
            screen: again.screen,
            outcome: 'validation_error',
          },
        }
      }
      // Sem ecrã reconstruível: ainda assim devolver o ecrã pedido com
      // error_message (Meta snackbar) — sem chaves a mais.
      const body = await encryptFlowResponse(
        decrypted.aesKey,
        decrypted.iv,
        withVersion(responseVersion, {
          screen: parsed.screen,
          data: { error_message: applied.errorMessage },
        }),
      )
      return {
        status: 200,
        body,
        contentType: 'text/plain',
        logDetail: {
          action: 'data_exchange',
          screen: parsed.screen,
          outcome: 'validation_error_bare',
        },
      }
    }
    frame = applied.frame
    hubActionFromSubmit = applied.hubAction ?? null
    await input.sessions.set(parsed.flowToken, frame)

    // Remarcar / Cancelar / Meus / Informações / Equipe: fecho imediato (stub).
    if (hubActionFromSubmit && isFlowHubStubAction(hubActionFromSubmit)) {
      const body = await encryptFlowResponse(
        decrypted.aesKey,
        decrypted.iv,
        withVersion(
          responseVersion,
          successPayload(parsed.flowToken, frame, {
            hubAction: hubActionFromSubmit,
          }),
        ),
      )
      return {
        status: 200,
        body,
        contentType: 'text/plain',
        logDetail: {
          action: 'data_exchange',
          screen: 'SUCCESS',
          outcome: 'hub_stub',
          hub_action: hubActionFromSubmit,
        },
      }
    }

    try {
      looked = await input.dataLookup({ token: tokenRow, frame })
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'data_lookup_failed'
      return {
        status: 503,
        body: { error: 'flow_unexpected' },
        logDetail: { reason, action: 'data_exchange' },
      }
    }
    frame = takeLookedFrame(looked.frame)
  }
  await input.sessions.set(parsed.flowToken, frame)

  // INIT: Meta exige ecrã de entrada (sem inbound no routing_model).
  // JSON publicado: só HUB (TR-306). Saltar para SERVICO/GENERO/… no open
  // → invalid-screen-transition → «Something went wrong».
  // Agendar (SERVICO→…) continua no data_exchange depois do hub.
  if (parsed.action === 'INIT') {
    const entry = entryFlowScreen({
      catalog: looked.catalog,
      frame,
      errorMessage: mismatchMessage(looked),
    })
    if ('kind' in entry) {
      const body = await encryptFlowResponse(
        decrypted.aesKey,
        decrypted.iv,
        withVersion(
          responseVersion,
          successPayload(parsed.flowToken, frame, {
            fallbackReason: asFallbackReason(entry.reason),
          }),
        ),
      )
      return {
        status: 200,
        body,
        contentType: 'text/plain',
        logDetail: {
          action: 'INIT',
          screen: 'SUCCESS',
          outcome: 'chat_fallback',
          reason: entry.reason,
        },
      }
    }
    const wouldSkip = nextFlowScreen({
      catalog: looked.catalog,
      frame,
      slots: looked.slots,
      visitTotalLine: looked.visitTotalLine,
      errorMessage: mismatchMessage(looked),
    })
    const skipped =
      'screen' in wouldSkip && wouldSkip.screen !== FLOW_ENTRY_SCREEN
        ? wouldSkip.screen
        : 'kind' in wouldSkip
          ? wouldSkip.kind
          : undefined
    const body = await encryptFlowResponse(
      decrypted.aesKey,
      decrypted.iv,
      withVersion(responseVersion, entry),
    )
    return {
      status: 200,
      body,
      contentType: 'text/plain',
      logDetail: {
        action: 'INIT',
        screen: entry.screen,
        outcome: 'entry_screen',
        ...(skipped ? { skipped_screen: String(skipped) } : {}),
      },
    }
  }

  const next = nextFlowScreen({
    catalog: looked.catalog,
    frame,
    slots: looked.slots,
    visitTotalLine: looked.visitTotalLine,
    errorMessage: mismatchMessage(looked),
    // O salto tem de existir no routing_model a partir do ecrã submetido.
    ...(parsed.action === 'data_exchange' && parsed.screen ? { from: parsed.screen } : {}),
  })

  if ('kind' in next && next.kind === 'ready') {
    const body = await encryptFlowResponse(
      decrypted.aesKey,
      decrypted.iv,
      withVersion(responseVersion, successPayload(parsed.flowToken, frame)),
    )
    return {
      status: 200,
      body,
      contentType: 'text/plain',
      logDetail: { action: parsed.action || 'unknown', screen: 'SUCCESS', outcome: 'ready' },
    }
  }

  if ('kind' in next && next.kind === 'chat_fallback') {
    // ADR §3: Flow termina; o chat envia a frase (via nfm_reply + fallback_reason).
    // Não SUCCESS «vazio» sem marcador — Finding 3.
    const body = await encryptFlowResponse(
      decrypted.aesKey,
      decrypted.iv,
      withVersion(
        responseVersion,
        successPayload(parsed.flowToken, frame, {
          fallbackReason: asFallbackReason(next.reason),
        }),
      ),
    )
    return {
      status: 200,
      body,
      contentType: 'text/plain',
      logDetail: {
        action: parsed.action || 'unknown',
        screen: 'SUCCESS',
        outcome: 'chat_fallback',
        reason: next.reason,
      },
    }
  }

  if ('screen' in next) {
    const body = await encryptFlowResponse(
      decrypted.aesKey,
      decrypted.iv,
      withVersion(responseVersion, next),
    )
    return {
      status: 200,
      body,
      contentType: 'text/plain',
      logDetail: {
        action: parsed.action || 'unknown',
        screen: next.screen,
        outcome: 'screen',
      },
    }
  }

  return { status: 503, body: { error: 'flow_unexpected' } }
}
