/**
 * #407 / CA-09: ai.turn_decided sem texto da conversa.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import {
  assertTurnDecidedMinimized,
  emitTurnDecided,
  type TurnDecidedPayload,
} from './turn-decided'

const NOW = Date.UTC(2026, 10, 5, 13, 0)

function samplePayload(over: Partial<TurnDecidedPayload> = {}): TurnDecidedPayload {
  return {
    tenantId: 'clinic-demo-a',
    conversationId: 'cnv_1',
    messageIds: ['msg_1'],
    route: 'fallback',
    slotsFilled: ['service'],
    slotsMissing: ['time'],
    modelCalled: true,
    textDiscarded: true,
    model: 'claude-haiku-5-5',
    latencyMs: { debounce: 7000, model: 12, decision: 20, send: 5 },
    tokens: { input: 100, output: 20 },
    ...over,
  }
}

describe('#407 ai.turn_decided', () => {
  it('rejeita payload com chave de corpo de mensagem', () => {
    const dirty = {
      ...samplePayload(),
      body: 'Oi, quero limpeza amanhã',
    } as TurnDecidedPayload & { body: string }
    expect(() => assertTurnDecidedMinimized(dirty)).toThrow(/texto de conversa|corpo/)
  })

  it('aceita payload mínimo sem prosa', () => {
    expect(() => assertTurnDecidedMinimized(samplePayload())).not.toThrow()
  })

  it('autodraft emite outbox ai.turn_decided sem o texto inbound', async () => {
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
        bindingId: 'bind_td',
        phoneNumberId: 'pn_td',
        wabaId: 'waba_td',
        displayPhone: '+5511900000407',
        displayName: 'Clínica Turn',
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
        durationMinutes: 50,
        bufferMinutes: 0,
        priceCents: 15000,
        professionalIds: [gi.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
    setWeeklyWindowsOp(
      db,
      caller,
      {
        resourceId: gi.id,
        windows: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1080 })),
      },
      clock,
    )
    setClinicAiAssistEnabled(db, tenantId, true, clock)
    const contact = upsertContact(db, { tenantId, waId: '5511900000407', displayName: 'Carla Ficticia' }, clock)
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    const secret = 'SEGREDO_CONVERSA_NUNCA_NO_EVENTO_xyz'
    const msg = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body: secret,
        deliveryState: 'received',
        createdAt: clock.nowMs(),
      },
      clock,
    )
    enqueueAutoDraft(db, tenantId, { conversationId: cnv.id, messageId: msg.id }, clock)
    clock.advance(7_000)
    await runDueAutoDrafts(db, caller, clock, {
      mode: 'synthetic',
      adapter: {
        providerId: 'test',
        mode: 'synthetic',
        async generate() {
          return {
            ok: false,
            code: 'timeout',
            message: 'timeout',
            retryable: true,
            latencyMs: 1,
            provider: 'test',
            model: 'test',
          }
        },
        lastInspection: () => null,
      },
    })
    const rows = db.all<{ type: string; payload: string }>(
      `SELECT type, payload_json AS payload FROM outbox_events
       WHERE tenant_id = ? AND type = 'ai.turn_decided'`,
      tenantId,
    )
    expect(rows.length).toBeGreaterThanOrEqual(1)
    for (const row of rows) {
      expect(row.payload).not.toContain(secret)
      expect(row.payload).not.toMatch(/"body"\s*:/)
      expect(row.payload).toMatch(/"route"\s*:/)
      assertTurnDecidedMinimized(JSON.parse(row.payload) as TurnDecidedPayload)
    }
    boot.close()
  })

  it('emitTurnDecided grava outbox idempotente por messageId+rota', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-a'
    workerCaller(tenantId, 'user_synth_owner_a')
    // bind tenant via settings enable path
    setClinicAiAssistEnabled(db, tenantId, true, clock)
    const a = emitTurnDecided(db, samplePayload({ conversationId: 'cnv_x', messageIds: ['m1'] }), clock)
    const b = emitTurnDecided(db, samplePayload({ conversationId: 'cnv_x', messageIds: ['m1'] }), clock)
    expect(a.id).toBe(b.id)
    boot.close()
  })
})
