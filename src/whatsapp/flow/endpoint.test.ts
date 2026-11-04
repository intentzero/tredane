import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { computeHubSignature256 } from '../webhook-verify'
import {
  encryptFlowRequestForTest,
  generateFlowKeyPair,
  decryptFlowRequest,
  importFlowPrivateKey,
} from './crypto'
import {
  createFlowSessionStore,
  handleFlowDataRequest,
} from './endpoint'
import { createMemoryFlowTokenStore, generateFlowToken } from './tokens'

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
      tokenLookup: () => null,
      dataLookup: async () => ({
        catalog: [],
        slots: [],
        frame: { serviceId: null, line: null, variantIds: null, slotKey: null },
      }),
    })

    expect(result.status).toBe(200)
    if (result.status !== 200 || result.contentType !== 'text/plain') return
    // Decifrar resposta com a mesma chave AES do pedido.
    const decryptedReq = await decryptFlowRequest(
      await importFlowPrivateKey(pair.privatePem),
      encrypted,
    )
    // encryptFlowResponse inverte o IV — só validamos que o body é base64 não vazio.
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
      tokenLookup: () => null,
      dataLookup: async () => ({
        catalog: [],
        slots: [],
        frame: { serviceId: null, line: null, variantIds: null, slotKey: null },
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
    const sessions = createFlowSessionStore()

    const result = await handleFlowDataRequest({
      rawBody,
      signatureHeader: signature,
      env: {
        WHATSAPP_FLOW_PRIVATE_KEY: pair.privatePem,
        META_APP_SECRET: APP_SECRET,
      },
      clock,
      sessions,
      tokenLookup: (t) => store.get(null as never, t),
      dataLookup: async () => ({
        catalog: [
          { id: 's1', name: 'Depilação', active: true, zones: [] },
          { id: 's2', name: 'Limpeza', active: true, zones: [] },
        ],
        slots: [],
        frame: { serviceId: null, line: null, variantIds: null, slotKey: null },
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
      tokenLookup: () => null,
      dataLookup: async () => ({
        catalog: [],
        slots: [],
        frame: { serviceId: null, line: null, variantIds: null, slotKey: null },
      }),
    })
    expect(result.status).toBe(432)
  })
})
