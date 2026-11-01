/**
 * #411 — TurnContext: uma leitura por turno; catálogo compilado por versão;
 * horários do LLM restritos ao serviço em jogo.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { CLINIC_SCOPE_ID } from '../config/types'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { pickServicesForSlots } from './schedule-context'
import {
  getOrCompileCatalog,
  loadTurnContext,
  peekCompiledCatalogCache,
  readCatalogVersion,
  type CatalogReadStats,
} from './turn-context'
import { SimulatedAiAdapter } from '../../ai'

const NOW = Date.UTC(2026, 10, 5, 13, 0)

function seed() {
  const clock = createControllableClock(NOW - 5 * 60_000)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-turnctx'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_turn',
      phoneNumberId: 'pn_turn',
      wabaId: 'waba_turn',
      displayPhone: '+5511900000099',
      displayName: 'Clínica Turn',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
  const ana = upsertResourceOp(db, caller, { kind: 'professional', name: 'Ana', homeRoomId: room.id }, clock)
  const bia = upsertResourceOp(db, caller, { kind: 'professional', name: 'Bia', homeRoomId: room.id }, clock)
  for (const id of [ana.id, bia.id, room.id, CLINIC_SCOPE_ID]) {
    setWeeklyWindowsOp(
      db,
      caller,
      {
        resourceId: id,
        windows: [1, 2, 3, 4, 5].flatMap((d) => [
          { dayOfWeek: d, startMinute: 9 * 60, endMinute: 12 * 60 },
          { dayOfWeek: d, startMinute: 13 * 60, endMinute: 18 * 60 },
        ]),
      },
      clock,
    )
  }
  const limpeza = upsertServiceOp(
    db,
    caller,
    {
      name: 'Limpeza de pele',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: 18000,
      professionalIds: [ana.id, bia.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  const massagem = upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem',
      durationMinutes: 50,
      bufferMinutes: 0,
      priceCents: 15000,
      professionalIds: [bia.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, displayName: 'Carla Teste', waId: '5511999990001' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  clock.set(NOW)
  return { db, clock, caller, tenantId, limpeza, massagem, ana, bia, cnv, contact, close: boot.close }
}

describe('TurnContext (#411)', () => {
  it('loadTurnContext lê catálogo e mensagens uma vez (stats)', () => {
    const s = seed()
    try {
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'Quero limpeza de pele amanhã às 15h',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const msg = s.db.get<{ id: string }>(
        `SELECT id FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1`,
        s.cnv.id,
      )!
      const stats: CatalogReadStats = { services: 0, resources: 0, messages: 0, settings: 0 }
      const turn = loadTurnContext(
        s.db,
        s.tenantId,
        {
          conversationId: s.cnv.id,
          contactId: s.contact.id,
          messageId: msg.id,
          inboundBody: 'Quero limpeza de pele amanhã às 15h',
        },
        s.clock,
        stats,
      )
      expect(stats).toEqual({ services: 1, resources: 1, messages: 1, settings: 1 })
      expect(turn.catalog.services.map((x) => x.name).sort()).toEqual(['Limpeza de pele', 'Massagem'])
      expect(turn.turnText).toContain('limpeza')
      // Segunda carga: catálogo vem da cache (sem nova leitura de services/resources).
      const stats2: CatalogReadStats = { services: 0, resources: 0, messages: 0, settings: 0 }
      loadTurnContext(
        s.db,
        s.tenantId,
        {
          conversationId: s.cnv.id,
          contactId: s.contact.id,
          messageId: msg.id,
        },
        s.clock,
        stats2,
      )
      expect(stats2.services).toBe(0)
      expect(stats2.resources).toBe(0)
      expect(stats2.messages).toBe(1)
      expect(peekCompiledCatalogCache(s.db)?.version).toBe(readCatalogVersion(s.db, s.tenantId))
    } finally {
      s.close()
    }
  })

  it('invalidar catálogo quando a owner grava um serviço', () => {
    const s = seed()
    try {
      const v1 = getOrCompileCatalog(s.db, s.tenantId, s.clock)
      expect(v1.services).toHaveLength(2)
      upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Peeling',
          durationMinutes: 40,
          bufferMinutes: 0,
          priceCents: 20000,
          professionalIds: [s.ana.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      const v2 = getOrCompileCatalog(s.db, s.tenantId, s.clock)
      expect(v2.version).not.toBe(v1.version)
      expect(v2.services.map((x) => x.name)).toContain('Peeling')
    } finally {
      s.close()
    }
  })

  it('pickServicesForSlots restringe ao serviço em jogo', () => {
    const services = [
      { id: 'a', name: 'Limpeza de pele' },
      { id: 'b', name: 'Massagem' },
      { id: 'c', name: 'Depilação' },
    ]
    expect(pickServicesForSlots(services, ['quero massagem'], 'a')).toEqual([
      { id: 'a', name: 'Limpeza de pele' },
    ])
    expect(pickServicesForSlots(services, ['quero massagem'])).toEqual([{ id: 'b', name: 'Massagem' }])
  })

  it('autodraft com TurnContext produz proposta (resultado igual ao caminho anterior)', async () => {
    const s = seed()
    try {
      const m = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'Quero limpeza de pele amanhã às 15h',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, messageId: m.id },
        s.clock,
      )
      s.clock.advance(7_000)
      await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
      const n = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointment_proposals WHERE conversation_id = ?`,
        s.cnv.id,
      )!.n
      expect(n).toBeGreaterThanOrEqual(1)
      expect(peekCompiledCatalogCache(s.db)).toBeTruthy()
    } finally {
      s.close()
    }
  })
})
