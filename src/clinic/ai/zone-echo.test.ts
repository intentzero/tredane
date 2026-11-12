/**
 * DEC-137 — eco antes de Horários quando as zonas vêm de texto livre.
 * Plural leve só na linha travada. Sim não marca (DEC-061).
 * Dados fictícios. Relógio local da clínica; a copy não leva fuso.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { replaceServiceZonesOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { readZoneSnapshots } from '../config/zones'
import { ensureClinicSettings, setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { handleChoiceOfferClick, parseChoiceId, SLOT_LIST_BUTTON_LABEL, VARIANT_LIST_BUTTON_LABEL } from './choice-offer'
import { localHHMM } from './slot-offer'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { getScheduleSession } from './schedule-session'

const NOW = Date.UTC(2026, 9, 28, 18, 51)

function seed() {
  const clock = createControllableClock(NOW - 10 * 60_000)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-a'
  ensureClinicSettings(db, tenantId, clock)
  db.run(`UPDATE clinic_settings SET booking_lead_minutes = 0 WHERE id = 1`)
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_echo',
      phoneNumberId: 'pn_echo',
      wabaId: 'waba_echo',
      displayPhone: '+5511900000077',
      displayName: 'Clínica Echo',
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
      { name: 'Axila', durationMinutes: 15, priceCents: 5000, audience: 'masculino' },
      { name: 'Pernas', durationMinutes: 30, priceCents: 11000, audience: 'masculino' },
    ],
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000077', displayName: 'Carla Demo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, clock, tenantId, caller, cnv }
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
  return s.db.all<{ body: string; kind: string; interactive_json: string | null }>(
    `SELECT m.body AS body, o.kind AS kind, o.interactive_json AS interactive_json
     FROM outbound_messages o
     JOIN messages m ON m.id = o.message_id
     WHERE o.tenant_id = ?
     ORDER BY o.created_at`,
    s.tenantId,
  )
}

function appointments(s: ReturnType<typeof seed>): number {
  return s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`, s.tenantId)!.n
}

async function lockFeminine(s: ReturnType<typeof seed>) {
  await say(s, 'Quero depilação')
  await say(s, 'feminina')
}

function buttonId(json: string | null, title: string): string {
  const parsed = JSON.parse(json ?? '{}') as {
    buttons?: Array<{ id: string; title: string }>
  }
  const button = parsed.buttons?.find((item) => item.title === title)
  expect(button?.id).toBeTruthy()
  return button!.id
}

describe('DEC-137: eco e plural das zonas', () => {
  it('«Axilas e pernas» com Feminina → Axila+Pernas femininas, eco, sem Horários', async () => {
    const s = seed()
    try {
      await lockFeminine(s)
      const before = outbound(s).length
      const result = await say(s, 'Axilas e pernas')
      const reply = result.autoBook?.replyText ?? ''
      expect(reply).toBe('Entendi: axila, pernas. Certo?')
      expect(result.autoBook?.interactive?.mode).toBe('buttons')
      const after = outbound(s).slice(before)
      const json = after.map((row) => row.interactive_json ?? '').join('\n')
      expect(json).toContain('Sim')
      expect(json).toContain('Corrigir')
      expect(json).not.toContain(SLOT_LIST_BUTTON_LABEL)
      const session = getScheduleSession(s.db, s.tenantId, s.cnv.id)
      const rows = s.db.all<{ id: string; name: string; audience: string }>(
        `SELECT id, name, audience FROM service_zones WHERE tenant_id = ?`,
        s.tenantId,
      )
      const chosen = rows.filter((row) => session?.variantIds?.includes(row.id))
      expect(chosen.map((row) => row.name).sort()).toEqual(['Axila', 'Pernas'])
      expect(chosen.every((row) => row.audience === 'feminino')).toBe(true)
      expect(appointments(s)).toBe(0)
    } finally {
      s.close()
    }
  })

  it('Sim no eco abre Horários e não cria compromisso', async () => {
    const s = seed()
    try {
      await lockFeminine(s)
      await say(s, 'Axilas e pernas')
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
          providerEventKey: 'echo-sim-zonas',
        },
        s.clock,
      )
      expect(clicked.handled).toBe(true)
      if (!clicked.handled) return
      expect(clicked.autoBook?.interactive?.mode).toBe('list')
      if (clicked.autoBook?.interactive?.mode === 'list') {
        expect(clicked.autoBook.interactive.button).toBe(SLOT_LIST_BUTTON_LABEL)
      }
      expect(clicked.autoBook?.replyText ?? '').not.toMatch(/Entendi:/)
      expect(clicked.autoBook?.proposalId).toBeFalsy()
      expect(appointments(s)).toBe(0)
    } finally {
      s.close()
    }
  })

  it('sobra sem plural único pergunta a zona, ecoa o que casou e não oferece Horários', async () => {
    const s = seed()
    try {
      await lockFeminine(s)
      const before = outbound(s).length
      const result = await say(s, 'Axila e cotovelo')
      const reply = result.autoBook?.replyText ?? result.suggestion?.suggestedText ?? ''
      // Paulo 10/11 opção 2: eco factual do match + pergunta da sobra; sem Sim/Corrigir.
      expect(reply).toMatch(/Entendi: axila\./i)
      expect(reply).not.toMatch(/Certo\?/)
      expect(reply).not.toMatch(/Horários livres|próximos horários/i)
      expect(reply).toMatch(/Não encontrei cotovelo nas opções/i)
      expect(reply).toMatch(/Quer .+\?/)
      expect(reply).not.toMatch(/ou outra\?/i)
      const after = outbound(s).slice(before)
      const json = after.map((row) => row.interactive_json ?? '').join('\n')
      // `varias`: sem Opções; a cliente corrige em texto.
      expect(json).not.toContain(VARIANT_LIST_BUTTON_LABEL)
      expect(json).not.toContain(SLOT_LIST_BUTTON_LABEL)
      const session = getScheduleSession(s.db, s.tenantId, s.cnv.id)
      const rows = s.db.all<{ id: string; name: string; audience: string }>(
        `SELECT id, name, audience FROM service_zones WHERE tenant_id = ?`,
        s.tenantId,
      )
      const chosen = rows.filter((row) => session?.variantIds?.includes(row.id))
      expect(chosen.map((row) => row.name)).toEqual(['Axila'])
      expect(chosen.every((row) => row.audience === 'feminino')).toBe(true)
      expect(appointments(s)).toBe(0)
    } finally {
      s.close()
    }
  })

  it('turno actual «as duas» no âmbito de 2 nomes fecha o par (não «Não encontrei duas»)', async () => {
    const s = seed()
    try {
      await lockFeminine(s)
      const result = await say(s, 'as duas')
      const reply = result.autoBook?.replyText ?? result.suggestion?.suggestedText ?? ''
      expect(reply).not.toMatch(/Não encontrei duas/i)
      expect(reply).toBe('Entendi: axila, pernas. Certo?')
      const session = getScheduleSession(s.db, s.tenantId, s.cnv.id)
      const rows = s.db.all<{ id: string; name: string; audience: string }>(
        `SELECT id, name, audience FROM service_zones WHERE tenant_id = ?`,
        s.tenantId,
      )
      const chosen = rows.filter((row) => session?.variantIds?.includes(row.id))
      expect(chosen.map((row) => row.name).sort()).toEqual(['Axila', 'Pernas'])
      expect(chosen.every((row) => row.audience === 'feminino')).toBe(true)
      expect(appointments(s)).toBe(0)
    } finally {
      s.close()
    }
  })

  it('texto livre «Axila» em varias ecoa (sem lista Opções)', async () => {
    const s = seed()
    try {
      await lockFeminine(s)
      const before = outbound(s).length
      const result = await say(s, 'Axila')
      const reply = result.autoBook?.replyText ?? ''
      expect(reply).toBe('Entendi: axila. Certo?')
      expect(result.autoBook?.interactive?.mode).toBe('buttons')
      const after = outbound(s).slice(before)
      const json = after.map((row) => row.interactive_json ?? '').join('\n')
      expect(json).not.toContain(VARIANT_LIST_BUTTON_LABEL)
      expect(json).not.toContain(SLOT_LIST_BUTTON_LABEL)
      expect(appointments(s)).toBe(0)
    } finally {
      s.close()
    }
  })

  it('Corrigir volta à pergunta das zonas em texto e não abre Horários', async () => {
    const s = seed()
    try {
      await lockFeminine(s)
      await say(s, 'Axilas e pernas')
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
          providerEventKey: 'echo-corrigir',
        },
        s.clock,
      )
      expect(clicked.handled).toBe(true)
      if (!clicked.handled) return
      expect(clicked.autoBook?.replyText ?? '').not.toMatch(/Entendi:/)
      expect(clicked.autoBook?.replyText ?? '').not.toMatch(/tenho .+\d{2}:\d{2}/)
      expect(clicked.autoBook?.replyText ?? '').toMatch(/quais zonas|Escreva uma ou várias/i)
      expect(clicked.autoBook?.interactive ?? null).toBeNull()
      expect(clicked.autoBook?.proposalId).toBeFalsy()
      const session = getScheduleSession(s.db, s.tenantId, s.cnv.id)
      expect(session?.variantIds ?? null).toBeNull()
      expect(appointments(s)).toBe(0)
    } finally {
      s.close()
    }
  })

  it('«sim» escrito no eco mantém Axila e Pernas', async () => {
    const s = seed()
    try {
      await lockFeminine(s)
      await say(s, 'Axilas e pernas')
      const result = await say(s, 'sim')
      const reply = result.autoBook?.replyText ?? ''
      expect(reply).toMatch(/Axila/)
      expect(reply).toMatch(/Pernas/)
      expect(reply).not.toMatch(/para Pernas são/i)
      expect(result.autoBook?.interactive?.mode).toBe('list')
      if (result.autoBook?.interactive?.mode === 'list') {
        expect(result.autoBook.interactive.button).toBe(SLOT_LIST_BUTTON_LABEL)
      }
      expect(result.autoBook?.proposalId).toBeFalsy()
      const session = getScheduleSession(s.db, s.tenantId, s.cnv.id)
      const rows = s.db.all<{ id: string; name: string; audience: string }>(
        `SELECT id, name, audience FROM service_zones WHERE tenant_id = ?`,
        s.tenantId,
      )
      const chosen = rows.filter((row) => session?.variantIds?.includes(row.id))
      expect(chosen.map((row) => row.name).sort()).toEqual(['Axila', 'Pernas'])
      expect(chosen.every((row) => row.audience === 'feminino')).toBe(true)
      expect(appointments(s)).toBe(0)
    } finally {
      s.close()
    }
  })

  it('Sim depois de «Axilas e pernas sexta às 10h» propõe as duas zonas e não marca', async () => {
    const s = seed()
    try {
      await lockFeminine(s)
      const echoed = await say(s, 'Axilas e pernas sexta às 10h')
      expect(echoed.autoBook?.replyText ?? '').toBe('Entendi: axila, pernas. Certo?')
      expect(echoed.autoBook?.proposalId).toBeFalsy()
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
          providerEventKey: 'echo-sim-sexta',
        },
        s.clock,
      )
      expect(clicked.handled).toBe(true)
      if (!clicked.handled) return
      expect(clicked.autoBook?.status).toBe('requires_button')
      expect(clicked.autoBook?.proposalId).toBeTruthy()
      const proposal = s.db.get<{ duration_minutes: number; price_cents: number }>(
        `SELECT duration_minutes, price_cents FROM appointment_proposals WHERE tenant_id = ? AND id = ?`,
        s.tenantId,
        clicked.autoBook?.proposalId ?? '',
      )
      expect(proposal?.duration_minutes).toBe(45)
      expect(proposal?.price_cents).toBe(13_000)
      const snaps = readZoneSnapshots(s.db, s.tenantId, 'proposal', clicked.autoBook?.proposalId ?? '')
      expect(snaps.map((zone) => zone.name).sort()).toEqual(['Axila', 'Pernas'])
      expect(snaps.every((zone) => zone.audience === 'feminino')).toBe(true)
      expect(appointments(s)).toBe(0)
    } finally {
      s.close()
    }
  })

  it('toque em Horários 17:00 propõe Axila+Pernas nesse início e não marca', async () => {
    const s = seed()
    try {
      // 16:50 em America/Sao_Paulo, terça 03/11/2026. Janela até 19:00 para 17:00 caber.
      s.clock.set(Date.UTC(2026, 10, 3, 19, 50))
      const resources = s.db.all<{ id: string }>(
        `SELECT id FROM resources WHERE tenant_id = ?`,
        s.tenantId,
      )
      const week = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
        dayOfWeek,
        startMinute: 9 * 60,
        endMinute: 19 * 60,
      }))
      for (const resource of resources) {
        setWeeklyWindowsOp(s.db, s.caller, { resourceId: resource.id, windows: week }, s.clock)
      }
      await lockFeminine(s)
      await say(s, 'Axilas e pernas')
      const echo = outbound(s).filter((row) => (row.interactive_json ?? '').includes('Corrigir')).at(-1)
      const sim = buttonId(echo?.interactive_json ?? null, 'Sim')
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
      const confirmed = await handleChoiceOfferClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId: sim,
          providerEventKey: 'echo-sim-antes-horario',
        },
        s.clock,
      )
      expect(confirmed.handled).toBe(true)
      expect(appointments(s)).toBe(0)
      const list = outbound(s).filter((row) => (row.interactive_json ?? '').includes(SLOT_LIST_BUTTON_LABEL)).at(-1)
      const parsed = JSON.parse(list?.interactive_json ?? '{}') as {
        list?: { sections?: Array<{ rows?: Array<{ id: string; title: string; description?: string }> }> }
      }
      const rows = parsed.list?.sections?.flatMap((section) => section.rows ?? []) ?? []
      const slot = rows.find((row) => row.title === 'terça 03/11 17:00')
      // Título ≤24: sem description — Meta não duplica no bubble do toque.
      expect(slot?.description).toBeUndefined()
      expect(slot?.title).not.toBe('11-03 17:00')
      expect(slot?.title).not.toMatch(/\b\d{2}-\d{2}\b/)
      expect(JSON.stringify(rows)).not.toMatch(/\b\d{2}-\d{2} \d{2}:\d{2}\b/)
      expect(JSON.stringify(slot)).not.toMatch(/America\//)
      expect(parseChoiceId(slot?.id ?? '')?.key).toBe('2026-11-03T17:00')
      s.clock.advance(1_000)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: '[Lista] 11-03 17:00',
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
          buttonId: slot!.id,
          buttonTitle: '11-03 17:00',
          providerEventKey: 'tap-horario-1700',
        },
        s.clock,
      )
      expect(clicked.handled).toBe(true)
      if (!clicked.handled) return
      expect(clicked.autoBook?.replyText ?? '').not.toMatch(/qual dia/i)
      expect(clicked.autoBook?.status).toBe('requires_button')
      expect(clicked.autoBook?.proposalId).toBeTruthy()
      const proposal = s.db.get<{ starts_at: number; duration_minutes: number; price_cents: number }>(
        `SELECT starts_at, duration_minutes, price_cents FROM appointment_proposals WHERE tenant_id = ? AND id = ?`,
        s.tenantId,
        clicked.autoBook?.proposalId ?? '',
      )
      expect(clinicCivilDateFromUtc('America/Sao_Paulo', proposal!.starts_at)).toBe('2026-11-03')
      expect(localHHMM('America/Sao_Paulo', proposal!.starts_at)).toBe('17:00')
      expect(proposal?.duration_minutes).toBe(45)
      expect(proposal?.price_cents).toBe(13_000)
      const snaps = readZoneSnapshots(s.db, s.tenantId, 'proposal', clicked.autoBook?.proposalId ?? '')
      expect(snaps.map((zone) => zone.name).sort()).toEqual(['Axila', 'Pernas'])
      expect(snaps.every((zone) => zone.audience === 'feminino')).toBe(true)
      const sent = outbound(s).at(-1)
      expect(sent?.body ?? '').not.toMatch(/qual dia/i)
      expect(sent?.interactive_json ?? '').toContain('Confirmar')
      expect(sent?.interactive_json ?? '').toContain('Alterar detalhes')
      expect(sent?.interactive_json ?? '').toContain('Falar com a equipe')
      expect(sent?.body ?? '').not.toMatch(/America\//)
      expect(appointments(s)).toBe(0)
    } finally {
      s.close()
    }
  })
})

describe('DEC-143: ai.turn_decided mede zonas vindas do texto', () => {
  function lastTurnDecided(s: ReturnType<typeof seed>) {
    const row = s.db.get<{ payload: string }>(
      `SELECT payload_json AS payload FROM outbox_events
       WHERE tenant_id = ? AND type = 'ai.turn_decided'
       ORDER BY rowid DESC LIMIT 1`,
      s.tenantId,
    )
    return JSON.parse(row!.payload) as {
      variantsChanged: boolean
      pendingSlotBefore: string | null
      slotsFilled: string[]
      zonesAskedBefore: boolean
    }
  }

  it('zonas escritas num turno marcam variantsChanged; o Sim do eco não', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação')
      expect(lastTurnDecided(s).variantsChanged).toBe(false)
      expect(lastTurnDecided(s).zonesAskedBefore).toBe(false) // falta a linha
      await say(s, 'feminina')
      expect(lastTurnDecided(s).variantsChanged).toBe(false)
      await say(s, 'Axilas e pernas')
      const named = lastTurnDecided(s)
      expect(named.variantsChanged).toBe(true)
      // «feminina» deixou o quadro à espera das zonas: a resposta conta como pedida.
      expect(named.zonesAskedBefore).toBe(true)
      expect(named.slotsFilled).toEqual(expect.arrayContaining(['serviceId', 'line', 'variantIds']))
      await say(s, 'sim')
      const confirmed = lastTurnDecided(s)
      expect(confirmed.pendingSlotBefore).toBe('eco')
      expect(confirmed.variantsChanged).toBe(false)
    } finally {
      s.close()
    }
  })

  it('zonas escritas sem lhas pedirem: variantsChanged e zonesAskedBefore=false', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação feminina de axila e pernas')
      const turn = lastTurnDecided(s)
      expect(turn.variantsChanged).toBe(true)
      expect(turn.zonesAskedBefore).toBe(false)
    } finally {
      s.close()
    }
  })
})

describe('DEC-143: zonas escritas antes da linha não se perdem (sonda staging 06/11/2026)', () => {
  it('«Quero depilação de axila e pernas» + «feminina» → eco com Axila e Pernas; Sim abre Horários; não marca', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação de axila e pernas')
      const before = outbound(s).length
      const result = await say(s, 'feminina')
      expect(result.autoBook?.replyText).toBe('Entendi: axila, pernas. Certo?')
      expect(result.reason).not.toBe('catalog_reply')
      const json = outbound(s).slice(before).map((row) => row.interactive_json ?? '').join('\n')
      expect(json).toContain('Sim')
      expect(json).toContain('Corrigir')
      const session = getScheduleSession(s.db, s.tenantId, s.cnv.id)
      const names = s.db
        .all<{ id: string; name: string }>(`SELECT id, name FROM service_zones WHERE tenant_id = ?`, s.tenantId)
        .filter((row) => session?.variantIds?.includes(row.id))
        .map((row) => row.name)
        .sort()
      expect(names).toEqual(['Axila', 'Pernas'])
      expect(session?.audienceLine).toBe('feminino')

      await say(s, 'sim')
      const offered = outbound(s)
        .slice(before)
        .map((row) => row.interactive_json ?? '')
        .join('\n')
      expect(offered).toContain(SLOT_LIST_BUTTON_LABEL)
      expect(appointments(s)).toBe(0)
    } finally {
      s.close()
    }
  })

  it('sem zonas na primeira mensagem, «feminina» continua a perguntar as zonas', async () => {
    const s = seed()
    try {
      await lockFeminine(s)
      const last = outbound(s).at(-1)
      expect(last?.body).toMatch(/axila/)
      expect(last?.body).not.toMatch(/Axila/)
      expect(last?.body).not.toMatch(/Entendi/)
    } finally {
      s.close()
    }
  })
})
