import { describe, expect, it, vi } from 'vitest'
import { workerCaller } from '../clinic'
import { DEMO_CLINIC_TENANT_ID } from '../clinic/demo/ids'
import { ingestContactMessage } from '../clinic/operations'
import { bootClinicDb } from '../clinic/test-db'
import { LabBudgetError, readLabState, runLabTurn, type LabHooks } from './turn'

const WA = '550000000001'

function setup() {
  const { db, clock, close } = bootClinicDb()
  const caller = workerCaller(DEMO_CLINIC_TENANT_ID, 'user_lab_test')
  let n = 0
  const hooks: LabHooks = {
    nowMs: () => clock.nowMs(),
    newId: () => `id${++n}`,
    ingest: async (i) => {
      const r = ingestContactMessage(
        db,
        caller,
        { providerEventKey: i.providerEventKey, waId: i.waId, displayName: i.displayName, body: i.body },
        clock,
      )
      return { conversationId: r.conversation?.id ?? null, contactId: r.conversation?.contactId ?? null }
    },
    click: vi.fn().mockResolvedValue({ handled: true }),
    runAutoDrafts: vi.fn().mockResolvedValue([]),
    settleOutbound: vi.fn().mockResolvedValue(undefined),
  }
  return { db, clock, close, hooks }
}

const budget = (used = 0, cap = 5) => ({ used, cap, commit: vi.fn().mockResolvedValue(undefined) })

describe('turno do laboratório (DEC-186)', () => {
  it('texto: ingere, força a IA já (sem esperar o debounce) e devolve as mensagens do turno', async () => {
    const { db, hooks, close } = setup()
    try {
      const b = budget()
      const out = await runLabTurn(db, DEMO_CLINIC_TENANT_ID, { waId: WA, text: ' Quero massagem ' }, hooks, b)
      expect(hooks.runAutoDrafts).toHaveBeenCalledTimes(1)
      expect(b.commit).toHaveBeenCalledWith(1)
      expect(out.turnsUsedToday).toBe(1)
      expect(out.messages.map((m) => [m.direction, m.body])).toEqual([['inbound', 'Quero massagem']])
      expect(out.conversationId).toBeTruthy()
    } finally {
      close()
    }
  })

  it('toque: ingere o rótulo como o WhatsApp e chama o handler de botões, sem correr a IA', async () => {
    const { db, hooks, close } = setup()
    try {
      const out = await runLabTurn(
        db,
        DEMO_CLINIC_TENANT_ID,
        { waId: WA, tap: { buttonId: 'ch1~abc', title: 'Costas', kind: 'list' } },
        hooks,
        budget(),
      )
      expect(hooks.runAutoDrafts).not.toHaveBeenCalled()
      expect(hooks.click).toHaveBeenCalledWith(
        expect.objectContaining({ buttonId: 'ch1~abc', buttonTitle: 'Costas' }),
      )
      expect(out.messages[0]!.body).toBe('[Lista] Costas')
      expect(out.click).toEqual({ handled: true })
    } finally {
      close()
    }
  })

  it('envios com botões marcam-se como entregues e expõem o que se pode tocar', async () => {
    const { db, hooks, close, clock } = setup()
    try {
      hooks.runAutoDrafts = vi.fn().mockImplementation(async () => {
        const conv = db.get<{ id: string }>('SELECT id FROM conversations WHERE tenant_id = ?', DEMO_CLINIC_TENANT_ID)!
        db.run(
          `INSERT INTO messages (id, tenant_id, conversation_id, direction, body, delivery_state, created_at)
           VALUES ('m_out', ?, ?, 'outbound', 'Quer confirmar?', 'pending', ?)`,
          DEMO_CLINIC_TENANT_ID,
          conv.id,
          clock.nowMs(),
        )
        db.run(
          `INSERT INTO outbox_events (id, tenant_id, type, aggregate_type, aggregate_id, processing_state, payload_json, idempotency_key, occurred_at)
           VALUES ('ob1', ?, 'whatsapp.send', 'outbound_message', 'out1', 'pending', ?, 'k1', ?)`,
          DEMO_CLINIC_TENANT_ID,
          JSON.stringify({
            outboundId: 'out1',
            messageId: 'm_out',
            interactiveButtons: [{ id: 'confirm', title: 'Confirmar' }],
            interactiveList: null,
          }),
          clock.nowMs(),
        )
        return [{ status: 'drafted', conversationId: conv.id }]
      })
      const out = await runLabTurn(db, DEMO_CLINIC_TENANT_ID, { waId: WA, text: 'oi' }, hooks, budget())
      expect(hooks.settleOutbound).toHaveBeenCalledWith({ outboxEventId: 'ob1', idempotencyKey: 'k1', outboundId: 'out1' })
      expect(out.tappable).toEqual({ buttons: [{ id: 'confirm', title: 'Confirmar' }], list: null })
      const reply = out.messages.find((m) => m.id === 'm_out')!
      expect(reply.options?.buttons).toEqual([{ id: 'confirm', title: 'Confirmar' }])
    } finally {
      close()
    }
  })

  it('teto diário esgotado: recusa antes de qualquer efeito', async () => {
    const { db, hooks, close } = setup()
    try {
      await expect(
        runLabTurn(db, DEMO_CLINIC_TENANT_ID, { waId: WA, text: 'oi' }, hooks, budget(5, 5)),
      ).rejects.toBeInstanceOf(LabBudgetError)
      expect(db.get('SELECT 1 AS x FROM contacts WHERE tenant_id = ?', DEMO_CLINIC_TENANT_ID)).toBeUndefined()
    } finally {
      close()
    }
  })

  it('exige exatamente um de text ou tap', async () => {
    const { db, hooks, close } = setup()
    try {
      await expect(runLabTurn(db, DEMO_CLINIC_TENANT_ID, { waId: WA }, hooks, budget())).rejects.toThrow()
      await expect(
        runLabTurn(
          db,
          DEMO_CLINIC_TENANT_ID,
          { waId: WA, text: 'oi', tap: { buttonId: 'a', title: 'b', kind: 'button' } },
          hooks,
          budget(),
        ),
      ).rejects.toThrow()
    } finally {
      close()
    }
  })

  it('estado: contato, conversa e mensagens da cliente; vazio para cliente desconhecida', async () => {
    const { db, hooks, close } = setup()
    try {
      await runLabTurn(db, DEMO_CLINIC_TENANT_ID, { waId: WA, text: 'oi' }, hooks, budget())
      const s = readLabState(db, DEMO_CLINIC_TENANT_ID, { waId: WA }, { used: 1, cap: 5 })
      expect(s.contact?.wa_id).toBe(WA)
      expect(s.conversations).toHaveLength(1)
      expect(s.messages.map((m) => m.body)).toEqual(['oi'])
      const none = readLabState(db, DEMO_CLINIC_TENANT_ID, { waId: '550000000099' }, { used: 1, cap: 5 })
      expect(none.contact).toBeNull()
      expect(none.messages).toEqual([])
    } finally {
      close()
    }
  })
})
