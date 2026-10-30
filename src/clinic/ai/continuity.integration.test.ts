/**
 * Integração: rascunho sem re-cumprimentar a meio da conversa (Paulo, 29/10/2026).
 */
import { describe, expect, it } from 'vitest'
import { AiGatewayAnthropicAdapter, SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { buildAiContextPayload, suggestReplyOp } from './index'

const NOW = Date.UTC(2026, 9, 29, 18, 0)

function seedConversation(hist: Array<['inbound' | 'outbound', string]>) {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(
    db,
    { tenantId, waId: '5511900000099', displayName: 'Paulo Staging' },
    clock,
  )
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  let t = NOW - hist.length * 60_000
  for (const [direction, body] of hist) {
    insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction,
        body,
        deliveryState: direction === 'inbound' ? 'received' : 'delivered',
        createdAt: t,
      },
      clock,
    )
    t += 60_000
  }
  return { ...boot, clock, caller, cnv, tenantId }
}

function captureGateway(reply: string) {
  const bodies: Array<{ system: string; messages: Array<{ content: string }> }> = []
  const adapter = new AiGatewayAnthropicAdapter({
    accountId: 'acc',
    gatewayId: 'gw',
    gatewayToken: 'test-token',
    fetchImpl: (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: reply }],
          usage: { input_tokens: 100, output_tokens: 40 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch,
  })
  return { adapter, bodies }
}

describe('continuidade do rascunho (staging Paulo)', () => {
  it('contexto: primeiro contacto → hasClinicOutbound false; com outbound → true', async () => {
    const first = seedConversation([['inbound', 'Oi, tem horário de bronzeamento masculino?']])
    try {
      const built = await buildAiContextPayload(first.db, first.tenantId, first.cnv.id)
      expect(built.payload.hasClinicOutbound).toBe(false)
      expect(built.payload.clinicOutboundCount).toBe(0)
    } finally {
      first.close()
    }

    const mid = seedConversation([
      ['inbound', 'Oi'],
      ['outbound', 'Oi, Paulo! Tudo bem…'],
      ['inbound', 'Tem horário de bronzeamento masculino?'],
    ])
    try {
      const built = await buildAiContextPayload(mid.db, mid.tenantId, mid.cnv.id)
      expect(built.payload.hasClinicOutbound).toBe(true)
      expect(built.payload.clinicOutboundCount).toBe(1)
    } finally {
      mid.close()
    }
  })

  it('cumprimento já enviado → segundo rascunho sem re-cumprimentar', async () => {
    const { db, clock, caller, cnv, close } = seedConversation([
      ['inbound', 'Oi'],
      ['outbound', 'Oi, Paulo! Tudo bem…'],
      ['inbound', 'Tem horário de bronzeamento masculino?'],
    ])
    try {
      const { adapter, bodies } = captureGateway(
        '{"mensagem":"Oi, Paulo!\\n\\nPara bronzeamento masculino tenho amanhã às 15:00. Quer?", "notas":""}',
      )
      const r = await suggestReplyOp(
        db,
        caller,
        {
          conversationId: cnv.id,
          clientRequestId: 'cont-1',
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Ana',
        },
        clock,
        { mode: 'gateway', adapter },
      )
      expect(bodies[0]!.messages[0]!.content).toMatch(/clínica JÁ enviou/)
      expect(r.suggestion.suggestedText.startsWith('Oi')).toBe(false)
      expect(r.suggestion.suggestedText).toMatch(/bronzeamento masculino/i)
      expect(r.messageSent).toBe(false)
    } finally {
      close()
    }
  })

  it('primeiro contacto → cumprimento no rascunho permanece', async () => {
    const { db, clock, caller, cnv, close } = seedConversation([
      ['inbound', 'Oi, tem horário de bronzeamento masculino?'],
    ])
    try {
      const { adapter, bodies } = captureGateway(
        '{"mensagem":"Oi, Paulo!\\n\\nClaro — para bronzeamento masculino, qual dia fica melhor?", "notas":""}',
      )
      const r = await suggestReplyOp(
        db,
        caller,
        {
          conversationId: cnv.id,
          clientRequestId: 'cont-2',
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Ana',
        },
        clock,
        { mode: 'gateway', adapter },
      )
      expect(bodies[0]!.messages[0]!.content).toMatch(/ainda não há mensagem da clínica/)
      expect(r.suggestion.suggestedText.startsWith('Oi, Paulo!')).toBe(true)
    } finally {
      close()
    }
  })

  it('adaptador sintético também evita cumprimento a meio da conversa', async () => {
    const { db, clock, caller, cnv, close } = seedConversation([
      ['inbound', 'Oi'],
      ['outbound', 'Oi, Paulo! Tudo bem…'],
      ['inbound', 'Quanto custa a limpeza de pele?'],
    ])
    try {
      // Sem serviços → fallback cordial do SimulatedAiAdapter
      const r = await suggestReplyOp(
        db,
        caller,
        {
          conversationId: cnv.id,
          clientRequestId: 'cont-3',
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Ana',
        },
        clock,
        { mode: 'synthetic', adapter: new SimulatedAiAdapter() },
      )
      expect(r.suggestion.suggestedText.startsWith('Olá')).toBe(false)
      expect(r.suggestion.suggestedText.startsWith('Oi')).toBe(false)
    } finally {
      close()
    }
  })
})
