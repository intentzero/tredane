import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { computeHubSignature256 } from '../webhook-verify'
import {
  encryptFlowRequestForTest,
  decryptFlowResponseForTest,
  generateFlowKeyPair,
  decryptFlowRequest,
  importFlowPrivateKey,
} from './crypto'
import {
  createFlowSessionStore,
  createTokenBackedSessionStore,
  handleFlowDataRequest,
} from './endpoint'
import {
  createMemoryFlowTokenStore,
  EMPTY_FLOW_SESSION,
  generateFlowToken,
  isFlowTokenUsable,
} from './tokens'
import { applyScreenSubmission } from './screens'

const APP_SECRET = 'test-app-secret-flow'

describe('whatsapp flow endpoint (ADR-0016 §5)', () => {
  it('ping responde status active cifrado', async () => {
    const pair = await generateFlowKeyPair()
    const encrypted = await encryptFlowRequestForTest(pair.publicKey, {
      version: '3.0',
      action: 'ping',
    })
    const rawBody = JSON.stringify(encrypted)
    const signature = await computeHubSignature256(rawBody, APP_SECRET)
    const clock = createControllableClock(Date.UTC(2026, 10, 5, 13, 0))

    const result = await handleFlowDataRequest({
      rawBody,
      signatureHeader: signature,
      env: {
        WHATSAPP_FLOW_PRIVATE_KEY: pair.privatePem,
        META_APP_SECRET: APP_SECRET,
      },
      clock,
      tokenLookup: async () => null,
      sessions: createFlowSessionStore(),
      dataLookup: async () => ({
        catalog: [],
        slots: [],
        frame: { ...EMPTY_FLOW_SESSION },
      }),
    })

    expect(result.status).toBe(200)
    if (result.status !== 200 || result.contentType !== 'text/plain') return
    const decryptedReq = await decryptFlowRequest(
      await importFlowPrivateKey(pair.privatePem),
      encrypted,
    )
    expect(result.body.length).toBeGreaterThan(20)
    void decryptedReq
  })

  it('token desconhecido → 427', async () => {
    const pair = await generateFlowKeyPair()
    const encrypted = await encryptFlowRequestForTest(pair.publicKey, {
      version: '3.0',
      action: 'INIT',
      flow_token: 'fl1_missing',
    })
    const rawBody = JSON.stringify(encrypted)
    const signature = await computeHubSignature256(rawBody, APP_SECRET)
    const clock = createControllableClock(Date.UTC(2026, 10, 5, 13, 0))

    const result = await handleFlowDataRequest({
      rawBody,
      signatureHeader: signature,
      env: {
        WHATSAPP_FLOW_PRIVATE_KEY: pair.privatePem,
        META_APP_SECRET: APP_SECRET,
      },
      clock,
      tokenLookup: async () => null,
      sessions: createFlowSessionStore(),
      dataLookup: async () => ({
        catalog: [],
        slots: [],
        frame: { ...EMPTY_FLOW_SESSION },
      }),
    })
    expect(result.status).toBe(427)
  })

  it('INIT com token válido devolve ecrã SERVICO', async () => {
    const pair = await generateFlowKeyPair()
    const store = createMemoryFlowTokenStore()
    const clock = createControllableClock(Date.UTC(2026, 10, 5, 13, 0))
    const token = generateFlowToken()
    store.insert(
      null as never,
      {
        token,
        tenantId: 't1',
        bindingId: 'b1',
        phoneNumberId: 'pn1',
        wabaId: 'w1',
        conversationId: 'c1',
        catalogVersion: '1',
      },
      clock,
    )

    const encrypted = await encryptFlowRequestForTest(pair.publicKey, {
      version: '3.0',
      action: 'INIT',
      flow_token: token,
    })
    const rawBody = JSON.stringify(encrypted)
    const signature = await computeHubSignature256(rawBody, APP_SECRET)
    const sessions = createTokenBackedSessionStore({
      getToken: async (t) => store.get(null as never, t),
      saveSession: async (t, session) => store.saveSession(null as never, t, session),
    })

    const result = await handleFlowDataRequest({
      rawBody,
      signatureHeader: signature,
      env: {
        WHATSAPP_FLOW_PRIVATE_KEY: pair.privatePem,
        META_APP_SECRET: APP_SECRET,
      },
      clock,
      sessions,
      tokenLookup: async (t) => store.get(null as never, t),
      dataLookup: async () => ({
        catalog: [
          { id: 's1', name: 'Depilação', active: true, zones: [] },
          { id: 's2', name: 'Limpeza', active: true, zones: [] },
        ],
        slots: [],
        frame: { ...EMPTY_FLOW_SESSION },
      }),
    })

    expect(result.status).toBe(200)
    if (result.status === 200) {
      expect(result.contentType).toBe('text/plain')
    }
  })

  it('assinatura inválida → 432', async () => {
    const pair = await generateFlowKeyPair()
    const encrypted = await encryptFlowRequestForTest(pair.publicKey, { action: 'ping' })
    const rawBody = JSON.stringify(encrypted)
    const clock = createControllableClock(1)
    const result = await handleFlowDataRequest({
      rawBody,
      signatureHeader: 'sha256=deadbeef',
      env: {
        WHATSAPP_FLOW_PRIVATE_KEY: pair.privatePem,
        META_APP_SECRET: APP_SECRET,
      },
      clock,
      tokenLookup: async () => null,
      sessions: createFlowSessionStore(),
      dataLookup: async () => ({
        catalog: [],
        slots: [],
        frame: { ...EMPTY_FLOW_SESSION },
      }),
    })
    expect(result.status).toBe(432)
  })

  it('Finding 1: sessão sobrevive à «perda» do Map entre ecrãs (token-backed)', async () => {
    const pair = await generateFlowKeyPair()
    const store = createMemoryFlowTokenStore()
    const clock = createControllableClock(Date.UTC(2026, 10, 5, 13, 0))
    const token = generateFlowToken()
    store.insert(
      null as never,
      {
        token,
        tenantId: 't1',
        bindingId: 'b1',
        phoneNumberId: 'pn1',
        wabaId: 'w1',
        conversationId: 'c1',
        catalogVersion: '1',
      },
      clock,
    )

    const catalog = [
      {
        id: 'svc_dep',
        name: 'Depilação',
        active: true,
        zones: [
          {
            id: 'z_f',
            name: 'Axila',
            audience: 'feminino',
            active: true,
            durationMinutes: 15,
          },
          {
            id: 'z_m',
            name: 'Axila',
            audience: 'masculino',
            active: true,
            durationMinutes: 15,
          },
        ],
      },
    ]

    const durable = createTokenBackedSessionStore({
      getToken: async (t) => store.get(null as never, t),
      saveSession: async (t, session) => store.saveSession(null as never, t, session),
    })

    // 1.º pedido: escolhe serviço — grava no token.
    const applied = applyScreenSubmission(
      catalog,
      { ...EMPTY_FLOW_SESSION },
      'SERVICO',
      { service_id: 'svc_dep' },
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    await durable.set(token, applied.frame)

    // Isolate «novo»: Map vazio; sessão vem do token.
    const lostMap = createFlowSessionStore() // vazio de propósito
    expect(await lostMap.get(token)).toEqual(EMPTY_FLOW_SESSION)
    const recovered = await durable.get(token)
    expect(recovered.serviceId).toBe('svc_dep')

    const encrypted = await encryptFlowRequestForTest(pair.publicKey, {
      version: '3.0',
      action: 'data_exchange',
      screen: 'GENERO',
      flow_token: token,
      data: { gender_id: 'feminino' },
    })
    const rawBody = JSON.stringify(encrypted)
    const signature = await computeHubSignature256(rawBody, APP_SECRET)

    const result = await handleFlowDataRequest({
      rawBody,
      signatureHeader: signature,
      env: {
        WHATSAPP_FLOW_PRIVATE_KEY: pair.privatePem,
        META_APP_SECRET: APP_SECRET,
      },
      clock,
      // Sem Map local — só D1/token store (simula isolate frio).
      sessions: durable,
      tokenLookup: async (t) => store.get(null as never, t),
      dataLookup: async ({ frame }) => ({
        catalog,
        slots: [],
        frame,
      }),
    })

    expect(result.status).toBe(200)
    const after = await durable.get(token)
    expect(after.serviceId).toBe('svc_dep')
    expect(after.line).toBe('feminino')
  })

  it('Finding 3: chat_fallback inclui fallback_reason no SUCCESS (não vazio)', async () => {
    const pair = await generateFlowKeyPair()
    const store = createMemoryFlowTokenStore()
    const clock = createControllableClock(Date.UTC(2026, 10, 5, 13, 0))
    const token = generateFlowToken()
    store.insert(
      null as never,
      {
        token,
        tenantId: 't1',
        bindingId: 'b1',
        phoneNumberId: 'pn1',
        wabaId: 'w1',
        conversationId: 'c1',
        catalogVersion: '1',
        session: {
          serviceId: 'svc_limp',
          line: null,
          variantIds: null,
          slotKey: null,
        },
      },
      clock,
    )

    const encrypted = await encryptFlowRequestForTest(pair.publicKey, {
      version: '3.0',
      action: 'INIT',
      flow_token: token,
    })
    const rawBody = JSON.stringify(encrypted)
    const signature = await computeHubSignature256(rawBody, APP_SECRET)
    const sessions = createTokenBackedSessionStore({
      getToken: async (t) => store.get(null as never, t),
      saveSession: async (t, session) => store.saveSession(null as never, t, session),
    })

    const result = await handleFlowDataRequest({
      rawBody,
      signatureHeader: signature,
      env: {
        WHATSAPP_FLOW_PRIVATE_KEY: pair.privatePem,
        META_APP_SECRET: APP_SECRET,
      },
      clock,
      sessions,
      tokenLookup: async (t) => store.get(null as never, t),
      dataLookup: async ({ frame }) => ({
        catalog: [{ id: 'svc_limp', name: 'Limpeza', active: true, zones: [] }],
        slots: [], // zero horas → chat_fallback no_slots
        frame,
      }),
    })

    expect(result.status).toBe(200)
    if (result.status !== 200 || result.contentType !== 'text/plain') return

    const decReq = await decryptFlowRequest(
      await importFlowPrivateKey(pair.privatePem),
      encrypted,
    )
    const response = (await decryptFlowResponseForTest(
      decReq.aesKey,
      decReq.iv,
      result.body,
    )) as {
      version?: string
      screen: string
      data: { extension_message_response: { params: Record<string, unknown> } }
    }
    expect(response.version).toBe('3.0')
    expect(response.screen).toBe('SUCCESS')
    expect(response.data.extension_message_response.params.fallback_reason).toBe(
      'no_slots',
    )
    // Sem null no params — Meta payload-schema / tipos inesperados.
    expect(response.data.extension_message_response.params).not.toHaveProperty(
      'slot_id',
    )
  })

  // T07 / #539 — catalogMismatch mid-flow devolve C14 e re-pede campo.
  it('T07: catalogMismatch limpa serviço e pede SERVICO com C14', async () => {
    const pair = await generateFlowKeyPair()
    const store = createMemoryFlowTokenStore()
    const clock = createControllableClock(Date.UTC(2026, 10, 5, 13, 0))
    const token = generateFlowToken()
    store.insert(
      null as never,
      {
        token,
        tenantId: 't1',
        bindingId: 'b1',
        phoneNumberId: 'pn1',
        wabaId: 'w1',
        conversationId: 'c1',
        catalogVersion: '1',
        session: {
          serviceId: 'svc_gone',
          line: null,
          variantIds: null,
          slotKey: null,
        },
      },
      clock,
    )
    const sessions = createTokenBackedSessionStore({
      getToken: async (t) => store.get(null as never, t),
      saveSession: async (t, session) => store.saveSession(null as never, t, session),
    })
    const encrypted = await encryptFlowRequestForTest(pair.publicKey, {
      version: '3.0',
      action: 'INIT',
      flow_token: token,
    })
    const rawBody = JSON.stringify(encrypted)
    const signature = await computeHubSignature256(rawBody, APP_SECRET)
    const result = await handleFlowDataRequest({
      rawBody,
      signatureHeader: signature,
      env: {
        WHATSAPP_FLOW_PRIVATE_KEY: pair.privatePem,
        META_APP_SECRET: APP_SECRET,
      },
      clock,
      sessions,
      tokenLookup: async (t) => store.get(null as never, t),
      dataLookup: async () => ({
        catalog: [
          { id: 's1', name: 'Depilação', active: true, zones: [] },
          { id: 's2', name: 'Limpeza', active: true, zones: [] },
        ],
        slots: [],
        frame: { serviceId: null, line: null, variantIds: null, slotKey: null },
        catalogMismatch: true,
        clearedFields: ['serviceId' as const],
      }),
    })
    expect(result.status).toBe(200)
    if (result.status !== 200 || result.contentType !== 'text/plain') return
    const decReq = await decryptFlowRequest(
      await importFlowPrivateKey(pair.privatePem),
      encrypted,
    )
    const response = (await decryptFlowResponseForTest(
      decReq.aesKey,
      decReq.iv,
      result.body,
    )) as { screen: string; data: { error_message?: string } }
    expect(response.screen).toBe('SERVICO')
    expect(response.data.error_message).toMatch(/cadastro mudou/i)
  })

  // T08 / #538 — token consumido não é usável.
  it('T08: consumeFlowToken → isFlowTokenUsable falso (2º nfm não repropõe)', () => {
    const store = createMemoryFlowTokenStore()
    const clock = createControllableClock(Date.UTC(2026, 10, 5, 13, 0))
    const token = generateFlowToken()
    store.insert(
      null as never,
      {
        token,
        tenantId: 't1',
        bindingId: 'b1',
        phoneNumberId: 'pn1',
        wabaId: 'w1',
        conversationId: 'c1',
        catalogVersion: '42',
      },
      clock,
    )
    const row = store.get(null as never, token)!
    expect(isFlowTokenUsable(row, clock.nowMs())).toBe(true)
    expect(row.catalogVersion).toBe('42')
    store.consume(null as never, token, clock)
    const after = store.get(null as never, token)!
    expect(isFlowTokenUsable(after, clock.nowMs())).toBe(false)
    expect(after.consumedAt).not.toBeNull()
  })

  // T13 / #537 — dataLookup devolve só o frame do token (sem overlay DO).
  it('T13: INIT com sessão vazia não salta para HORARIO (sem overlay stale)', async () => {
    const pair = await generateFlowKeyPair()
    const store = createMemoryFlowTokenStore()
    const clock = createControllableClock(Date.UTC(2026, 10, 5, 13, 0))
    const token = generateFlowToken()
    store.insert(
      null as never,
      {
        token,
        tenantId: 't1',
        bindingId: 'b1',
        phoneNumberId: 'pn1',
        wabaId: 'w1',
        conversationId: 'c1',
        catalogVersion: '1',
      },
      clock,
    )
    const sessions = createTokenBackedSessionStore({
      getToken: async (t) => store.get(null as never, t),
      saveSession: async (t, session) => store.saveSession(null as never, t, session),
    })
    const encrypted = await encryptFlowRequestForTest(pair.publicKey, {
      version: '3.0',
      action: 'INIT',
      flow_token: token,
    })
    const rawBody = JSON.stringify(encrypted)
    const signature = await computeHubSignature256(rawBody, APP_SECRET)
    // Contrato #537: dataLookup ecoa o frame do token — NÃO injeta BookingFrame stale.
    const result = await handleFlowDataRequest({
      rawBody,
      signatureHeader: signature,
      env: {
        WHATSAPP_FLOW_PRIVATE_KEY: pair.privatePem,
        META_APP_SECRET: APP_SECRET,
      },
      clock,
      sessions,
      tokenLookup: async (t) => store.get(null as never, t),
      dataLookup: async ({ frame }) => ({
        catalog: [
          { id: 's1', name: 'Depilação', active: true, zones: [] },
          { id: 's2', name: 'Limpeza', active: true, zones: [] },
        ],
        slots: [{ id: '2026-11-05T10:00', date: '2026-11-05', time: '10:00' }],
        frame, // sem merge de DO
      }),
    })
    expect(result.status).toBe(200)
    if (result.status !== 200 || result.contentType !== 'text/plain') return
    const decReq = await decryptFlowRequest(
      await importFlowPrivateKey(pair.privatePem),
      encrypted,
    )
    const response = (await decryptFlowResponseForTest(
      decReq.aesKey,
      decReq.iv,
      result.body,
    )) as { screen: string }
    expect(response.screen).toBe('SERVICO')
  })

  // S1 review #542 — null explícito do dataLookup não é restaurado pela sessão.
  it('S1: slotKey null do lookup prevalece (não SUCCESS com slot stale)', async () => {
    const pair = await generateFlowKeyPair()
    const store = createMemoryFlowTokenStore()
    const clock = createControllableClock(Date.UTC(2026, 10, 5, 13, 0))
    const token = generateFlowToken()
    store.insert(
      null as never,
      {
        token,
        tenantId: 't1',
        bindingId: 'b1',
        phoneNumberId: 'pn1',
        wabaId: 'w1',
        conversationId: 'c1',
        catalogVersion: '1',
        session: {
          serviceId: 'svc_limp',
          line: null,
          variantIds: null,
          slotKey: '2026-11-05T10:00', // stale na sessão
        },
      },
      clock,
    )
    const sessions = createTokenBackedSessionStore({
      getToken: async (t) => store.get(null as never, t),
      saveSession: async (t, session) => store.saveSession(null as never, t, session),
    })
    const encrypted = await encryptFlowRequestForTest(pair.publicKey, {
      version: '3.0',
      action: 'INIT',
      flow_token: token,
    })
    const rawBody = JSON.stringify(encrypted)
    const signature = await computeHubSignature256(rawBody, APP_SECRET)
    const result = await handleFlowDataRequest({
      rawBody,
      signatureHeader: signature,
      env: {
        WHATSAPP_FLOW_PRIVATE_KEY: pair.privatePem,
        META_APP_SECRET: APP_SECRET,
      },
      clock,
      sessions,
      tokenLookup: async (t) => store.get(null as never, t),
      dataLookup: async () => ({
        catalog: [{ id: 'svc_limp', name: 'Limpeza', active: true, zones: [] }],
        slots: [{ id: '2026-11-05T11:00', date: '2026-11-05', time: '11:00' }],
        // DO limpou o slot stale — null tem de prevalecer sobre a sessão.
        frame: {
          serviceId: 'svc_limp',
          line: null,
          variantIds: null,
          slotKey: null,
        },
        catalogMismatch: false,
        clearedFields: ['slotKey' as const],
      }),
    })
    expect(result.status).toBe(200)
    if (result.status !== 200 || result.contentType !== 'text/plain') return
    const decReq = await decryptFlowRequest(
      await importFlowPrivateKey(pair.privatePem),
      encrypted,
    )
    const response = (await decryptFlowResponseForTest(
      decReq.aesKey,
      decReq.iv,
      result.body,
    )) as { screen: string; data: { error_message?: string } }
    expect(response.screen).toBe('HORARIO')
    expect(response.data.error_message).toMatch(/já não está livre|Escolha outro/i)
    const after = await sessions.get(token)
    expect(after.slotKey).toBeNull()
  })

  // T15 — BACK re-renderiza sem corromper a sessão.
  it('T15: BACK mantém sessão e re-apresenta o ecrã seguinte', async () => {
    const pair = await generateFlowKeyPair()
    const store = createMemoryFlowTokenStore()
    const clock = createControllableClock(Date.UTC(2026, 10, 5, 13, 0))
    const token = generateFlowToken()
    store.insert(
      null as never,
      {
        token,
        tenantId: 't1',
        bindingId: 'b1',
        phoneNumberId: 'pn1',
        wabaId: 'w1',
        conversationId: 'c1',
        catalogVersion: '1',
        session: {
          serviceId: 'svc_limp',
          line: null,
          variantIds: null,
          slotKey: null,
        },
      },
      clock,
    )
    const sessions = createTokenBackedSessionStore({
      getToken: async (t) => store.get(null as never, t),
      saveSession: async (t, session) => store.saveSession(null as never, t, session),
    })
    const encrypted = await encryptFlowRequestForTest(pair.publicKey, {
      version: '3.0',
      action: 'BACK',
      screen: 'HORARIO',
      flow_token: token,
      data: {},
    })
    const rawBody = JSON.stringify(encrypted)
    const signature = await computeHubSignature256(rawBody, APP_SECRET)
    const result = await handleFlowDataRequest({
      rawBody,
      signatureHeader: signature,
      env: {
        WHATSAPP_FLOW_PRIVATE_KEY: pair.privatePem,
        META_APP_SECRET: APP_SECRET,
      },
      clock,
      sessions,
      tokenLookup: async (t) => store.get(null as never, t),
      dataLookup: async ({ frame }) => ({
        catalog: [{ id: 'svc_limp', name: 'Limpeza', active: true, zones: [] }],
        slots: [{ id: '2026-11-05T10:00', date: '2026-11-05', time: '10:00' }],
        frame,
      }),
    })
    expect(result.status).toBe(200)
    const after = await sessions.get(token)
    expect(after.serviceId).toBe('svc_limp')
    expect(after.slotKey).toBeNull()
    if (result.status !== 200 || result.contentType !== 'text/plain') return
    const decReq = await decryptFlowRequest(
      await importFlowPrivateKey(pair.privatePem),
      encrypted,
    )
    const response = (await decryptFlowResponseForTest(
      decReq.aesKey,
      decReq.iv,
      result.body,
    )) as { screen: string }
    expect(response.screen).toBe('HORARIO')
  })
})

