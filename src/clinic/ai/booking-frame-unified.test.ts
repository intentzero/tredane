/**
 * #510 / F1-4 — um só BookingFrame para toque, texto e correção.
 * Proposta lê o quadro; pergunta só o campo que falta; Corrigir volta ao certo.
 * Dados fictícios. Sem Flow (#514).
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
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import {
  getBookingFrame,
  getScheduleSession,
  saveBookingFrame,
  wouldAskFilledSlot,
} from './schedule-session'

const NOW = Date.UTC(2026, 9, 28, 18, 51)

function seed() {
  const clock = createControllableClock(NOW - 10 * 60_000)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-510'
  const caller = workerCaller(tenantId, 'user_synth_owner_510')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_510',
      phoneNumberId: 'pn_510',
      wabaId: 'waba_510',
      displayPhone: '+5511900000510',
      displayName: 'Clínica 510',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 510', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Lia', homeRoomId: room.id }, clock)
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
      { name: 'Axila', durationMinutes: 15, priceCents: 5000, audience: 'masculino' },
      { name: 'Pernas', durationMinutes: 30, priceCents: 11000, audience: 'masculino' },
    ],
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000510', displayName: 'Nara Demo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, clock, tenantId, caller, cnv, svcId: svc.id }
}

async function say(s: ReturnType<typeof seed>, body: string) {
  s.clock.advance(60_000)
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
  const out = await runDueAutoDrafts(s.db, s.caller, s.clock, {
    mode: 'synthetic',
    adapter: new SimulatedAiAdapter(),
  })
  return out[0]!
}

function outbound(s: ReturnType<typeof seed>) {
  return s.db.all<{ body: string; interactive_json: string | null }>(
    `SELECT m.body AS body, o.interactive_json AS interactive_json
     FROM outbound_messages o
     JOIN messages m ON m.id = o.message_id
     WHERE o.tenant_id = ?
     ORDER BY o.created_at`,
    s.tenantId,
  )
}

function buttonId(json: string | null, title: string): string {
  const parsed = JSON.parse(json ?? '{}') as {
    buttons?: Array<{ id: string; title: string }>
  }
  const button = parsed.buttons?.find((item) => item.title === title)
  expect(button?.id).toBeTruthy()
  return button!.id
}

function listRowId(json: string | null, title: string): string {
  const parsed = JSON.parse(json ?? '{}') as {
    list?: { sections?: Array<{ rows?: Array<{ id: string; title: string }> }> }
  }
  const row = parsed.list?.sections?.flatMap((section) => section.rows ?? []).find((item) => item.title === title)
  expect(row?.id).toBeTruthy()
  return row!.id
}

function zoneIds(s: ReturnType<typeof seed>, audience: 'feminino' | 'masculino', names: string[]) {
  const rows = s.db.all<{ id: string; name: string; audience: string }>(
    `SELECT id, name, audience FROM service_zones WHERE tenant_id = ?`,
    s.tenantId,
  )
  return names.map((name) => {
    const row = rows.find((z) => z.name === name && z.audience === audience)
    expect(row).toBeTruthy()
    return row!.id
  })
}

function frameSnapshot(s: ReturnType<typeof seed>) {
  const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
  const rows = s.db.all<{ id: string; name: string; audience: string }>(
    `SELECT id, name, audience FROM service_zones WHERE tenant_id = ?`,
    s.tenantId,
  )
  const variantNames = (frame?.variantIds ?? [])
    .map((id) => rows.find((row) => row.id === id))
    .filter(Boolean)
    .map((row) => `${row!.audience}:${row!.name}`)
    .sort()
  return {
    line: frame?.line ?? null,
    variantNames,
  }
}

describe('#510 um só quadro (toque / texto / correção)', () => {
  it('linha já no quadro → zonas/hora não reperguntam género', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação')
      await say(s, 'feminina')
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.line).toBe('feminino')
      expect(wouldAskFilledSlot(frame!, 'line')).toBe(true)

      const result = await say(s, 'Axila e pernas sexta às 10h')
      const reply = result.autoBook?.replyText ?? result.suggestion?.suggestedText ?? ''
      const outboundBodies = outbound(s).map((row) => row.body).join('\n')
      expect(reply).not.toMatch(/Feminina|Masculina|qual linha/i)
      expect(outboundBodies).not.toMatch(/Feminina|Masculina/)
      // Eco DEC-137 ou proposta (CF-24) — nenhum dos dois reabre género.
      const echoed = /Entendi: Axila e Pernas/.test(reply) || /Entendi: Axila e Pernas/.test(outboundBodies)
      const proposed = Boolean(result.autoBook?.proposalId)
      expect(echoed || proposed).toBe(true)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.line).toBe('feminino')
    } finally {
      s.close()
    }
  })

  it('Sim do eco mantém as zonas do quadro (sem segundo parser)', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação')
      await say(s, 'feminina')
      await say(s, 'Axilas e pernas')
      const before = getScheduleSession(s.db, s.tenantId, s.cnv.id)?.variantIds?.slice().sort() ?? []
      expect(before.length).toBe(2)

      const echo = outbound(s).filter((row) => (row.interactive_json ?? '').includes('Corrigir')).at(-1)
      const id = buttonId(echo?.interactive_json ?? null, 'Sim')
      s.clock.advance(1_000)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: '[Botão] Sim',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const clicked = await handleChoiceOfferClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId: id,
          providerEventKey: '510-echo-sim',
        },
        s.clock,
      )
      expect(clicked.handled).toBe(true)
      if (!clicked.handled) return
      const after = getScheduleSession(s.db, s.tenantId, s.cnv.id)?.variantIds?.slice().sort() ?? []
      expect(after).toEqual(before)
      expect(clicked.autoBook?.interactive?.mode).toBe('list')
      expect(clicked.autoBook?.proposalId).toBeFalsy()
      const expected = zoneIds(s, 'feminino', ['Axila', 'Pernas']).sort()
      expect(after).toEqual(expected)
    } finally {
      s.close()
    }
  })

  it('Corrigir limpa variantes e reabre a pergunta das zonas', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação')
      await say(s, 'feminina')
      await say(s, 'Axilas e pernas')
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.variantIds?.length).toBe(2)

      const echo = outbound(s).filter((row) => (row.interactive_json ?? '').includes('Corrigir')).at(-1)
      const id = buttonId(echo?.interactive_json ?? null, 'Corrigir')
      s.clock.advance(1_000)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: '[Botão] Corrigir',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const clicked = await handleChoiceOfferClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId: id,
          providerEventKey: '510-echo-corrigir',
        },
        s.clock,
      )
      expect(clicked.handled).toBe(true)
      if (!clicked.handled) return
      expect(clicked.autoBook?.replyText ?? '').not.toMatch(/Horários|Entendi:/)
      expect(clicked.autoBook?.interactive?.mode).toBe('list')
      if (clicked.autoBook?.interactive?.mode === 'list') {
        expect(clicked.autoBook.interactive.button).toBe(VARIANT_LIST_BUTTON_LABEL)
      }
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.line).toBe('feminino')
      expect(frame?.variantIds ?? null).toBeNull()
      expect(wouldAskFilledSlot(frame!, 'line')).toBe(true)
      expect(wouldAskFilledSlot(frame!, 'variantIds')).toBe(false)
    } finally {
      s.close()
    }
  })

  it('toque, texto e correção do mesmo pedido → mesmo quadro', async () => {
    const expectedZones = ['Axila']

    // Caminho toque
    const tap = seed()
    let tapSnap: ReturnType<typeof frameSnapshot>
    try {
      await say(tap, 'Quero depilação')
      const lineOut = outbound(tap).filter((row) => (row.interactive_json ?? '').includes('Feminina')).at(-1)
      const feminina = buttonId(lineOut?.interactive_json ?? null, 'Feminina')
      tap.clock.advance(1_000)
      insertMessage(
        tap.db,
        {
          tenantId: tap.tenantId,
          conversationId: tap.cnv.id,
          direction: 'inbound',
          body: '[Botão] Feminina',
          deliveryState: 'received',
          createdAt: tap.clock.nowMs(),
        },
        tap.clock,
      )
      await handleChoiceOfferClick(
        tap.db,
        tap.caller,
        {
          tenantId: tap.tenantId,
          conversationId: tap.cnv.id,
          buttonId: feminina,
          providerEventKey: '510-tap-line',
        },
        tap.clock,
      )
      const options = outbound(tap)
        .filter((row) => (row.interactive_json ?? '').includes(VARIANT_LIST_BUTTON_LABEL))
        .at(-1)
      const axila = listRowId(options?.interactive_json ?? null, 'Axila')
      tap.clock.advance(1_000)
      insertMessage(
        tap.db,
        {
          tenantId: tap.tenantId,
          conversationId: tap.cnv.id,
          direction: 'inbound',
          body: '[Lista] Axila',
          deliveryState: 'received',
          createdAt: tap.clock.nowMs(),
        },
        tap.clock,
      )
      await handleChoiceOfferClick(
        tap.db,
        tap.caller,
        {
          tenantId: tap.tenantId,
          conversationId: tap.cnv.id,
          buttonId: axila,
          buttonTitle: 'Axila',
          providerEventKey: '510-tap-axila',
        },
        tap.clock,
      )
      tapSnap = frameSnapshot(tap)
      expect(tapSnap.line).toBe('feminino')
      expect(tapSnap.variantNames).toEqual(expectedZones.map((n) => `feminino:${n}`))
      expect(wouldAskFilledSlot(getBookingFrame(tap.db, tap.tenantId, tap.cnv.id)!, 'line')).toBe(true)
      expect(wouldAskFilledSlot(getBookingFrame(tap.db, tap.tenantId, tap.cnv.id)!, 'variantIds')).toBe(true)
    } finally {
      tap.close()
    }

    // Caminho texto + eco Sim
    const text = seed()
    let textSnap: ReturnType<typeof frameSnapshot>
    try {
      await say(text, 'Quero depilação')
      await say(text, 'feminina')
      await say(text, 'Axila')
      const echo = outbound(text).filter((row) => (row.interactive_json ?? '').includes('Corrigir')).at(-1)
      // Texto exacto numa zona pode ir directo a Horários (sem eco) — ambos OK para o quadro.
      if (echo) {
        const id = buttonId(echo.interactive_json, 'Sim')
        text.clock.advance(1_000)
        insertMessage(
          text.db,
          {
            tenantId: text.tenantId,
            conversationId: text.cnv.id,
            direction: 'inbound',
            body: '[Botão] Sim',
            deliveryState: 'received',
            createdAt: text.clock.nowMs(),
          },
          text.clock,
        )
        await handleChoiceOfferClick(
          text.db,
          text.caller,
          {
            tenantId: text.tenantId,
            conversationId: text.cnv.id,
            buttonId: id,
            providerEventKey: '510-text-sim',
          },
          text.clock,
        )
      }
      textSnap = frameSnapshot(text)
      expect(textSnap.line).toBe('feminino')
      expect(textSnap.variantNames).toEqual(expectedZones.map((n) => `feminino:${n}`))
    } finally {
      text.close()
    }

    // Caminho correção: eco errado → Corrigir → Axila
    const corr = seed()
    let corrSnap: ReturnType<typeof frameSnapshot>
    try {
      await say(corr, 'Quero depilação')
      await say(corr, 'feminina')
      await say(corr, 'Axilas e pernas')
      const echo = outbound(corr).filter((row) => (row.interactive_json ?? '').includes('Corrigir')).at(-1)
      const corrigir = buttonId(echo?.interactive_json ?? null, 'Corrigir')
      corr.clock.advance(1_000)
      insertMessage(
        corr.db,
        {
          tenantId: corr.tenantId,
          conversationId: corr.cnv.id,
          direction: 'inbound',
          body: '[Botão] Corrigir',
          deliveryState: 'received',
          createdAt: corr.clock.nowMs(),
        },
        corr.clock,
      )
      await handleChoiceOfferClick(
        corr.db,
        corr.caller,
        {
          tenantId: corr.tenantId,
          conversationId: corr.cnv.id,
          buttonId: corrigir,
          providerEventKey: '510-corr-corrigir',
        },
        corr.clock,
      )
      const options = outbound(corr)
        .filter((row) => (row.interactive_json ?? '').includes(VARIANT_LIST_BUTTON_LABEL))
        .at(-1)
      const axila = listRowId(options?.interactive_json ?? null, 'Axila')
      corr.clock.advance(1_000)
      insertMessage(
        corr.db,
        {
          tenantId: corr.tenantId,
          conversationId: corr.cnv.id,
          direction: 'inbound',
          body: '[Lista] Axila',
          deliveryState: 'received',
          createdAt: corr.clock.nowMs(),
        },
        corr.clock,
      )
      await handleChoiceOfferClick(
        corr.db,
        corr.caller,
        {
          tenantId: corr.tenantId,
          conversationId: corr.cnv.id,
          buttonId: axila,
          buttonTitle: 'Axila',
          providerEventKey: '510-corr-axila',
        },
        corr.clock,
      )
      corrSnap = frameSnapshot(corr)
      expect(corrSnap.line).toBe('feminino')
      expect(corrSnap.variantNames).toEqual(expectedZones.map((n) => `feminino:${n}`))
    } finally {
      corr.close()
    }

    expect(tapSnap).toEqual(textSnap)
    expect(tapSnap).toEqual(corrSnap)
  })

  it('propriedade: slot preenchido no quadro não é perguntado (três caminhos)', () => {
    const base = {
      phase: 'coletando' as const,
      professionalPref: null,
      period: null,
      time: null,
      pending: null,
      lastOffer: null,
      proposal: null,
      rescheduleAppointmentId: null,
      catalogVersion: '1',
      provenance: {},
      updatedAt: 1,
      date: null,
    }
    for (const path of ['toque', 'texto', 'correção'] as const) {
      const frame = {
        ...base,
        serviceId: `svc-${path}`,
        line: 'feminino' as const,
        variantIds: ['z1'],
        date: '2026-11-07',
      }
      expect(wouldAskFilledSlot(frame, 'line'), path).toBe(true)
      expect(wouldAskFilledSlot(frame, 'variantIds'), path).toBe(true)
      expect(wouldAskFilledSlot(frame, 'date'), path).toBe(true)
      expect(wouldAskFilledSlot(frame, 'time'), path).toBe(false)
    }
  })

  it('provenance aceita source flow (prep #514, sem handler)', () => {
    const s = seed()
    try {
      const { frame } = saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.svcId,
          line: 'feminino',
          catalogVersion: '1',
          sourceMessageId: 'msg-flow-prep',
          source: 'flow',
        },
        s.clock,
      )
      expect(frame.provenance.serviceId?.source).toBe('flow')
      expect(frame.provenance.line?.source).toBe('flow')
    } finally {
      s.close()
    }
  })
})
