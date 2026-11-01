/**
 * #404 / DEC-107 / CF-14 / K-01: nenhum silêncio — frase de fallback sem pausar a IA.
 * Dados fictícios.
 */
import { describe, expect, it } from 'vitest'
import {
  SimulatedAiAdapter,
  type AiGenerateInput,
  type AiGenerateResult,
} from '../../ai'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation, listConversations } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { readAiReplyPause } from './human-handoff'
import { MODEL_FALLBACK_TEXT, notifyModelFallback } from './model-fallback'
import { listOpenPendingCommunicationsForConversation } from '../proposals/pending-communication'

const NOW = Date.UTC(2026, 9, 28, 18, 51)

class FailAdapter extends SimulatedAiAdapter {
  constructor(private readonly code: 'timeout' | 'rate_limit' | 'provider_error' | 'invalid_ok') {
    super()
  }
  override async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
    if (this.code === 'invalid_ok') {
      const r = await super.generate(input)
      if (!r.ok) return r
      // Schema fechado rejeita campos extra → invalid_response / output_rejected.
      return { ...r, text: JSON.stringify({ mensagem: 'Oi', notas: '', action: 'book' }) }
    }
    return {
      ok: false,
      code: this.code,
      message: `synthetic ${this.code}`,
      retryable: true,
      latencyMs: 5,
      provider: this.providerId,
      model: 'test',
    }
  }
}

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_fb',
      phoneNumberId: 'pn_fb',
      wabaId: 'waba_fb',
      displayPhone: '+5511900000044',
      displayName: 'Clínica Fallback',
      action: 'channel_connected',
    },
    clock,
  )
  const gi = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi' }, clock)
  upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: 15000,
      professionalIds: [gi.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1080 }))
  setWeeklyWindowsOp(db, caller, { resourceId: gi.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000044', displayName: 'Carla Ficticia' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  let t = NOW - 60_000
  const say = (body: string) => {
    const m = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body,
        deliveryState: 'received',
        createdAt: t,
      },
      clock,
    )
    t += 1_000
    return m
  }
  return { db, caller, tenantId, clock, cnv, say, close: boot.close }
}

async function runWith(adapter: SimulatedAiAdapter, body = 'oi, tudo bem?') {
  const s = seed()
  const message = s.say(body)
  enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: message.id }, s.clock)
  s.clock.advance(7_000)
  const out = await runDueAutoDrafts(s.db, s.caller, s.clock, { mode: 'synthetic', adapter })
  return { s, message, out }
}

describe('#404 fallback DEC-107 (K-01, CF-14)', () => {
  it.each([
    ['timeout', new FailAdapter('timeout')],
    ['rate_limit (429)', new FailAdapter('rate_limit')],
    ['provider_error', new FailAdapter('provider_error')],
    ['invalid_response', new FailAdapter('invalid_ok')],
  ] as const)('%s → frase DEC-107 + botão, alerta sem pausar', async (_label, adapter) => {
    const { s, out } = await runWith(adapter)
    try {
      expect(out).toHaveLength(1)
      const sent = s.db.get<{ body: string }>(
        `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
        s.cnv.id,
      )
      expect(sent?.body).toBe(MODEL_FALLBACK_TEXT)
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)).toBeNull()
      const pending = listOpenPendingCommunicationsForConversation(s.db, s.tenantId, s.cnv.id)
      expect(pending.some((p) => p.kind === 'alter_awaiting_team')).toBe(true)
      const list = listConversations(s.db, s.tenantId, { limit: 10 })
      const row = list.items.find((c) => c.id === s.cnv.id)
      expect(row?.needsPerson).toBe(true)
      const ob = s.db.get<{ kind: string; interactive: string | null }>(
        `SELECT kind, interactive_json AS interactive FROM outbound_messages
         WHERE tenant_id = ? AND conversation_id = ?
         ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
        s.cnv.id,
      )
      expect(ob?.kind).toBe('interactive')
      expect(ob?.interactive ?? '').toMatch(/handoff:human|Falar com a equipe/)
    } finally {
      s.close()
    }
  })

  it('idempotência por messageId: segunda chamada não duplica', () => {
    const s = seed()
    try {
      const message = s.say('Oi')
      const first = notifyModelFallback(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, messageId: message.id },
        s.clock,
      )
      expect(first.sent).toBe(true)
      const n = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND direction = 'outbound'`,
        s.cnv.id,
      )!.n
      s.clock.advance(1_000)
      const second = notifyModelFallback(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, messageId: message.id },
        s.clock,
      )
      expect(second).toEqual({ sent: false, already: true, outbox: [] })
      expect(
        s.db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND direction = 'outbound'`,
          s.cnv.id,
        )!.n,
      ).toBe(n)
    } finally {
      s.close()
    }
  })

  it('saída factual rejeitada sem injeção → fallback, não pausa (revisão do caminho output_rejected)', async () => {
    class BadFacts extends SimulatedAiAdapter {
      override async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
        const r = await super.generate(input)
        if (!r.ok) return r
        return {
          ...r,
          text: JSON.stringify({
            mensagem: 'Oi! Já garanti sua vaga amanhã às 23:00.',
            notas: '',
          }),
        }
      }
    }
    const { s } = await runWith(new BadFacts(), 'Oi, tudo bem? Queria saber mais sobre vocês')
    try {
      const bodies = s.db
        .all<{ body: string }>(
          `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound'`,
          s.cnv.id,
        )
        .map((m) => m.body)
      expect(bodies.some((b) => /garanti|23:00/.test(b))).toBe(false)
      expect(bodies).toContain(MODEL_FALLBACK_TEXT)
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)).toBeNull()
    } finally {
      s.close()
    }
  })
})
