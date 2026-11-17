/**
 * Cenários R26–R47 — regressões de conversas «Avaliar» / review (texto sintético).
 * Espelham `lab/cenarios.json`; pares com correções em paralelo → `pendingOnMain` no JSON.
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
import type { ServiceRow } from '../config/types'
import { tryAiAutoBook } from './autobook'
import { clientDefersBookingChoice } from './booking-intent-text'
import {
  answerFaqFromCatalog,
  isCatalogClarificationAsk,
} from './faq-clarification'
import { turnLooksLikeDayOrTimeAsk } from './turn-friction'
import { loadTurnContext } from './turn-context'
import {
  notAfterTimeFromText,
  notBeforeTimeFromText,
  wantsMoreSlotsLaterInDay,
} from './nlu/temporal'
import { periodModelEvidence } from './interpreter-fallback'
import { planCatalogConsult } from './catalog-consult'
import { listServices } from '../config/services'
import { offerNearestSlots } from './slot-offer'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import { buildSlotChoiceInteractive, toSendInteractive } from './choice-offer'
import {
  afterHoursHumanRequestBody,
  augmentOutboundWithHumanTeam,
  replyAfterHoursHumanRequest,
} from './human-handoff'
import { planIdleContinueResume } from '../followup/idle-continue-resume'
import { saveBookingFrame, type BookingFrame } from './schedule-session'
import {
  PROPOSAL_CONFIRM_NUDGE_LEAD,
  sendProposalConfirmNudgeOp,
} from '../proposals/text-confirm-nudge'
import { createProposal, markProposalSent } from '../proposals'

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
      displayName: 'Clínica Estética Aurora',
      action: 'channel_connected',
    },
    clock,
  )
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Luiza' }, clock)
  const week = [1, 2, 3, 4, 5, 6].map((d) => ({
    dayOfWeek: d,
    startMinute: 9 * 60,
    endMinute: 18 * 60,
  }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(
    db,
    { tenantId, waId: opts.waId, displayName: 'Cliente' },
    clock,
  )
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, clock, db, tenantId, caller, pro, contact, cnv }
}

function depilacaoService(
  s: ReturnType<typeof seedClinic>,
): ServiceRow {
  const depi = upsertServiceOp(
    s.db,
    s.caller,
    {
      name: 'Depilação',
      durationMinutes: 15,
      bufferMinutes: 0,
      priceCents: null,
      variantKind: 'zona',
      variantKindPlural: 'zonas',
      variantSelection: 'varias',
      professionalIds: [s.pro.id],
      roomRequirement: { mode: 'none' },
      clientExplanation: 'Remoção de pelos com cera em zonas escolhidas.',
    },
    s.clock,
  )
  const zones = replaceServiceZonesOp(
    s.db,
    s.caller,
    depi.id,
    [
      {
        name: 'Intima',
        audience: 'feminino',
        durationMinutes: 20,
        priceCents: 18_000,
        clientExplanation: 'Inclui virilha e região íntima feminina.',
      },
      {
        name: 'Axila',
        audience: 'feminino',
        durationMinutes: 15,
        priceCents: 5_000,
      },
    ],
    s.clock,
  )
  return { ...depi, zones }
}

async function autoBookTurn(
  s: ReturnType<typeof seedClinic>,
  body: string,
  at?: number,
) {
  const inbound = insertMessage(
    s.db,
    {
      tenantId: s.tenantId,
      conversationId: s.cnv.id,
      direction: 'inbound',
      body,
      deliveryState: 'received',
      createdAt: at ?? s.clock.nowMs() + 1,
    },
    s.clock,
  )
  const turn = loadTurnContext(
    s.db,
    s.tenantId,
    {
      conversationId: s.cnv.id,
      contactId: s.cnv.contactId,
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
  })
}

describe('R26/R27 — filtro «depois das X» (manhã)', () => {
  const NOW = Date.UTC(2026, 10, 16, 14, 0) // seg 11:00 SP

  it('R26: «depois das 10» → primeiro 10:15, 10:00 excluído', async () => {
    expect(notBeforeTimeFromText('Depois das 10 tem algum horário?')).toBe('10:00')
    const s = seedClinic({
      tenantId: 'clinic-demo-r26',
      waId: '5511900000126',
      now: NOW,
    })
    try {
      const svc = depilacaoService(s)
      const tomorrow = clinicCivilDateFromUtc(TZ, NOW + 86_400_000)
      const offered = await offerNearestSlots({
        db: s.db,
        tenantId: s.tenantId,
        service: { ...svc, active: true },
        zones: svc.zones,
        tz: TZ,
        clock: s.clock,
        professionalId: s.pro.id,
        date: tomorrow,
        period: 'manha',
        notBeforeHHMM: '10:00',
        limit: 6,
        conversationId: s.cnv.id,
      })
      const times = offered.slots.map((x) => x.time)
      expect(times).toEqual(['10:15', '10:45', '11:15', '11:45'])
      expect(times[0]).toBe('10:15')
      expect(times.includes('10:00')).toBe(false)
    } finally {
      s.close()
    }
  })

  it('R27: «depois das 11» → primeiro 11:15, 11:00 excluído (manhã ainda tem vagas)', async () => {
    expect(notBeforeTimeFromText('Depois das 11?')).toBe('11:00')
    const s = seedClinic({
      tenantId: 'clinic-demo-r27',
      waId: '5511900000127',
      now: NOW,
    })
    try {
      const svc = depilacaoService(s)
      const tomorrow = clinicCivilDateFromUtc(TZ, NOW + 86_400_000)
      const offered = await offerNearestSlots({
        db: s.db,
        tenantId: s.tenantId,
        service: { ...svc, active: true },
        zones: svc.zones,
        tz: TZ,
        clock: s.clock,
        professionalId: s.pro.id,
        date: tomorrow,
        period: 'manha',
        notBeforeHHMM: '11:00',
        limit: 6,
        conversationId: s.cnv.id,
      })
      const times = offered.slots.map((x) => x.time)
      expect(times).toEqual(['11:15', '11:45'])
      expect(times[0]).toBe('11:15')
      expect(times.includes('11:00')).toBe(false)
      expect(offered.replyText).not.toMatch(/manhã.*sem.*horário/i)
      expect(offered.replyText).not.toMatch(/não tenho horário livre/i)
    } finally {
      s.close()
    }
  })
})

describe('R28/R29 — FAQ depilação íntima (sintético)', () => {
  const intima = {
    id: 'z_i',
    tenantId: 't',
    serviceId: 's',
    name: 'Intima',
    audience: 'feminino' as const,
    durationMinutes: 20,
    priceCents: 18_000,
    active: true,
    sortOrder: 0,
    synonyms: [] as string[],
    clientExplanation: 'Inclui virilha e região íntima feminina.',
  }
  const service = {
    id: 's',
    name: 'Depilação íntima',
    clientExplanation: 'Remoção de pelos na zona íntima.',
    zones: [intima],
    synonyms: [],
    variantSelection: 'varias',
  } as unknown as ServiceRow

  it('R28: «O que inclui a depilação íntima?»', () => {
    expect(isCatalogClarificationAsk('O que inclui a depilação íntima?')).toBe(true)
    const r = answerFaqFromCatalog({
      text: 'O que inclui a depilação íntima?',
      conversationId: 'cnv_r28',
      service,
      zones: [intima],
    })
    expect(r.kind).not.toBe('missing')
    if (r.kind === 'explanation' || r.kind === 'covered') {
      expect(r.replyText).toMatch(/virilha|íntima/i)
      expect(r.replyText).not.toMatch(/Sim — no cadastro/)
      expect(r.replyText).not.toMatch(/depilacao/i)
    }
  })

  it('R29: «O que é a depilação íntima?» (controle positivo)', () => {
    const r = answerFaqFromCatalog({
      text: 'O que é a depilação íntima?',
      conversationId: 'cnv_r29',
      service,
      zones: [intima],
    })
    expect(r.kind).toBe('explanation')
    if (r.kind === 'explanation') {
      expect(r.replyText).toMatch(/íntima|virilha/i)
      expect(r.replyText).not.toMatch(/Sim — no cadastro/)
    }
  })
})

describe('R30 — typo «Íntima incluinnariz?»', () => {
  const NOW = Date.UTC(2026, 10, 16, 14, 0)

  it('R30: typo «incluinnariz» → detalhe de nariz em falta (sem «Não peguei bem»)', async () => {
    const s = seedClinic({
      tenantId: 'clinic-demo-r30',
      waId: '5511900000130',
      now: NOW,
    })
    try {
      depilacaoService(s)
      await autoBookTurn(s, 'depilação feminina amanhã')
      const out = await autoBookTurn(s, 'Íntima incluinnariz?')
      expect(out.replyText).not.toMatch(/Não peguei bem/i)
      expect(out.replyText).toBe(
        'Não tenho esse detalhe no cadastro; a equipe confirma.',
      )
    } finally {
      s.close()
    }
  })
})

describe('R31–R36 — regressões #868 / #869 (cnv_b8df6c5, sintético)', () => {
  const NOW = Date.UTC(2026, 10, 16, 21, 30)
  const CLOSED = Date.UTC(2026, 10, 7, 20, 0)

  it('R31: «A íntima inclui o quê?» é FAQ (#868 item 1)', () => {
    expect(isCatalogClarificationAsk('A íntima inclui o quê?')).toBe(true)
  })

  it('R32: fora de horas pedido humano reoferece funil (#868 item 2)', () => {
    const s = seedClinic({
      tenantId: 'clinic-demo-r32',
      waId: '5511900000132',
      now: CLOSED,
    })
    try {
      const svc = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Depilação',
          durationMinutes: 15,
          bufferMinutes: 15,
          priceCents: 5000,
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'tem horário terça?',
          deliveryState: 'received',
          createdAt: CLOSED - 60_000,
        },
        s.clock,
      )
      const offerAt = s.clock.nowMs() - 120_000
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: svc.id,
          catalogVersion: 'cv_r32',
          pending: {
            slot: 'horario',
            messageId: 'msg_slots_r32',
            options: [{ key: '2026-11-17T14:00', label: 'terça 17/11 14:00' }],
          },
        },
        s.clock,
      )
      s.db.run(
        `INSERT INTO messages (id, tenant_id, conversation_id, direction, body, delivery_state, created_at)
         VALUES ('msg_slots_r32', ?, ?, 'outbound', ?, 'delivered', ?)`,
        s.tenantId,
        s.cnv.id,
        'Terça 17/11 às 14:00?',
        offerAt,
      )
      const reply = replyAfterHoursHumanRequest(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, clientRequestId: 'lab-r32' },
        s.clock,
      )
      const sends = reply.outbox.filter((o) => o.type === 'whatsapp.send')
      expect(sends.length).toBeGreaterThanOrEqual(2)
      const bodies = sends
        .map((o) => {
          const p = JSON.parse((o as { payloadJson: string }).payloadJson) as { body?: string }
          return p.body ?? ''
        })
        .join('\n')
      expect(bodies).toMatch(/equipe/i)
      expect(bodies).toMatch(/14:00|Retomando|paramos/i)
    } finally {
      s.close()
    }
  })

  it('R34: idle «continuar» reoferece proposta (#868 item 4)', () => {
    const s = seedClinic({
      tenantId: 'clinic-demo-r34',
      waId: '5511900000134',
      now: NOW,
    })
    try {
      const svc = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Depilação a laser',
          durationMinutes: 15,
          bufferMinutes: 0,
          priceCents: 8000,
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
          serviceId: svc.id,
          catalogVersion: 'cv_r34',
          pending: {
            slot: 'horario',
            messageId: 'msg_slots_fresh_r34',
            options: [{ key: '2026-11-17T15:00', label: '15:00' }],
          },
        },
        s.clock,
      )
      const startsAt = zonedCivilToUtc(TZ, 2026, 11, 17, 14, 0)
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: svc.id,
          professionalId: s.pro.id,
          startsAt,
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
      const plan = planIdleContinueResume(s.db, s.tenantId, s.cnv.id, s.clock)
      expect(plan.mode).toBe('reoffer_proposal')
    } finally {
      s.close()
    }
  })

  it('R33: «Quais horas» com choose_slot pendente → lista (#868 item 3)', async () => {
    const s = seedClinic({
      tenantId: 'clinic-demo-r33',
      waId: '5511900000133',
      now: NOW,
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
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      expect(turnLooksLikeDayOrTimeAsk('Quais horas')).toBe(true)
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: svc.id,
          catalogVersion: 'cv_r33',
          date: '2026-11-17',
          pending: {
            slot: 'horario',
            messageId: 'msg_slot_r33',
            options: [
              { key: '2026-11-17T14:00', label: 'terça 17/11 14:00' },
              { key: '2026-11-17T14:30', label: 'terça 17/11 14:30' },
            ],
          },
          phase: 'ofertado',
        },
        s.clock,
      )
      s.db.run(
        `INSERT INTO messages (id, tenant_id, conversation_id, direction, body, delivery_state, created_at)
         VALUES ('msg_slot_r33', ?, ?, 'outbound', ?, 'delivered', ?)`,
        s.tenantId,
        s.cnv.id,
        'Horários terça',
        s.clock.nowMs() - 60_000,
      )
      const out = await autoBookTurn(s, 'Quais horas tem?')
      expect(out.replyText).not.toMatch(/Não peguei bem/i)
      expect(out.interactive?.mode).toBe('list')
    } finally {
      s.close()
    }
  })

  it('R35: nudge confirmar inclui corpo da proposta (#868 item 5)', () => {
    const s = seedClinic({
      tenantId: 'clinic-demo-r35',
      waId: '5511900000135',
      now: NOW,
    })
    try {
      const room = upsertResourceOp(
        s.db,
        s.caller,
        { kind: 'room', name: 'Sala 1', category: 'Sala' },
        s.clock,
      )
      setWeeklyWindowsOp(
        s.db,
        s.caller,
        { resourceId: room.id, windows: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1140 }] },
        s.clock,
      )
      const svc = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Drenagem linfática',
          durationMinutes: 45,
          bufferMinutes: 0,
          priceCents: 16_000,
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
        },
        s.clock,
      )
      const startsAt = zonedCivilToUtc(TZ, 2026, 11, 17, 15, 15)
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: svc.id,
          professionalId: s.pro.id,
          startsAt,
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'sim',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const nudge = sendProposalConfirmNudgeOp(
        s.db,
        s.caller,
        {
          proposal,
          conversationId: s.cnv.id,
          clientRequestId: 'lab-r35-nudge',
        },
        s.clock,
      )
      expect(nudge.status).toBe('queued')
      if (nudge.status === 'queued') {
        expect(nudge.lead).toContain(PROPOSAL_CONFIRM_NUDGE_LEAD)
        expect(nudge.lead).toMatch(/Drenagem|15:15|15h15/i)
      }
    } finally {
      s.close()
    }
  })

  it('R47: «depois das 11» não vira período de fallback (R27 invariável)', () => {
    expect(periodModelEvidence('Depois das 11?', 'manha')).toBe(false)
    expect(notBeforeTimeFromText('Depois das 11?')).toBe('11:00')
  })

  it('R36: lista de horários «Falar com a equipe» numa só secção (#868/#869)', () => {
    const s = seedClinic({
      tenantId: 'clinic-demo-r36',
      waId: '5511900000136',
      now: NOW,
    })
    try {
      const slots = [
        { key: '2026-11-17T10:00', label: 'terça 17/11 10:00' },
        { key: '2026-11-17T10:30', label: 'terça 17/11 10:30' },
      ]
      const built = buildSlotChoiceInteractive({
        catalogVersion: 'cv_r36',
        slots,
      })
      const aug = augmentOutboundWithHumanTeam(s.db, s.tenantId, s.clock, {
        body: 'Horários',
        interactive: toSendInteractive(built.interactive),
      })
      const list = aug.interactive!.list!
      expect(list.sections.length).toBe(1)
      const titles = list.sections.flatMap((sec) => sec.rows.map((r) => r.title))
      expect(titles).toContain('Falar com a equipe')
      expect(list.sections[0]?.title).toBeUndefined()
    } finally {
      s.close()
    }
  })
})

describe('R37–R41 — rsamp_f72ce590 seq 59–99 (sintético)', () => {
  const NOW = Date.UTC(2026, 10, 17, 14, 0)

  it('R37: «Mais tarde tem horário?» activa refinamento no mesmo dia', () => {
    expect(wantsMoreSlotsLaterInDay('Mais tarde tem horário?')).toBe(true)
    expect(wantsMoreSlotsLaterInDay('Tem horário à tarde?')).toBe(false)
  })

  it('R39: «antes das 11» → onlyAtOrBefore exclui 11:00 e posteriores', async () => {
    expect(notAfterTimeFromText('E antes das 11?')).toBe('11:00')
    const s = seedClinic({
      tenantId: 'clinic-demo-r39',
      waId: '5511900000139',
      now: NOW,
    })
    try {
      const svc = depilacaoService(s)
      const today = clinicCivilDateFromUtc(TZ, NOW)
      const offered = await offerNearestSlots({
        db: s.db,
        tenantId: s.tenantId,
        service: { ...svc, active: true },
        zones: svc.zones,
        tz: TZ,
        clock: s.clock,
        professionalId: s.pro.id,
        date: today,
        period: 'manha',
        onlyAtOrBeforeHHMM: '11:00',
        limit: 6,
        conversationId: s.cnv.id,
      })
      const times = offered.slots.map((x) => x.time)
      expect(times.every((t) => t < '11:00')).toBe(true)
      expect(times.includes('11:00')).toBe(false)
    } finally {
      s.close()
    }
  })

  it('R40: «Quais serviços oferece?» plano inclui lista interativa', () => {
    const s = seedClinic({
      tenantId: 'clinic-demo-r40',
      waId: '5511900000140',
      now: NOW,
    })
    try {
      const svc = depilacaoService(s)
      upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Drenagem linfática',
          durationMinutes: 45,
          bufferMinutes: 0,
          priceCents: 18_000,
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      const services = listServices(s.db, s.tenantId)
      const planned = planCatalogConsult({
        text: 'Quais serviços oferece?',
        frame: {
          line: 'masculino',
          serviceId: svc.id,
          variantIds: [],
          phase: 'coletando',
        } as unknown as BookingFrame,
        services,
        catalogVersion: 'cv_r40',
        hasActiveProposal: false,
      })
      expect(planned).not.toBeNull()
      expect(planned!.interactive).toBeTruthy()
      expect(planned!.body).toMatch(/Qual você quer/i)
    } finally {
      s.close()
    }
  })

  it('R60: preço «antes de marcar» sem empurrar horário (P21)', () => {
    expect(clientDefersBookingChoice('mas qual o valor da drenagem? antes de marcar')).toBe(true)
  })

  it('R41: handoff fora de horas — uma frase e «hoje às» na terça de manhã', () => {
    const closed = Date.UTC(2026, 10, 17, 11, 12)
    const s = seedClinic({
      tenantId: 'clinic-demo-r41',
      waId: '5511900000141',
      now: closed,
    })
    try {
      const body = afterHoursHumanRequestBody(s.db, s.tenantId, s.clock, s.cnv.id)
      expect(body.split('\n\n').length).toBe(1)
      expect(body).toMatch(/hoje às 09:00/i)
      expect(body).not.toMatch(/terça às 09:00/i)
    } finally {
      s.close()
    }
  })
})