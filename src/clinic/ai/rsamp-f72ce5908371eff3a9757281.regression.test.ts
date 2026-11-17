/**
 * Staging rsamp_f72ce5908371eff3a9757281 — seq 70–99 (17/11/2026).
 * «depois das X», FAQ «o que inclui», typo «incluinnariz».
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import {
  replaceServiceZonesOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { listServices } from '../config/services'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { offerNearestSlots } from './slot-offer'
import { notAfterTimeFromText, notBeforeTimeFromText } from './nlu/temporal'
import { tryAiAutoBook } from './autobook'
import { afterHoursHumanRequestBody } from './human-handoff'
import { zonedCivilToUtc } from '../scheduling/timezone'
import { handleAlterDetailsChoice, ALTER_HORARIO_KEY } from './alter-details'
import { upcomingPrefixAlreadyShown } from './contact-appointment-hint'
import { loadTurnContext } from './turn-context'
import { insertMessage } from '../inbox/messages'
import { getBookingFrame, saveBookingFrame } from './schedule-session'

const TZ = 'America/Sao_Paulo'
/** Qui 19/11/2026 10:00 SP — sexta 20/11 no futuro próximo */
const NOW = Date.UTC(2026, 10, 19, 13, 0)

function seedDepiFriday() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-rsamp-f72ce590'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'b_rsamp_f72',
      phoneNumberId: 'p_rsamp',
      wabaId: 'w_rsamp',
      displayPhone: '+5511999005500',
      displayName: 'Clínica',
      action: 'channel_connected',
    },
    clock,
  )
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Luiza' }, clock)
  const depi = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 15,
      bufferMinutes: 0,
      priceCents: null,
      variantKind: 'zona',
      variantKindPlural: 'zonas',
      variantSelection: 'varias',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
      clientExplanation:
        'Depilação íntima com cera nas regiões íntimas, virilha e períneo (dados fictícios).',
    },
    clock,
  )
  replaceServiceZonesOp(
    db,
    caller,
    depi.id,
    [
      { name: 'Pernas', audience: 'masculino', durationMinutes: 35, priceCents: 14_000 },
      { name: 'Costas', audience: 'masculino', durationMinutes: 25, priceCents: 11_000 },
      {
        name: 'Íntima',
        audience: 'masculino',
        durationMinutes: 20,
        priceCents: 18_000,
        clientExplanation: 'Inclui virilha e ânus.',
      },
    ],
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: pro.id,
      windows: [1, 2, 3, 4, 5, 6].map((d) => ({
        dayOfWeek: d,
        startMinute: 9 * 60,
        endMinute: 18 * 60,
      })),
    },
    clock,
  )
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511999005501', displayName: 'Paulo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  const friday = '2026-11-20'
  const depiLoaded = listServices(db, tenantId).find((s) => s.id === depi.id)!
  const zones = depiLoaded.zones.filter((z) => z.active)
  return { ...boot, clock, db, tenantId, caller, depi: depiLoaded, pro, cnv, contact, friday, zones }
}

async function autoBookTurn(
  s: ReturnType<typeof seedDepiFriday>,
  body: string,
): Promise<Awaited<ReturnType<typeof tryAiAutoBook>>> {
  const inbound = insertMessage(
    s.db,
    {
      tenantId: s.tenantId,
      conversationId: s.cnv.id,
      direction: 'inbound',
      body,
      deliveryState: 'received',
      createdAt: s.clock.nowMs() + 1,
    },
    s.clock,
  )
  const turn = loadTurnContext(
    s.db,
    s.tenantId,
    {
      conversationId: s.cnv.id,
      contactId: s.contact.id,
      messageId: inbound.id,
      inboundBody: inbound.body,
    },
    s.clock,
  )
  return tryAiAutoBook(s.db, s.caller, s.clock, {
    conversationId: s.cnv.id,
    enabled: true,
    capability: true,
    turn,
    confirmationMessageIdOverride: inbound.id,
    turnTextOverride: body,
  })
}

async function autoBookBody(
  s: ReturnType<typeof seedDepiFriday>,
  body: string,
): Promise<string> {
  const booked = await autoBookTurn(s, body)
  return booked.replyText ?? ''
}

describe('rsamp_f72ce590 — «depois das X» (horários)', () => {
  it('«depois das 10» exclui 10:00 (só 10:30)', async () => {
    expect(notBeforeTimeFromText('Depois das 10 tem algum horário?')).toBe('10:00')
    const s = seedDepiFriday()
    const intima = s.zones.find((z) => z.name === 'Íntima')!
    try {
      const offered = await offerNearestSlots({
        db: s.db,
        tenantId: s.tenantId,
        service: { ...s.depi, zones: [intima] },
        zones: [intima],
        tz: TZ,
        clock: s.clock,
        professionalId: s.pro.id,
        date: s.friday,
        period: 'manha',
        notBeforeHHMM: '10:00',
        conversationId: s.cnv.id,
        limit: 5,
      })
      expect(offered.slots.length).toBeGreaterThan(0)
      expect(offered.slots.map((x) => x.time)).not.toContain('10:00')
      expect(offered.slots.every((x) => x.time > '10:00')).toBe(true)
    } finally {
      s.close()
    }
  })

  it('«depois das 11:45» sem vaga de manhã: tarde + alternativa matinal (zona curta)', async () => {
    const s = seedDepiFriday()
    const intima = s.zones.find((z) => z.name === 'Íntima')!
    try {
      const offered = await offerNearestSlots({
        db: s.db,
        tenantId: s.tenantId,
        service: { ...s.depi, zones: [intima] },
        zones: [intima],
        tz: TZ,
        clock: s.clock,
        professionalId: s.pro.id,
        date: s.friday,
        period: 'manha',
        notBeforeHHMM: '11:45',
        conversationId: s.cnv.id,
        limit: 3,
      })
      expect(notBeforeTimeFromText('Depois das 11?')).toBe('11:00')
      expect(offered.replyText).toMatch(/Depois das 11:45 de manhã não tenho horário livre/i)
      expect(offered.replyText).toMatch(/mais perto de manhã é (?:10:30|11:00|11:30)/i)
      expect(offered.replyText).toMatch(/13:00/)
      expect(offered.slots.map((x) => x.time)).not.toContain('11:45')
      expect(offered.slots.map((x) => x.time)).toEqual(
        expect.arrayContaining(['11:30', '13:00']),
      )
    } finally {
      s.close()
    }
  })
})

describe('rsamp_f72ce590 — FAQ íntima', () => {
  it('«O que inclui a depilação íntima?» devolve explicação do serviço', async () => {
    const s = seedDepiFriday()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.depi.id,
          line: 'masculino',
          phase: 'coletando',
          variantIds: s.zones.map((z) => z.id),
        },
        s.clock,
      )
      const reply = await autoBookBody(s, 'O que inclui a depilação íntima?')
      expect(reply).toMatch(/virilha|períneo|cera/i)
      expect(reply).not.toMatch(/faz parte de íntima/i)
      expect(reply).not.toMatch(/\bdepilacao\b/i)
    } finally {
      s.close()
    }
  })

  it('«Íntima incluinnariz?» entende inclusão (nariz → missing determinístico)', async () => {
    const s = seedDepiFriday()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.depi.id,
          line: 'masculino',
          phase: 'coletando',
          variantIds: [s.zones[2]!.id],
        },
        s.clock,
      )
      const reply = await autoBookBody(s, 'Íntima incluinnariz?')
      expect(reply).not.toMatch(/Não peguei bem/i)
      expect(reply).toMatch(/não tenho esse detalhe|equipe confirma/i)
    } finally {
      s.close()
    }
  })
})

describe('rsamp_f72ce590 — seq 59–99 (17/11/2026)', () => {
  it('R37: «Mais tarde tem horário?» oferece após o último slot da lista (quinta tarde)', async () => {
    const s = seedDepiFriday()
    const thursday = '2026-11-19'
    const intima = s.zones.find((z) => z.name === 'Íntima')!
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.depi.id,
          line: 'masculino',
          variantIds: [intima.id],
          date: thursday,
          period: 'tarde',
          phase: 'ofertado',
          pending: {
            slot: 'horario',
            messageId: 'msg-offer',
            options: [
              { key: `${thursday}T13:00`, label: '13:00' },
              { key: `${thursday}T13:30`, label: '13:30' },
              { key: `${thursday}T14:00`, label: '14:00' },
            ],
          },
          lastOffer: {
            messageId: 'msg-offer',
            slots: [
              { startsAt: zonedCivilToUtc(TZ, 2026, 10, 19, 13, 0), professionalId: s.pro.id },
              { startsAt: zonedCivilToUtc(TZ, 2026, 10, 19, 13, 30), professionalId: s.pro.id },
              { startsAt: zonedCivilToUtc(TZ, 2026, 10, 19, 14, 0), professionalId: s.pro.id },
            ],
          },
        },
        s.clock,
      )
      const out = await autoBookTurn(s, 'Mais tarde tem horário?')
      expect(out.replyText).not.toMatch(/qual horário você prefere\?$/i)
      expect(out.interactive).not.toBeNull()
      const serialized = JSON.stringify(out.interactive)
      expect(serialized).toMatch(/14:15|14:30|14:45|15:00|15:15/)
      expect(serialized).not.toMatch(/13:00|13:30|"14:00"/)
    } finally {
      s.close()
    }
  })

  it('R38: Alterar detalhes → Horário mantém o dia da proposta', async () => {
    const s = seedDepiFriday()
    s.clock.set(Date.UTC(2026, 10, 17, 13, 0))
    const proposalDay = '2026-11-19'
    const intima = s.zones.find((z) => z.name === 'Íntima')!
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.depi.id,
          line: 'masculino',
          variantIds: [intima.id],
          date: proposalDay,
          time: '14:00',
          phase: 'proposto',
        },
        s.clock,
      )
      const result = await handleAlterDetailsChoice(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          key: ALTER_HORARIO_KEY,
          capability: true,
        },
        s.clock,
      )
      expect(result.autoBook?.interactive).toBeTruthy()
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.date).toBe(proposalDay)
      const combined = `${result.autoBook?.replyText ?? ''}${JSON.stringify(result.autoBook?.interactive)}`
      expect(combined).not.toMatch(/\bhoje\b/i)
      expect(combined).toMatch(/quinta|19\/11|14:30|15:00/)
    } finally {
      s.close()
    }
  })

  it('R39: «E antes das 11?» filtra manhã no dia do quadro', async () => {
    const s = seedDepiFriday()
    const intima = s.zones.find((z) => z.name === 'Íntima')!
    expect(notAfterTimeFromText('E antes das 11?')).toBe('11:00')
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.depi.id,
          line: 'masculino',
          variantIds: [intima.id],
          date: '2026-11-19',
          phase: 'ofertado',
          pending: {
            slot: 'horario',
            messageId: 'msg-h',
            options: [{ key: '2026-11-19T10:00', label: '10:00' }],
          },
        },
        s.clock,
      )
      const out = await autoBookTurn(s, 'E antes das 11?')
      expect(out.replyText).not.toMatch(/Não encontrei antes/i)
      expect(`${out.replyText}${JSON.stringify(out.interactive)}`).toMatch(/09:00|09:30|10:00|10:30/)
    } finally {
      s.close()
    }
  })

  it('R40: «Quais serviços oferece?» com linha masculina → lista interativa', async () => {
    const s = seedDepiFriday()
    try {
      upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Depilação a laser',
          durationMinutes: 30,
          bufferMinutes: 0,
          priceCents: 12_000,
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.depi.id,
          line: 'masculino',
          variantIds: [s.zones[0]!.id],
          phase: 'coletando',
        },
        s.clock,
      )
      const out = await autoBookTurn(s, 'Quais serviços oferece?')
      expect(out.interactive).toBeTruthy()
      expect(out.replyText).toMatch(/Qual você quer/i)
      const serialized = JSON.stringify(out.interactive ?? {})
      expect(serialized).toMatch(/Depilação/i)
      expect(serialized).toMatch(/buttons|list/)
    } finally {
      s.close()
    }
  })

  it('R41: handoff fora de horas — uma frase + «hoje às» quando abre no mesmo dia', () => {
    const s = seedDepiFriday()
    s.clock.set(Date.UTC(2026, 10, 17, 11, 12))
    try {
      const body = afterHoursHumanRequestBody(s.db, s.tenantId, s.clock, s.cnv.id)
      expect(body.split('\n\n').length).toBe(1)
      expect(body).toMatch(/hoje às 09:00/i)
      expect(body).not.toMatch(/terça às 09:00/i)
    } finally {
      s.close()
    }
  })

  it('R41b: lembrete «Você já tem…» só uma vez por conversa', async () => {
    const s = seedDepiFriday()
    try {
      const starts = zonedCivilToUtc(TZ, 2026, 10, 20, 11, 0)
      s.db.run(
        `INSERT INTO appointments (id, tenant_id, service_id, professional_id, starts_at, ends_at, status, created_at, contact_id, confirmed_by)
         VALUES ('apt_rsamp_f72_prefix', ?, ?, ?, ?, ?, 'confirmed', ?, ?, 'system:proposal-send')`,
        s.tenantId,
        s.depi.id,
        s.pro.id,
        starts,
        starts + 20 * 60_000,
        s.clock.nowMs(),
        s.contact.id,
      )
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'outbound',
          body: 'Você já tem Depilação na sexta às 11:00. É para outro horário ou serviço?\n\n',
          deliveryState: 'delivered',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      expect(upcomingPrefixAlreadyShown(s.db, s.tenantId, s.cnv.id)).toBe(true)
    } finally {
      s.close()
    }
  })
})