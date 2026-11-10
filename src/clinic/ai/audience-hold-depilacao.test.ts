/**
 * Smoke Paulo staging (tip d50e90e): Agendado → Marcar outro → Feminino/Masculino
 * → Masculino → catalog → Depilação → bot reperguntava linha F/M.
 *
 * Causa: syncBookingFrameWithCatalog (catalogVersion diverge do hold «1»)
 * chamava saveBookingFrame com patch só de versão; line omitido virava null
 * e o hold DEC-142 era apagado.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import {
  listServices,
  replaceServiceZonesOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { tryAiAutoBook } from './autobook'
import { CATALOG_AUDIENCE_LIST_BODY, planCatalogConsult } from './catalog-consult'
import { END_HELP_HINT_TEXT, HOW_TO_END_REPLY, isHowToEndQuestion } from './end-help-hint'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { getBookingFrame, heldAudienceLine, saveBookingFrame } from './schedule-session'
import { readCatalogVersion } from './turn-context'

const NOW = Date.UTC(2026, 10, 10, 10, 54)

function seed() {
  const clock = createControllableClock(NOW - 10 * 60_000)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_aud_hold',
      phoneNumberId: 'pn_aud_hold',
      wabaId: 'waba_aud_hold',
      displayPhone: '+5511900000099',
      displayName: 'Clínica Aud Hold',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi', homeRoomId: room.id }, clock)
  const dep = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 60,
      bufferMinutes: 15,
      priceCents: 19000,
      variantKind: 'Zona',
      variantKindPlural: 'Zonas',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  db.run(`UPDATE services SET audiencia = 'qualquer' WHERE id = ?`, dep.id)
  replaceServiceZonesOp(
    db,
    caller,
    dep.id,
    [
      { name: 'Axila', durationMinutes: 15, priceCents: 5000, audience: 'masculino' },
      { name: 'Pernas', durationMinutes: 30, priceCents: 14000, audience: 'masculino' },
      { name: 'Axila', durationMinutes: 15, priceCents: 4000, audience: 'feminino' },
      { name: 'Pernas', durationMinutes: 30, priceCents: 12000, audience: 'feminino' },
    ],
    clock,
  )
  upsertServiceOp(
    db,
    caller,
    {
      name: 'Limpeza de pele',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: 18000,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000099', displayName: 'Paulo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  // Janela 24 h WhatsApp: inbound recente antes de outbounds interativos.
  clock.advance(60_000)
  insertMessage(
    db,
    {
      tenantId,
      conversationId: cnv.id,
      direction: 'inbound',
      body: 'oi',
      deliveryState: 'received',
      createdAt: clock.nowMs(),
    },
    clock,
  )
  return { db, clock, tenantId, caller, cnv, dep, close: () => boot.close() }
}

describe('audiência solta → Depilação (smoke Marcar outro)', () => {
  it('Marcar outro sem frame (pós-confirm) pede Feminino/Masculino — DEC-142 sem hold', () => {
    const s = seed()
    try {
      const action = planCatalogConsult({
        text: 'quero outro agendamento',
        frame: getBookingFrame(s.db, s.tenantId, s.cnv.id),
        services: listServices(s.db, s.tenantId),
        catalogVersion: readCatalogVersion(s.db, s.tenantId),
        hasActiveProposal: false,
      })
      expect(action?.body).toBe(CATALOG_AUDIENCE_LIST_BODY)
    } finally {
      s.close()
    }
  })

  it('após Masculino no catálogo, «Depilação» não repergunta linha F/M (DEC-090/CF-45)', async () => {
    const s = seed()
    try {
      // Hold de catálogo com versão stale (como namesAction gravava «1» vs catálogo real).
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        { serviceId: null, line: 'masculino', catalogVersion: '1', phase: 'idle' },
        s.clock,
      )
      expect(heldAudienceLine(getBookingFrame(s.db, s.tenantId, s.cnv.id))).toBe('masculino')

      s.clock.advance(60_000)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'Depilação',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )

      expect(heldAudienceLine(getBookingFrame(s.db, s.tenantId, s.cnv.id))).toBe('masculino')

      const out = await tryAiAutoBook(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        capability: true,
      })
      expect(out.replyText ?? '').not.toMatch(/feminina ou masculina/i)
      expect(out.replyText ?? '').toMatch(/zona|qual/i)
      // 1.ª pergunta de zonas após progresso (serviço+linha) — sem hint DEC-152.
      expect(out.replyText ?? '').not.toContain(END_HELP_HINT_TEXT)
      out.deferredFrame?.flushNow(s.db, s.tenantId, s.cnv.id, s.clock)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.line).toBe('masculino')
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.serviceId).toBe(s.dep.id)
    } finally {
      s.close()
    }
  })

  it('autodraft: hold masculino + Depilação → zonas; meta «como termino?» ensina sem handoff', async () => {
    const s = seed()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        { serviceId: null, line: 'masculino', catalogVersion: '1', phase: 'idle' },
        s.clock,
      )
      s.clock.advance(60_000)
      const inbound = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'Depilação',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, messageId: inbound.id },
        s.clock,
      )
      s.clock.advance(7_000)
      const adapter = new SimulatedAiAdapter()
      const zoneOut = await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter,
      })
      expect(zoneOut).toHaveLength(1)
      const zoneAsk = s.db.get<{ body: string }>(
        `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound'
         ORDER BY created_at DESC LIMIT 1`,
        s.cnv.id,
      )
      expect(zoneAsk?.body ?? '').not.toMatch(/feminina ou masculina/i)
      expect(zoneAsk?.body ?? '').not.toContain(END_HELP_HINT_TEXT)

      s.clock.advance(60_000)
      const how = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'Como faço para terminar esta conversa?',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      expect(isHowToEndQuestion(how.body)).toBe(true)
      enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, messageId: how.id },
        s.clock,
      )
      s.clock.advance(7_000)
      const howOut = await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter,
      })
      expect(howOut).toHaveLength(1)
      expect(howOut[0]?.reason).toBe('how_to_end')
      const howReply = s.db.get<{ body: string }>(
        `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound'
         ORDER BY created_at DESC LIMIT 1`,
        s.cnv.id,
      )
      expect(howReply?.body).toBe(HOW_TO_END_REPLY)
      expect(howReply?.body ?? '').not.toMatch(/já|tocou|clicou|equipe continuar/i)
      // Frame de marcação mantém-se (meta ≠ Class A).
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.serviceId).toBe(s.dep.id)
    } finally {
      s.close()
    }
  })
})
