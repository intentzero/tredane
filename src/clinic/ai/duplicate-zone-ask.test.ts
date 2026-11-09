/**
 * Staging Paulo 09/11/2026: após «Masculina», a ask-tipo de zonas saía duas vezes
 * (mesmo corpo) — uma com «Falar com a equipe», outra com Opções.
 *
 * Causa: ingest do button_reply enfileira autodraft; catalog_reply realizava a
 * pergunta com handoff; o choice handler mandava de novo com Opções. Com race
 * (alarme antes do cancel) saíam as duas.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { replaceServiceZonesOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { handleChoiceOfferClick, VARIANT_LIST_BUTTON_LABEL } from './choice-offer'
import { HUMAN_HANDOFF_BUTTON_TITLE } from './human-handoff'
import { enqueueAutoDraft, getAutoDraftJob, runDueAutoDrafts } from './index'

const NOW = Date.UTC(2026, 9, 28, 18, 51)

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
      bindingId: 'bind_dup_zone',
      phoneNumberId: 'pn_dup_zone',
      wabaId: 'waba_dup_zone',
      displayPhone: '+5511900000099',
      displayName: 'Clínica Dup Zone',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi', homeRoomId: room.id }, clock)
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 30,
      bufferMinutes: 0,
      priceCents: 8000,
      variantKind: 'zona',
      variantKindPlural: 'zonas',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  replaceServiceZonesOp(
    db,
    caller,
    svc.id,
    [
      { name: 'Axila', durationMinutes: 15, priceCents: 4000, audience: 'feminino' },
      { name: 'Pernas', durationMinutes: 30, priceCents: 9000, audience: 'feminino' },
      { name: 'Tórax e abdômen', durationMinutes: 40, priceCents: 12000, audience: 'masculino' },
      { name: 'Costas', durationMinutes: 30, priceCents: 7000, audience: 'masculino' },
      { name: 'Braços', durationMinutes: 20, priceCents: 5000, audience: 'masculino' },
      { name: 'Íntima', durationMinutes: 20, priceCents: 6000, audience: 'masculino' },
      { name: 'Orelha', durationMinutes: 10, priceCents: 2000, audience: 'masculino' },
    ],
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000099', displayName: 'Paulo Demo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  clock.advance(60_000)
  return { ...boot, clock, tenantId, caller, cnv, db }
}

async function say(s: ReturnType<typeof seed>, body: string) {
  insertMessage(
    s.db,
    {
      tenantId: s.tenantId,
      conversationId: s.cnv.id,
      direction: 'inbound',
      body,
      deliveryState: 'received',
      createdAt: s.clock.nowMs(),
    },
    s.clock,
  )
  const last = s.db.get<{ id: string }>(
    `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
    s.cnv.id,
  )!
  enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: last.id }, s.clock)
  s.clock.advance(7_000)
  return runDueAutoDrafts(s.db, s.caller, s.clock, {
    mode: 'synthetic',
    adapter: new SimulatedAiAdapter(),
  })
}

function outbound(s: ReturnType<typeof seed>) {
  return s.db.all<{ body: string; kind: string; interactive_json: string | null }>(
    `SELECT m.body AS body, o.kind AS kind, o.interactive_json AS interactive_json
     FROM outbound_messages o
     JOIN messages m ON m.id = o.message_id
     WHERE o.tenant_id = ?
     ORDER BY o.created_at, o.rowid`,
    s.tenantId,
  )
}

function masculinaButtonId(interactiveJson: string | null): string {
  const parsed = JSON.parse(interactiveJson ?? '{}') as {
    buttons?: Array<{ id: string; title: string }>
  }
  const btn = parsed.buttons?.find((b) => /masculina/i.test(b.title))
  expect(btn?.id).toBeTruthy()
  return btn!.id
}

function zoneAskRows(rows: ReturnType<typeof outbound>) {
  return rows.filter((m) => /quais zonas/i.test(m.body))
}

describe('zona-ask única após escolha de linha', () => {
  it('texto «Masculina» manda uma ask-tipo com Opções (não handoff)', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação')
      const before = outbound(s).length
      await say(s, 'Masculina')
      const after = outbound(s).slice(before)
      const asks = zoneAskRows(after)
      expect(asks).toHaveLength(1)
      expect(asks[0]!.interactive_json ?? '').toContain(VARIANT_LIST_BUTTON_LABEL)
      expect(asks[0]!.interactive_json ?? '').not.toContain(HUMAN_HANDOFF_BUTTON_TITLE)
    } finally {
      s.close()
    }
  })

  it('produção: ingest enfileira autodraft + toque Masculina → uma Opções', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação')
      const lineOut = outbound(s).find((m) => m.kind === 'interactive')
      const buttonId = masculinaButtonId(lineOut!.interactive_json)
      s.clock.advance(1_000)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: '[Botão] Masculina',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const last = s.db.get<{ id: string }>(
        `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
        s.cnv.id,
      )!
      enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: last.id }, s.clock)
      expect(getAutoDraftJob(s.db, s.tenantId, s.cnv.id)).not.toBeNull()

      const before = outbound(s).length
      const clicked = await handleChoiceOfferClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId,
          providerEventKey: 'dup-zone-prod',
        },
        s.clock,
      )
      expect(clicked.handled).toBe(true)
      // Choice cancela o job; o drain não deve emitir segunda ask-tipo.
      expect(getAutoDraftJob(s.db, s.tenantId, s.cnv.id)).toBeNull()
      s.clock.advance(7_000)
      const outcomes = await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
      expect(outcomes).toHaveLength(0)
      const after = outbound(s).slice(before)
      const asks = zoneAskRows(after)
      expect(asks).toHaveLength(1)
      expect(asks[0]!.interactive_json ?? '').toContain(VARIANT_LIST_BUTTON_LABEL)
      expect(asks.some((m) => (m.interactive_json ?? '').includes(HUMAN_HANDOFF_BUTTON_TITLE))).toBe(
        false,
      )
    } finally {
      s.close()
    }
  })

  it('race: autodraft do [Botão] Masculina antes do click não emite ask-tipo', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação')
      const lineOut = outbound(s).find((m) => m.kind === 'interactive')
      const buttonId = masculinaButtonId(lineOut!.interactive_json)
      s.clock.advance(1_000)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: '[Botão] Masculina',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const last = s.db.get<{ id: string }>(
        `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
        s.cnv.id,
      )!
      enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: last.id }, s.clock)
      const before = outbound(s).length
      s.clock.advance(7_000)
      const outcomes = await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
      expect(outcomes.some((o) => o.reason === 'interactive_reply_button')).toBe(true)
      expect(zoneAskRows(outbound(s).slice(before))).toHaveLength(0)

      const clicked = await handleChoiceOfferClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId,
          providerEventKey: 'dup-zone-race',
        },
        s.clock,
      )
      expect(clicked.handled).toBe(true)
      const asks = zoneAskRows(outbound(s).slice(before))
      expect(asks).toHaveLength(1)
      expect(asks[0]!.interactive_json ?? '').toContain(VARIANT_LIST_BUTTON_LABEL)
      expect(asks[0]!.interactive_json ?? '').not.toContain(HUMAN_HANDOFF_BUTTON_TITLE)
    } finally {
      s.close()
    }
  })
})
