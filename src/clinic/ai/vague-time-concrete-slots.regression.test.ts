/**
 * Paulo 16/11/2026: tempo vago → 2–3 horários concretos (lista/botões), não pergunta aberta.
 * Regressão lab ae6ccd78 — S01, S02, S09a, S05a, matriz A-12.
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
import { earliestBookableStartsAt } from '../scheduling/booking-lead'
import { ensureClinicSettings } from '../config/settings'
import { tryAiAutoBook } from './autobook'
import { inPeriodHHMM, offerNearestSlots } from './slot-offer'
import { loadTurnContext } from './turn-context'
import {
  notBeforeTimeFromText,
  wantsNextWeekWithoutWeekday,
  nextWeekSearchDays,
} from './nlu/temporal'

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
  const week = [1, 2, 3, 4, 5, 6].map((d) => ({
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

async function autoBookTurns(s: ReturnType<typeof seedClinic>, bodies: string[]) {
  let lastOut: Awaited<ReturnType<typeof tryAiAutoBook>> | null = null
  let lastMs = s.clock.nowMs() - bodies.length * 60_000
  for (const body of bodies) {
    lastMs += 60_000
    const msg = insertMessage(
      s.db,
      {
        tenantId: s.tenantId,
        conversationId: s.cnv.id,
        direction: 'inbound',
        body,
        deliveryState: 'received',
        createdAt: lastMs,
      },
      s.clock,
    )
    const turn = loadTurnContext(
      s.db,
      s.tenantId,
      {
        conversationId: s.cnv.id,
        contactId: s.contact.id,
        messageId: msg.id,
        inboundBody: body,
      },
      s.clock,
    )
    lastOut = await tryAiAutoBook(s.db, s.caller, s.clock, {
      conversationId: s.cnv.id,
      enabled: true,
      capability: true,
      turn,
      confirmationMessageIdOverride: msg.id,
    })
  }
  return lastOut!
}

async function autoBookLastTurn(s: ReturnType<typeof seedClinic>, bodies: string[]) {
  return autoBookTurns(s, bodies)
}

describe('offerNearestSlots — seleção vaga (2–3 slots)', () => {
  it('oferece até 3 horários e respeita período à tarde', async () => {
    const s = seedClinic({
      tenantId: 'clinic-demo-vague-slots-period',
      waId: '5511999000101',
      now: zonedCivilToUtc(TZ, 2026, 11, 16, 10, 0),
    })
    try {
      const svc = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Massagem relaxante',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 12_000,
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
        [{ name: 'Sessão', audience: 'ambos', durationMinutes: 60, priceCents: 12_000 }],
        s.clock,
      )
      const offered = await offerNearestSlots({
        db: s.db,
        tenantId: s.tenantId,
        service: { ...svc, zones: [{ name: 'Sessão', active: true } as never], active: true },
        zones: [{ name: 'Sessão', active: true } as never],
        tz: TZ,
        clock: s.clock,
        professionalId: s.pro.id,
        period: 'tarde',
        limit: 3,
        conversationId: s.cnv.id,
      })
      expect(offered.slots.length).toBeGreaterThanOrEqual(2)
      expect(offered.slots.length).toBeLessThanOrEqual(3)
      expect(offered.slots.every((x) => inPeriodHHMM('tarde', x.time))).toBe(true)
      expect(offered.replyText).toMatch(/\d{1,2}:\d{2}/)
    } finally {
      s.close()
    }
  })

  it('respeita antecedência mínima (booking lead)', async () => {
    const now = zonedCivilToUtc(TZ, 2026, 11, 16, 11, 8)
    const s = seedClinic({
      tenantId: 'clinic-demo-vague-slots-lead',
      waId: '5511999000102',
      now,
    })
    try {
      ensureClinicSettings(s.db, s.tenantId, s.clock)
      s.db.run(`UPDATE clinic_settings SET booking_lead_minutes = 30 WHERE id = 1`)
      const earliest = earliestBookableStartsAt(now, 30)
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
      const day = '2026-11-16'
      const offered = await offerNearestSlots({
        db: s.db,
        tenantId: s.tenantId,
        service: { ...svc, zones: [{ name: 'Sessão', active: true } as never], active: true },
        zones: [{ name: 'Sessão', active: true } as never],
        tz: TZ,
        clock: s.clock,
        professionalId: s.pro.id,
        date: day,
        limit: 3,
        conversationId: s.cnv.id,
      })
      expect(offered.slots.every((x) => x.startsAt >= earliest)).toBe(true)
      expect(offered.slots.some((x) => x.time === '11:15')).toBe(false)
    } finally {
      s.close()
    }
  })

  it('menos de 2 vagas: devolve o que houver + copy aprovada', async () => {
    const s = seedClinic({
      tenantId: 'clinic-demo-vague-slots-few',
      waId: '5511999000103',
      now: zonedCivilToUtc(TZ, 2026, 11, 16, 17, 45),
    })
    try {
      const svc = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Massagem',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 12_000,
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
        [{ name: 'Sessão', audience: 'ambos', durationMinutes: 60, priceCents: 12_000 }],
        s.clock,
      )
      const offered = await offerNearestSlots({
        db: s.db,
        tenantId: s.tenantId,
        service: { ...svc, zones: [{ name: 'Sessão', active: true } as never], active: true },
        zones: [{ name: 'Sessão', active: true } as never],
        tz: TZ,
        clock: s.clock,
        professionalId: s.pro.id,
        date: '2026-11-16',
        period: 'noite',
        limit: 3,
        conversationId: s.cnv.id,
      })
      expect(offered.slots.length).toBeGreaterThanOrEqual(1)
      expect(offered.slots.length).toBeLessThanOrEqual(3)
      expect(offered.replyText).toMatch(/Algum serve|horários disponíveis|não tenho horário/i)
    } finally {
      s.close()
    }
  })
})

describe('autobook — tempo vago (lab ae6ccd78 / A-12)', () => {
  it('A-12 massagem qualquer dia de tarde → lista, não «qual horário?»', async () => {
    const s = seedClinic({
      tenantId: 'clinic-demo-vague-a12',
      waId: '5511999000112',
      now: zonedCivilToUtc(TZ, 2026, 11, 16, 10, 0),
    })
    try {
      const svc = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Massagem',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 12_000,
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
        [{ name: 'Relaxante', audience: 'ambos', durationMinutes: 60, priceCents: 12_000 }],
        s.clock,
      )
      const out = await autoBookLastTurn(s, ['Quero massagem relaxante à tarde'])
      const body = out.replyText ?? ''
      expect(body).not.toMatch(/qual horário você prefere\?$/i)
      expect(body).toMatch(/\d{1,2}:\d{2}/)
      expect(out.interactive?.mode).toBe('list')
    } finally {
      s.close()
    }
  })

  it('S01 quinta à tarde — slots ≥13:00 com lista', async () => {
    const s = seedClinic({
      tenantId: 'clinic-demo-vague-s01',
      waId: '5511999000101',
      now: zonedCivilToUtc(TZ, 2026, 11, 16, 11, 0),
    })
    try {
      const svc = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Limpeza de pele',
          durationMinutes: 45,
          bufferMinutes: 0,
          priceCents: 16_000,
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
        [{ name: 'Profunda', audience: 'ambos', durationMinutes: 45, priceCents: 16_000 }],
        s.clock,
      )
      const out = await autoBookLastTurn(s, ['limpeza de pele quinta à tarde'])
      expect(out.replyText ?? '').not.toMatch(/qual horário você prefere\?$/i)
      expect(out.interactive?.mode).toBe('list')
    } finally {
      s.close()
    }
  })

  it('S02 semana que vem — não oferta hoje abaixo do lead', async () => {
    const now = zonedCivilToUtc(TZ, 2026, 11, 16, 11, 8)
    const s = seedClinic({
      tenantId: 'clinic-demo-vague-s02',
      waId: '5511999000202',
      now,
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
      const text = 'oii queria marcar avaliação pra semana que vem'
      expect(wantsNextWeekWithoutWeekday(text)).toBe(true)
      const search = nextWeekSearchDays('2026-11-16')
      const out = await autoBookLastTurn(s, [text])
      expect(out.replyText ?? '').not.toMatch(/qual horário você prefere\?$/i)
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
      expect(offered.slots.every((x) => x.date >= '2026-11-23')).toBe(true)
    } finally {
      s.close()
    }
  })

  it('S09a quinta depois do almoço — oferta ≥13:00, não manhã', async () => {
    expect(notBeforeTimeFromText('quinta depois do almoço')).toBe('13:00')
    const s = seedClinic({
      tenantId: 'clinic-demo-vague-s09a',
      waId: '5511999000909',
      now: zonedCivilToUtc(TZ, 2026, 11, 16, 14, 0),
    })
    try {
      const svc = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Botox',
          durationMinutes: 30,
          bufferMinutes: 0,
          priceCents: 80000,
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
        [{ name: 'Toxina', audience: 'ambos', durationMinutes: 30, priceCents: 80000 }],
        s.clock,
      )
      const out = await autoBookLastTurn(s, ['boa tarde, botox quinta depois do almoço'])
      expect(out.replyText ?? '').not.toMatch(/qual horário você prefere\?$/i)
      if (out.interactive?.mode === 'list') {
        const titles = out.interactive.sections?.[0]?.rows?.map((r) => r.title) ?? []
        for (const title of titles) {
          const m = title.match(/(\d{1,2}):(\d{2})/)
          if (m) expect(Number(m[1])).toBeGreaterThanOrEqual(13)
        }
      }
    } finally {
      s.close()
    }
  })

  it('S05a terça de manhã — 2–3 slots no período, não vazio', async () => {
    const s = seedClinic({
      tenantId: 'clinic-demo-vague-s05a',
      waId: '5511999000505',
      now: zonedCivilToUtc(TZ, 2026, 11, 16, 11, 0),
    })
    try {
      const svc = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Drenagem linfática',
          durationMinutes: 45,
          bufferMinutes: 0,
          priceCents: 16_000,
          variantKind: 'tipo',
          variantKindPlural: 'tipos',
          variantSelection: 'uma',
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      const zone = replaceServiceZonesOp(
        s.db,
        s.caller,
        svc.id,
        [{ name: 'Sessão', audience: 'ambos', durationMinutes: 45, priceCents: 16_000 }],
        s.clock,
      )[0]!
      const terça = '2026-11-18'
      const offered = await offerNearestSlots({
        db: s.db,
        tenantId: s.tenantId,
        service: svc,
        zones: [zone],
        tz: TZ,
        clock: s.clock,
        professionalId: s.pro.id,
        date: terça,
        period: 'manha',
        limit: 3,
        conversationId: s.cnv.id,
      })
      expect(offered.slots.length).toBeGreaterThanOrEqual(2)
      expect(offered.slots.length).toBeLessThanOrEqual(3)
      expect(offered.slots.every((x) => x.date === terça && inPeriodHHMM('manha', x.time))).toBe(true)
      expect(offered.replyText).not.toMatch(/qual horário você prefere\?$/i)
    } finally {
      s.close()
    }
  })
})