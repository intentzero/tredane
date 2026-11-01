/**
 * #403 (CF-01, DEC-104): o texto do modelo que afirma reserva ou inventa preço/hora
 * não chega à cliente. Matriz: I-07, I-08. Dados fictícios.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter, type AiGenerateInput, type AiGenerateResult } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { enqueueAutoDraft, runDueAutoDrafts, suggestReplyOp } from './index'

const NOW = Date.UTC(2026, 9, 28, 18, 51)

class FixedOutputAdapter extends SimulatedAiAdapter {
  constructor(private readonly out: string) {
    super()
  }
  override async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
    const r = await super.generate(input)
    return r.ok ? { ...r, text: this.out } : r
  }
}

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  const gi = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi' }, clock)
  upsertServiceOp(
    db,
    caller,
    { name: 'Massagem', durationMinutes: 60, bufferMinutes: 0, priceCents: 15000, professionalIds: [gi.id], roomRequirement: { mode: 'none' } },
    clock,
  )
  const week = [1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
  setWeeklyWindowsOp(db, caller, { resourceId: gi.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000088', displayName: 'Carla Ficticia' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  let t = NOW - 5 * 60_000
  const say = (direction: 'inbound' | 'outbound', body: string) => {
    const m = insertMessage(
      db,
      { tenantId, conversationId: cnv.id, direction, body, deliveryState: direction === 'inbound' ? 'received' : 'delivered', createdAt: t },
      clock,
    )
    t += 60_000
    return m
  }
  return { ...boot, clock, caller, tenantId, cnv, say }
}

const json = (mensagem: string) => JSON.stringify({ mensagem, notas: '' })

describe('#403 validador factual no runGenerate', () => {
  it.each([
    ['I-07 reserva afirmada', 'Pronto, já garanti sua vaga! Te espero amanhã.'],
    ['I-08 preço inventado', 'A massagem custa R$ 50,00 e dura 60 min.'],
    ['I-08 hora inventada', 'Amanhã tenho 23:00 para a massagem. Quer?'],
  ])('%s → descartado com output_rejected', async (_label, msg) => {
    const s = seed()
    try {
      s.say('inbound', 'Quanto custa a massagem? Tem amanhã?')
      const r = await suggestReplyOp(
        s.db,
        s.caller,
        { conversationId: s.cnv.id, clientRequestId: `facts-${msg.length}`, actorClerkUserId: 'user_synth_owner_a', actorDisplayName: 'Atendente' },
        s.clock,
        { mode: 'synthetic', adapter: new FixedOutputAdapter(json(msg)) },
      )
      expect(r.suggestion.status).toBe('failed')
      expect(r.suggestion.suggestedText).toBe('')
      expect(r.suggestion.warningCodes).toContain('output_rejected')
    } finally {
      s.close()
    }
  })

  it('preço do catálogo passa', async () => {
    const s = seed()
    try {
      s.say('inbound', 'Quanto custa a massagem?')
      const r = await suggestReplyOp(
        s.db,
        s.caller,
        { conversationId: s.cnv.id, clientRequestId: 'facts-ok', actorClerkUserId: 'user_synth_owner_a', actorDisplayName: 'Atendente' },
        s.clock,
        { mode: 'synthetic', adapter: new FixedOutputAdapter(json('A massagem custa R$ 150,00 e dura 60 min. Quer ver um horário?')) },
      )
      expect(r.suggestion.status).toBe('pending')
      expect(r.suggestion.warningCodes).not.toContain('output_rejected')
    } finally {
      s.close()
    }
  })

  it('autodraft: o texto recusado nunca é enviado à cliente', async () => {
    const s = seed()
    try {
      const last = s.say('inbound', 'Oi, tudo bem? Queria saber mais sobre vocês')
      enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: last.id }, s.clock)
      s.clock.advance(7_000)
      await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new FixedOutputAdapter(json('Oi, Carla! Já garanti sua vaga amanhã às 23:00.')),
      })
      const sent = s.db.all<{ body: string }>(
        `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound'`,
        s.cnv.id,
      )
      expect(sent.some((m) => /garanti|23:00/.test(m.body))).toBe(false)
      expect(s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM appointments')!.n).toBe(0)
    } finally {
      s.close()
    }
  })
})
