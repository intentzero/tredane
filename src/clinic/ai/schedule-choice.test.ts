/**
 * Cumprimento «tudo bem» não é o atalho do catálogo inteiro.
 * «quero tudo» / «todas» / «completo» continuam a ser, no turno que o diz.
 * Dados fictícios.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { replaceServiceZonesOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import type { ServiceZoneRow } from '../config/types'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { getScheduleSession, saveScheduleSession } from './schedule-session'
import { claimsCatalogShortcut, claimsWholeCatalog, zonesChosenInClientTexts } from './schedule-choice'

function zone(
  id: string,
  name: string,
  audience: ServiceZoneRow['audience'] = 'ambos',
): ServiceZoneRow {
  return {
    id,
    tenantId: 't',
    serviceId: 's',
    name,
    durationMinutes: 30,
    priceCents: 1000,
    audience,
    active: true,
    sortOrder: 0,
    synonyms: [],
  }
}

const MASSAGEM = [
  zone('lib', 'Liberação miofascial'),
  zone('ven', 'Ventosaterapia'),
  zone('dre', 'Drenagem linfática'),
  zone('rel', 'Massagem relaxante'),
]
const MASSAGEM_IGNORE = { ignoreWords: ['Massagem'] }
const MASSAGEM_NAMES = MASSAGEM.map((item) => item.name)

const DEPILACAO = [
  zone('ax', 'Axila', 'feminino'),
  zone('pe', 'Pernas', 'feminino'),
  zone('bu', 'Buço', 'feminino'),
]

describe('atalho de catálogo sem cumprimento', () => {
  it('«tudo bem / bom / certo / jóia / ótimo» não é o catálogo', () => {
    for (const text of [
      'Oi tudo bem?',
      'Oi, tudo bem?',
      'tudo bem',
      'Tudo bem!',
      'tudo bom',
      'tudo bom?',
      'tudo certo',
      'tudo jóia',
      'tudo joia',
      'tudo ótimo',
      'tudo otimo',
      'E aí, tudo certo?',
    ]) {
      expect(claimsWholeCatalog(text), text).toBe(false)
      expect(claimsCatalogShortcut(text), text).toBe(false)
      const chosen = zonesChosenInClientTexts([text], MASSAGEM, MASSAGEM_IGNORE)
      expect(chosen.zones, text).toEqual([])
      expect(chosen.ambiguous, text).toBe(false)
    }
  })

  it('«quero tudo», «todas», «todos», «completo» e «completa» devolvem o âmbito', () => {
    for (const text of ['quero tudo', 'tudo', 'Tudo, pode ser às 14?', 'todas', 'todos', 'completo', 'completa']) {
      expect(claimsWholeCatalog(text), text).toBe(true)
      const chosen = zonesChosenInClientTexts([text], MASSAGEM, MASSAGEM_IGNORE)
      expect(chosen.ambiguous, text).toBe(false)
      expect(chosen.zones.map((item) => item.name), text).toEqual(MASSAGEM_NAMES)
    }
  })

  it('modo uma: «tudo» e dois nomes não fecham combinação', () => {
    const tudo = zonesChosenInClientTexts(['quero tudo'], MASSAGEM, {
      ...MASSAGEM_IGNORE,
      selectionMode: 'uma',
    })
    expect(tudo.zones).toEqual([])
    const dois = zonesChosenInClientTexts(['Liberação miofascial e Ventosaterapia'], MASSAGEM, {
      ...MASSAGEM_IGNORE,
      selectionMode: 'uma',
    })
    expect(dois.zones).toEqual([])
    const um = zonesChosenInClientTexts(['Ventosaterapia'], MASSAGEM, {
      ...MASSAGEM_IGNORE,
      selectionMode: 'uma',
    })
    expect(um.zones.map((z) => z.name)).toEqual(['Ventosaterapia'])
  })

  it('cumprimento e «quero tudo» na mesma frase: o atalho real fica', () => {
    const chosen = zonesChosenInClientTexts(['Oi, tudo bem? Quero tudo'], MASSAGEM, MASSAGEM_IGNORE)
    expect(chosen.zones.map((item) => item.name)).toEqual(MASSAGEM_NAMES)
  })

  it('histórico «Oi tudo bem?» + «Quero agendar uma massagem» não escolhe variantes', () => {
    const chosen = zonesChosenInClientTexts(
      ['Quero agendar uma massagem', 'Oi tudo bem?'],
      MASSAGEM,
      MASSAGEM_IGNORE,
    )
    expect(chosen).toEqual({ zones: [], ambiguous: false })
    const joined = zonesChosenInClientTexts(
      ['Oi tudo bem?\nQuero agendar uma massagem'],
      MASSAGEM,
      MASSAGEM_IGNORE,
    )
    expect(joined).toEqual({ zones: [], ambiguous: false })
  })

  it('«quero tudo» com o serviço aberto ignora o cumprimento anterior e devolve todas', () => {
    const chosen = zonesChosenInClientTexts(['quero tudo', 'Oi tudo bem?'], MASSAGEM, MASSAGEM_IGNORE)
    expect(chosen.ambiguous).toBe(false)
    expect(chosen.zones.map((item) => item.name)).toEqual(MASSAGEM_NAMES)
  })

  it('«tudo bem, quero a relaxante» escolhe só essa variante', () => {
    const chosen = zonesChosenInClientTexts(['tudo bem, quero a relaxante'], MASSAGEM, MASSAGEM_IGNORE)
    expect(chosen.ambiguous).toBe(false)
    expect(chosen.zones.map((item) => item.id)).toEqual(['rel'])
  })

  it('«Axilas e pernas» depois do cumprimento continua o par, não o catálogo', () => {
    const chosen = zonesChosenInClientTexts(
      ['Axilas e pernas', 'Oi tudo bem?'],
      DEPILACAO,
      { ignoreWords: ['Depilação'] },
    )
    expect(chosen.ambiguous).toBe(false)
    expect(chosen.zones.map((item) => item.name)).toEqual(['Axila', 'Pernas'])
  })

  it('«as duas» só fecha o âmbito quando ele tem dois nomes', () => {
    const pair = DEPILACAO.filter((item) => item.id !== 'bu')
    expect(zonesChosenInClientTexts(['as duas'], pair).zones.map((item) => item.name)).toEqual([
      'Axila',
      'Pernas',
    ])
    expect(zonesChosenInClientTexts(['as duas'], MASSAGEM, MASSAGEM_IGNORE).zones).toEqual([])
    expect(claimsCatalogShortcut('as duas')).toBe(true)
  })
})

const NOW = Date.UTC(2026, 9, 28, 18, 51)

function seedMassagem() {
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
      bindingId: 'bind_tudo',
      phoneNumberId: 'pn_tudo',
      wabaId: 'waba_tudo',
      displayPhone: '+5511900000088',
      displayName: 'Clínica Tudo',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Bia', homeRoomId: room.id }, clock)
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem',
      durationMinutes: 50,
      bufferMinutes: 0,
      priceCents: 15000,
      variantKind: 'tipo',
      variantKindPlural: 'tipos',
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
      { name: 'Liberação miofascial', audience: 'ambos', durationMinutes: 50, priceCents: 15_000 },
      { name: 'Ventosaterapia', audience: 'ambos', durationMinutes: 45, priceCents: 14_000 },
      { name: 'Drenagem linfática', audience: 'ambos', durationMinutes: 50, priceCents: 16_000 },
      { name: 'Massagem relaxante', audience: 'ambos', durationMinutes: 50, priceCents: 15_000 },
    ],
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000088', displayName: 'Carla Demo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, clock, tenantId, caller, cnv, svc }
}

async function say(s: ReturnType<typeof seedMassagem>, body: string) {
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

function appointments(s: ReturnType<typeof seedMassagem>): number {
  return s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`, s.tenantId)!.n
}

describe('conversa: cumprimento depois pedido de massagem', () => {
  it('«Oi tudo bem?» e depois «Quero agendar uma massagem» pergunta o tipo, sem eco do conjunto', async () => {
    const s = seedMassagem()
    try {
      await say(s, 'Oi tudo bem?')
      const result = await say(s, 'Quero agendar uma massagem')
      const reply = result.autoBook?.replyText ?? ''
      expect(reply).not.toMatch(/Entendi:/)
      expect(reply).toMatch(/tipos/i)
      expect(reply).toMatch(/liberação miofascial/)
      expect(reply).toMatch(/ventosaterapia/)
      expect(reply).toMatch(/drenagem linfática/)
      expect(reply).toMatch(/massagem relaxante/)
      expect(reply).not.toMatch(/Liberação miofascial/)
      expect(reply).not.toMatch(/Abrir opções/)
      const session = getScheduleSession(s.db, s.tenantId, s.cnv.id)
      expect(session?.variantIds ?? []).toEqual([])
      expect(appointments(s)).toBe(0)
    } finally {
      s.close()
    }
  })

  it('«quero tudo» com a Massagem aberta ecoa as quatro variantes', async () => {
    const s = seedMassagem()
    try {
      saveScheduleSession(s.db, s.tenantId, s.cnv.id, { serviceId: s.svc.id, phase: 'coletando' }, s.clock)
      const result = await say(s, 'quero tudo')
      const reply = result.autoBook?.replyText ?? ''
      expect(reply).toMatch(/^Entendi: /)
      expect(reply).toMatch(/Certo\?$/)
      // Eco DEC-137: nomes em minúsculas, só vírgulas (Paulo 09/11/2026).
      for (const name of MASSAGEM_NAMES) {
        expect(reply).toContain(name.toLocaleLowerCase('pt-BR'))
      }
      expect(reply).not.toMatch(/Abrir opções/)
      const session = getScheduleSession(s.db, s.tenantId, s.cnv.id)
      expect(session?.variantIds?.length).toBe(4)
      expect(appointments(s)).toBe(0)
    } finally {
      s.close()
    }
  })
})
