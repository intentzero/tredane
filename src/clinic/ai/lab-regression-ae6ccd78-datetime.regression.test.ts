/**
 * Regressão laboratório staging ae6ccd78 — parsing dia/hora (S01, S02, S06, S09a).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import {
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
import { zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { tryAiAutoBook } from './autobook'
import {
  inPeriodHHMM,
  offerNearestSlots,
  localHHMM,
} from './slot-offer'
import {
  notBeforeTimeFromText,
  parseTemporal,
  wantsNextWeekWithoutWeekday,
} from './nlu/temporal'
import { scheduleFactsFromText } from './schedule-session'

const TZ = 'America/Sao_Paulo'

function seedClinic(opts: { tenantId: string; waId: string; now: number }) {
  const clock = createControllableClock(opts.now)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = opts.tenantId
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: `b_${tenantId}`,
      phoneNumberId: 'p1',
      wabaId: 'w1',
      displayPhone: '+5511999990001',
      displayName: 'Demo',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala', category: 'Sala' }, clock)
  const pro = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Pro', homeRoomId: room.id },
    clock,
  )
  const week = [1, 2, 3, 4, 5, 6, 7].map((d) => ({
    dayOfWeek: d,
    startMinute: 9 * 60,
    endMinute: 19 * 60,
  }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: opts.waId, displayName: 'Cliente' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, clock, db, tenantId, caller, pro, room, contact, cnv }
}

describe('S01 — quinta à tarde não inclui 12:00', () => {
  it('filtro à tarde começa 13:00', () => {
    const times = ['12:00', '12:30', '13:00', '15:00']
    const tarde = times.filter((t) => inPeriodHHMM('tarde', t))
    expect(tarde).toEqual(['13:00', '15:00'])
  })
})

describe('S02 — semana que vem e antecedência', () => {
  it('não oferta hoje quando pediu semana que vem', async () => {
    const s = seedClinic({
      tenantId: 'clinic-demo-lab-s02-week',
      waId: '5511900000102w',
      now: zonedCivilToUtc(TZ, 2026, 11, 16, 11, 8),
    })
    try {
      const svc = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Avaliação estética',
          durationMinutes: 30,
          bufferMinutes: 0,
          priceCents: 0,
          variantKind: 'tipo',
          variantKindPlural: 'tipos',
          variantSelection: 'uma',
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        svc.id,
        [{ name: 'Sessão', audience: 'ambos', durationMinutes: 30, priceCents: 0 }],
        s.clock,
      )
      const text = 'oii queria marcar algo pra semana que vem'
      expect(wantsNextWeekWithoutWeekday(text)).toBe(true)
      const search = [
        '2026-11-23',
        '2026-11-24',
        '2026-11-25',
        '2026-11-26',
        '2026-11-27',
        '2026-11-28',
      ]
      const offered = await offerNearestSlots({
        db: s.db,
        tenantId: s.tenantId,
        service: { ...svc, zones: [{ name: 'Sessão', active: true } as never], active: true },
        zones: [{ name: 'Sessão', active: true } as never],
        tz: TZ,
        clock: s.clock,
        professionalId: s.pro.id,
        searchDays: search,
        date: search[0]!,
        limit: 3,
        conversationId: s.cnv.id,
      })
      expect(offered.slots.length).toBeGreaterThan(0)
      expect(offered.slots.every((x) => x.date >= '2026-11-23')).toBe(true)
      expect(offered.slots.some((x) => localHHMM(TZ, x.startsAt) === '11:15')).toBe(false)
    } finally {
      s.close()
    }
  })
})

describe('S06 — amanhã 12:30 livre', () => {
  it('preferHHMM oferece exactamente 12:30', async () => {
    const s = seedClinic({
      tenantId: 'clinic-demo-lab-s06-exact',
      waId: '5511900000106e',
      now: zonedCivilToUtc(TZ, 2026, 11, 17, 10, 0),
    })
    try {
      const svc = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Limpeza de pele profunda',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 18_000,
          variantKind: 'tipo',
          variantKindPlural: 'tipos',
          variantSelection: 'uma',
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        svc.id,
        [{ name: 'Sessão', audience: 'ambos', durationMinutes: 60, priceCents: 18_000 }],
        s.clock,
      )
      const day = '2026-11-18'
      const offered = await offerNearestSlots({
        db: s.db,
        tenantId: s.tenantId,
        service: { ...svc, zones: [{ name: 'Sessão', active: true } as never], active: true },
        zones: [{ name: 'Sessão', active: true } as never],
        tz: TZ,
        clock: s.clock,
        professionalId: s.pro.id,
        date: day,
        preferHHMM: '12:30',
        limit: 3,
        conversationId: s.cnv.id,
      })
      expect(offered.slots.some((x) => x.time === '12:30' && x.date === day)).toBe(true)
      expect(parseTemporal('amanha 12:30', { civilDate: '2026-11-17' }).times).toEqual(['12:30'])
    } finally {
      s.close()
    }
  })

  it('autobook com zona + amanhã 12:30 prepara proposta', async () => {
    const s = seedClinic({
      tenantId: 'clinic-demo-lab-s06-book',
      waId: '5511900000106f',
      now: zonedCivilToUtc(TZ, 2026, 11, 17, 10, 0),
    })
    try {
      const svc = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Limpeza de pele profunda',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 18_000,
          variantKind: 'tipo',
          variantKindPlural: 'tipos',
          variantSelection: 'uma',
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        svc.id,
        [{ name: 'Sessão', audience: 'ambos', durationMinutes: 60, priceCents: 18_000 }],
        s.clock,
      )
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'limpeza de pele profunda',
          deliveryState: 'received',
          createdAt: s.clock.nowMs() - 120_000,
        },
        s.clock,
      )
      const inbound = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'amanha 12:30',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const { loadTurnContext } = await import('./turn-context')
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
      const out = await tryAiAutoBook(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        enabled: true,
        capability: true,
        turn,
        confirmationMessageIdOverride: inbound.id,
      })
      const body = out.replyText ?? ''
      expect(body).not.toMatch(/qual horário você prefere\?$/i)
      expect(body.match(/12:30|Confirmar/i)).toBeTruthy()
    } finally {
      s.close()
    }
  })
})

describe('S09a — depois do almoço', () => {
  it('≥13:00 e «boa tarde» não é período', () => {
    expect(notBeforeTimeFromText('quinta depois do almoço')).toBe('13:00')
    expect(scheduleFactsFromText('boa tarde, botox quinta depois do almoço')).toEqual({
      period: 'tarde',
      dayLabel: 'quinta',
    })
    expect(scheduleFactsFromText('boa tarde')).toEqual({})
  })
})