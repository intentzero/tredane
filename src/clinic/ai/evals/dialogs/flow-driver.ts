/**
 * Cliente Flow simulado para o harness L1 (família FL-, ADR-0016 §11.1).
 *
 * Faz o papel da Meta e da cliente, sem Graph nem WABA:
 *   - `prepare` substitui `prepareBookingFlowOfferFromEnv` (token num store em memória);
 *   - `run` cifra INIT / data_exchange com uma chave RSA gerada no teste, chama o
 *     **endpoint real** (`handleFlowDataRequest`) com a **mesma** leitura de dados do
 *     Clinic DO (`flowDataExchangeLocal`) e responde a cada ecrã como a cliente;
 *   - no SUCCESS, entrega o `nfm_reply` pela mesma sequência do queue-consumer:
 *     token utilizável e da mesma clínica → consumir → inbound «[Flow]» (que enfileira
 *     o autodraft) → fase `ack` → fase `proposal`.
 *
 * A cliente só escolhe o que o ecrã oferece: se o serviço, a zona ou a hora pedida
 * não aparecem nas opções, o diálogo regista `not_offered` (é um defeito a ver).
 */
import { computeHubSignature256 } from '../../../../whatsapp/webhook-verify'
import {
  decryptFlowRequest,
  decryptFlowResponseForTest,
  encryptFlowRequestForTest,
  generateFlowKeyPair,
  importFlowPrivateKey,
} from '../../../../whatsapp/flow/crypto'
import { FLOW_COPY } from '../../../../whatsapp/flow/copy'
import { flowDataExchangeLocal } from '../../../../whatsapp/flow/data-exchange'
import { createTokenBackedSessionStore, handleFlowDataRequest } from '../../../../whatsapp/flow/endpoint'
import { handleFlowNfmReply, parseNfmResponseJson } from '../../../../whatsapp/flow/nfm-reply'
import type { PrepareBookingFlowOffer } from '../../../../whatsapp/flow/offer-live'
import type { FlowHubAction } from '../../../../whatsapp/flow/copy'
import {
  createMemoryFlowTokenStore,
  generateFlowToken,
  isFlowTokenUsable,
} from '../../../../whatsapp/flow/tokens'
import type { ForecastAdapter } from '../../../tempo/evaluate'
import { enqueueAutoDraft } from '../../index'
import type { DialogScenario } from './scenario'

const APP_SECRET = 'l1-flow-app-secret'
const FLOW_ID = 'l1-flow-id'

/** O que a cliente quer fazer dentro do Flow. */
export type FlowPath = {
  /** Opção do HUB (default `agendar`). */
  hub?: FlowHubAction
  /** Chave em `scenario.ids` do serviço a escolher em SERVICO. */
  serviceKey?: keyof DialogScenario['ids']
  line?: 'feminino' | 'masculino'
  /** Nomes das zonas (como a cliente as lê no ecrã). */
  zones?: string[]
  /** `first` = primeira hora oferecida; senão o id civil `YYYY-MM-DDTHH:MM`. */
  slot?: 'first' | string
  /** A cliente fecha o Flow ao chegar a este ecrã (sem SUCCESS nem nfm). */
  abandonAt?: string
  /** Tempo (min) a passar entre o envio do CTA e o INIT (expiração, catálogo a meio). */
  delayMs?: number
  /**
   * Muda o cenário **antes** de a cliente responder a este ecrã (ex.: a owner desativa o
   * serviço com o Flow aberto, ADR-0016 §7). O passo seguinte vê o catálogo novo.
   */
  mutateBefore?: { screen: string; run: (s: DialogScenario) => void }
}

export type FlowRunTrace = {
  /** Ecrãs na ordem em que o endpoint os mostrou (inclui SUCCESS). */
  screens: string[]
  /** Fecho: o nfm foi entregue, a cliente abandonou, ou algo falhou. */
  outcome:
    | 'nfm_delivered'
    | 'abandoned'
    | 'no_flow_offered'
    | 'token_rejected'
    | 'not_offered'
    | 'endpoint_error'
  /** Resultado do `handleFlowNfmReply` (fase proposal, ou ack se não houve proposal). */
  nfmOutcome?: string
  detail?: string
  /** JSON do nfm entregue (para reentrega). */
  responseJson?: string
  providerEventKey?: string
}

type Pair = Awaited<ReturnType<typeof generateFlowKeyPair>>

export type FlowHarness = {
  /** Liga o relógio do cenário (o prepare corre dentro do autodraft). */
  bind: (s: DialogScenario) => void
  prepare: PrepareBookingFlowOffer
  /** Quantos CTAs de Flow o sistema enviou. */
  offers: () => number
  run: (s: DialogScenario, path: FlowPath) => Promise<FlowRunTrace>
  /** Segundo fecho com o mesmo token (o queue-consumer recusa o token já consumido). */
  redeliver: (s: DialogScenario) => Promise<FlowRunTrace>
}

export function createFlowHarness(opts: { forecast?: ForecastAdapter } = {}): FlowHarness {
  const store = createMemoryFlowTokenStore()
  let pairP: Promise<Pair> | null = null
  const pair = () => (pairP ??= generateFlowKeyPair())
  let lastToken: string | null = null
  let offers = 0
  let seq = 0
  let lastNfm: { responseJson: string; providerEventKey: string } | null = null
  // O store em memória ignora o AdminDb.
  const admin = null as never
  // O prepare corre dentro de runDueAutoDrafts; o relógio vem do cenário activo.
  let currentClock: DialogScenario['clock'] | null = null

  const prepare: PrepareBookingFlowOffer = async (input) => {
    const token = generateFlowToken()
    store.insert(
      admin,
      {
        token,
        tenantId: input.tenantId,
        bindingId: 'l1-binding',
        phoneNumberId: 'l1-phone',
        wabaId: 'l1-waba',
        conversationId: input.conversationId,
        catalogVersion: input.catalogVersion,
        session: input.session,
      },
      currentClock!,
    )
    lastToken = token
    offers += 1
    const body = (input.body ?? FLOW_COPY.openBody).trim()
    return {
      body,
      flowToken: token,
      interactive: {
        flow: {
          flowId: FLOW_ID,
          flowCta: FLOW_COPY.flowCta,
          flowToken: token,
          flowAction: 'data_exchange',
          flowMessageVersion: '3',
          mode: 'published',
        },
      },
    }
  }

  const call = async (s: DialogScenario, payload: Record<string, unknown>) => {
    const p = await pair()
    const encrypted = await encryptFlowRequestForTest(p.publicKey, payload)
    const rawBody = JSON.stringify(encrypted)
    const signature = await computeHubSignature256(rawBody, APP_SECRET)
    const sessions = createTokenBackedSessionStore({
      getToken: async (t) => store.get(admin, t),
      saveSession: async (t, session) => store.saveSession(admin, t, session),
    })
    const result = await handleFlowDataRequest({
      rawBody,
      signatureHeader: signature,
      env: { WHATSAPP_FLOW_PRIVATE_KEY: p.privatePem, META_APP_SECRET: APP_SECRET },
      clock: s.clock,
      sessions,
      tokenLookup: async (t) => store.get(admin, t),
      dataLookup: async ({ token, frame }) => {
        // Isolamento: o token tem de ser desta clínica e desta conversa.
        if (token.tenantId !== s.tenantId) throw new Error('tenant_mismatch')
        return flowDataExchangeLocal({
          db: s.db,
          tenantId: s.tenantId,
          clock: s.clock,
          catalogVersion: token.catalogVersion,
          frame,
          forecast: opts.forecast,
        })
      },
    })
    if (result.status !== 200 || result.contentType !== 'text/plain') {
      return { status: result.status, screen: null as string | null, data: {} as Record<string, unknown> }
    }
    const req = await decryptFlowRequest(await importFlowPrivateKey(p.privatePem), encrypted)
    const res = (await decryptFlowResponseForTest(req.aesKey, req.iv, result.body)) as {
      screen: string
      data: Record<string, unknown>
    }
    return { status: 200, screen: res.screen, data: res.data ?? {} }
  }

  const optionIds = (data: Record<string, unknown>, key: string): Array<{ id: string; title: string }> => {
    const raw = data[key]
    return Array.isArray(raw) ? (raw as Array<{ id: string; title: string }>) : []
  }

  /** Mesma sequência do queue-consumer (#538 / fumo 04/11). */
  const deliverNfm = async (
    s: DialogScenario,
    responseJson: string,
    providerEventKey: string,
  ): Promise<{ outcome: string; rejected?: string }> => {
    const params = parseNfmResponseJson(responseJson)
    let catalogVersion: string | undefined
    if (params?.flowToken) {
      const row = store.get(admin, params.flowToken)
      if (!row || !isFlowTokenUsable(row, s.clock.nowMs())) return { outcome: 'token_rejected', rejected: 'flow_token_consumed' }
      if (row.tenantId !== s.tenantId) return { outcome: 'token_rejected', rejected: 'flow_token_tenant_mismatch' }
      catalogVersion = row.catalogVersion
      store.consume(admin, params.flowToken, s.clock)
    }
    // ingestMessage('[Flow]') enfileira o autodraft como qualquer inbound.
    const inboundId = s.sayInbound('[Flow]')
    enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.conversationId, messageId: inboundId }, s.clock)
    const base = {
      tenantId: s.tenantId,
      conversationId: s.conversationId,
      providerEventKey,
      responseJson,
      catalogVersion: catalogVersion ?? '',
      capability: true,
    }
    const ack = await handleFlowNfmReply(s.db, s.caller, { ...base, phase: 'ack' }, s.clock)
    if (!ack.needsProposal) return { outcome: ack.outcome }
    s.clock.advance(1_000)
    const prop = await handleFlowNfmReply(s.db, s.caller, { ...base, phase: 'proposal' }, s.clock)
    return { outcome: prop.outcome }
  }

  const run = async (s: DialogScenario, path: FlowPath): Promise<FlowRunTrace> => {
    currentClock = s.clock
    const token = lastToken
    if (!token) return { screens: [], outcome: 'no_flow_offered' }
    if (path.delayMs) s.clock.advance(path.delayMs)
    const screens: string[] = []
    let resp = await call(s, { version: '3.0', action: 'INIT', flow_token: token })
    for (let guard = 0; guard < 8; guard += 1) {
      if (resp.status === 427) return { screens, outcome: 'token_rejected', detail: 'endpoint_427' }
      if (resp.status !== 200 || !resp.screen) return { screens, outcome: 'endpoint_error', detail: String(resp.status) }
      screens.push(resp.screen)
      if (path.abandonAt === resp.screen) return { screens, outcome: 'abandoned' }
      if (path.mutateBefore && path.mutateBefore.screen === resp.screen) {
        path.mutateBefore.run(s)
        path = { ...path, mutateBefore: undefined }
      }

      if (resp.screen === 'SUCCESS') {
        const ext = resp.data.extension_message_response as { params?: Record<string, unknown> } | undefined
        const responseJson = JSON.stringify(ext?.params ?? {})
        seq += 1
        const providerEventKey = `wa:msg:l1-flow-${seq}`
        lastNfm = { responseJson, providerEventKey }
        const delivered = await deliverNfm(s, responseJson, providerEventKey)
        if (delivered.rejected) return { screens, outcome: 'token_rejected', detail: delivered.rejected, responseJson, providerEventKey }
        return { screens, outcome: 'nfm_delivered', nfmOutcome: delivered.outcome, responseJson, providerEventKey }
      }

      let data: Record<string, unknown>
      if (resp.screen === 'HUB') {
        const want = path.hub ?? 'agendar'
        if (!optionIds(resp.data, 'actions').some((o) => o.id === want)) {
          return { screens, outcome: 'not_offered', detail: `HUB:${want}` }
        }
        data = { hub_action: want }
      } else if (resp.screen === 'SERVICO') {
        const id = path.serviceKey ? s.ids[path.serviceKey] : undefined
        if (!id || !optionIds(resp.data, 'services').some((o) => o.id === id)) {
          return { screens, outcome: 'not_offered', detail: `SERVICO:${path.serviceKey ?? '?'}` }
        }
        data = { service_id: id }
      } else if (resp.screen === 'GENERO') {
        if (!path.line) return { screens, outcome: 'not_offered', detail: 'GENERO:sem escolha no caso' }
        data = { gender_id: path.line }
      } else if (resp.screen === 'VARIANTES') {
        const offered = optionIds(resp.data, 'variants')
        const picked: string[] = []
        for (const name of path.zones ?? []) {
          const hit = offered.find((o) => o.title.split(' · ')[0]!.trim().toLowerCase() === name.toLowerCase())
          if (!hit) return { screens, outcome: 'not_offered', detail: `VARIANTES:${name}` }
          picked.push(hit.id)
        }
        data = { variant_ids: picked }
      } else if (resp.screen === 'HORARIO') {
        const offered = optionIds(resp.data, 'slots')
        const want = path.slot ?? 'first'
        const hit = want === 'first' ? offered[0] : offered.find((o) => o.id === want)
        if (!hit) return { screens, outcome: 'not_offered', detail: `HORARIO:${want}` }
        data = { slot_id: hit.id }
      } else {
        return { screens, outcome: 'endpoint_error', detail: `ecrã inesperado ${resp.screen}` }
      }
      resp = await call(s, { version: '3.0', action: 'data_exchange', screen: resp.screen, flow_token: token, data })
    }
    return { screens, outcome: 'endpoint_error', detail: 'demasiados ecrãs' }
  }

  const redeliver = async (s: DialogScenario): Promise<FlowRunTrace> => {
    if (!lastNfm) return { screens: [], outcome: 'no_flow_offered' }
    const delivered = await deliverNfm(s, lastNfm.responseJson, lastNfm.providerEventKey)
    return delivered.rejected
      ? { screens: [], outcome: 'token_rejected', detail: delivered.rejected }
      : { screens: [], outcome: 'nfm_delivered', nfmOutcome: delivered.outcome }
  }

  return {
    bind: (s) => {
      currentClock = s.clock
    },
    prepare: async (input) => {
      if (!currentClock) throw new Error('flow harness: relógio do cenário não ligado')
      return prepare(input)
    },
    offers: () => offers,
    run,
    redeliver,
  }
}
