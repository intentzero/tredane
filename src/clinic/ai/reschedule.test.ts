/**
 * DEC-091 / REQ-101 + DEC-129: remarcação sem reiniciar zonas; frases fixas sem marcador.
 */
import { describe, expect, it } from 'vitest'
import { claimsBooking } from '../../ai/reply-facts'
import { SimulatedAiAdapter } from '../../ai'
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
import { handleProposalButtonClick } from '../proposals/buttons'
import { executeProposalConfirmOp } from '../proposals/execute-confirm'
import { getProposal } from '../proposals/proposals'
import { proposalButtonId } from '../proposals/render'
import { confirmAppointmentOp, zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { HUMAN_HANDOFF_TEXT, readAiReplyPause } from './human-handoff'
import { forbiddenClientTermsIn } from './client-copy'
import { validateClientOutbound } from './outbound-validate'
import { SLOT_LIST_BUTTON_LABEL } from './choice-offer'
import { getBookingFrame, saveBookingFrame } from './schedule-session'
import {
  isRescheduleIntent,
  phraseAskDay,
  phraseDayFull,
  phraseOfferSlots,
  phraseOwnerPaused,
  phraseSendFailed,
  phraseTimeTaken,
  tryAiReschedule,
} from './reschedule'
import { DEFAULT_ABUSE_LIMITS } from './abuse-limits'

const TZ = 'America/Sao_Paulo'
// Sexta 30/10/2026 14:40 em São Paulo (dentro do expediente Mon–Sex 09–18).
// 31/10/2026 é sábado — fora do expediente → DEC-113 acrescenta a próxima abertura.
const NOW = Date.UTC(2026, 9, 30, 17, 40)

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_reschedule',
      phoneNumberId: 'pn_reschedule',
      wabaId: 'waba_reschedule',
      displayPhone: '+5511900000088',
      displayName: 'Clínica Reschedule',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala Depilação', category: 'Sala' }, clock)
  const gi = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Gi', homeRoomId: room.id },
    clock,
  )
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 30,
      bufferMinutes: 15,
      priceCents: 8000,
      variantKind: 'zona',
      variantKindPlural: 'zonas',
      professionalIds: [gi.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  const zones = replaceServiceZonesOp(
    db,
    caller,
    svc.id,
    [
      { name: 'Axila', durationMinutes: 15, priceCents: 4000, audience: 'feminino' },
      { name: 'Pernas', durationMinutes: 30, priceCents: 9000, audience: 'feminino' },
    ],
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1080 }))
  setWeeklyWindowsOp(db, caller, { resourceId: gi.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000088', displayName: 'Paulo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)

  const tue10 = zonedCivilToUtc(TZ, 2026, 11, 3, 10, 0)
  const booked = confirmAppointmentOp(
    db,
    caller,
    {
      clientRequestId: 'seed-apt-tue',
      serviceId: svc.id,
      professionalId: gi.id,
      startsAt: tue10,
      contactId: contact.id,
      conversationId: cnv.id,
      actorClerkUserId: caller.actorId!,
      zoneIds: zones.map((z) => z.id),
    },
    clock,
  )

  let t = NOW - 120_000
  const say = (direction: 'inbound' | 'outbound', body: string) => {
    t = Math.max(t, clock.nowMs() + 1)
    const m = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction,
        body,
        deliveryState: direction === 'inbound' ? 'received' : 'delivered',
        createdAt: t,
      },
      clock,
    )
    t += 60_000
    return m
  }
  const run = async (opts: { autoBookPaused?: boolean } = {}) => {
    const last = db.get<{ id: string }>(
      `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
      cnv.id,
    )!
    enqueueAutoDraft(db, tenantId, { conversationId: cnv.id, messageId: last.id }, clock)
    clock.advance(7_000)
    const out = await runDueAutoDrafts(db, caller, clock, {
      mode: 'synthetic',
      adapter: new SimulatedAiAdapter(),
      ...(opts.autoBookPaused ? { autoBookPaused: true } : {}),
    })
    expect(out).toHaveLength(1)
    return out[0]!
  }
  const lastOutbound = () =>
    db.get<{ body: string }>(
      `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
      cnv.id,
    )?.body ?? ''

  return {
    ...boot,
    clock,
    caller,
    tenantId,
    gi,
    svc,
    zones,
    cnv,
    contact,
    aptId: booked.value.id,
    say,
    run,
    lastOutbound,
  }
}

function assertSafeClientCopy(text: string) {
  expect(claimsBooking(text)).toBe(false)
  expect(forbiddenClientTermsIn(text)).toEqual([])
  expect(validateClientOutbound(text, { source: 'phrase', requireSingleQuestion: false }).ok).toBe(true)
  expect(text).not.toMatch(/Para remarcar o mesmo atendimento/)
  expect(text).not.toMatch(/\bPaulo\b/)
}

describe('isRescheduleIntent', () => {
  it('reconhece reagendar e soft «posso … para quarta»', () => {
    expect(isRescheduleIntent('Posso reagendar para quarta?', { hasUpcoming: true, priorOffer: false })).toBe(
      true,
    )
    expect(isRescheduleIntent('Posso para quarta?', { hasUpcoming: true, priorOffer: false })).toBe(true)
    expect(isRescheduleIntent('Quero marcar para quarta', { hasUpcoming: true, priorOffer: false })).toBe(false)
    expect(isRescheduleIntent('Quero cancelar', { hasUpcoming: true, priorOffer: false })).toBe(false)
    expect(isRescheduleIntent('14h', { hasUpcoming: true, priorOffer: true })).toBe(true)
    // Mid-booking day re-ask: sem priorOffer de remarcação (phase remarcando) não é remarcação.
    expect(
      isRescheduleIntent('Na próxima terça tem algum horário disponível?', {
        hasUpcoming: true,
        priorOffer: false,
      }),
    ).toBe(false)
    expect(
      isRescheduleIntent('Na próxima terça tem algum horário disponível?', {
        hasUpcoming: true,
        priorOffer: true,
      }),
    ).toBe(true)
  })
})

describe('DEC-129 frases fixas (validador + claimsBooking)', () => {
  it('(1) pergunta o dia', () => {
    const t = phraseAskDay()
    expect(t).toBe('Claro, vamos remarcar. Para qual dia você prefere?')
    assertSafeClientCopy(t)
  })

  it('(2) oferece horários', () => {
    const t = phraseOfferSlots('2026-11-04', '10:00, 11:00')
    expect(t).toBe('Na quarta 04/11 tenho 10:00, 11:00. Algum serve para remarcar?')
    assertSafeClientCopy(t)
  })

  it('(3) dia sem vaga', () => {
    const t = phraseDayFull('2026-11-01')
    expect(t).toBe('Na domingo 01/11 não tenho horário livre. Quer ver outro dia?')
    assertSafeClientCopy(t)
  })

  it('(4) hora pedida sem vaga', () => {
    const t = phraseTimeTaken('2026-11-04', '10:00', '11:00, 14:00')
    expect(t).toBe(
      'Às 10:00 na quarta 04/11 já não tenho vaga. Tenho 11:00, 14:00. Qual fica melhor?',
    )
    assertSafeClientCopy(t)
  })

  it('(5) envio falhado', () => {
    const t = phraseSendFailed('2026-11-04', '10:00')
    expect(t).toBe(
      'Não consegui enviar a confirmação da remarcação para quarta 04/11 às 10:00. Ainda não está remarcado: a equipe vai te responder em seguida.',
    )
    assertSafeClientCopy(t)
  })

  it('(6) pausa da owner', () => {
    const t = phraseOwnerPaused('Depilação', '2026-11-04', '10:00')
    expect(t).toBe(
      'Recebi seu pedido de remarcar Depilação para quarta 04/11 às 10:00. Ainda não está remarcado: a equipe confirma e já te retorna.',
    )
    assertSafeClientCopy(t)
  })

  it('(6b) nome de serviço com termo proibido → variante sem nome (DEC-131), sem throw', () => {
    const nameless =
      'Recebi seu pedido de remarcar. Ainda não está remarcado: a equipe confirma e já te retorna.'
    expect(() => phraseOwnerPaused('Limpeza com buffer', '2026-11-04', '10:00')).not.toThrow()
    expect(phraseOwnerPaused('Limpeza com buffer', '2026-11-04', '10:00')).toBe(nameless)
    assertSafeClientCopy(phraseOwnerPaused('Limpeza com buffer', '2026-11-04', '10:00'))
  })
})

describe('DEC-131: as frases da remarcação nunca lançam', () => {
  it('nome proibido → variante sem nome; nome normal → frase da DEC-129', () => {
    for (const name of ['Sala VIP relax', 'Pacote catálogo', 'Massagem Linha Premium', 'Sessão de intervalo']) {
      expect(() => phraseOwnerPaused(name, '2026-11-04', '10:00')).not.toThrow()
      expect(phraseOwnerPaused(name, '2026-11-04', '10:00')).toBe(
        'Recebi seu pedido de remarcar. Ainda não está remarcado: a equipe confirma e já te retorna.',
      )
    }
    expect(phraseOwnerPaused('Depilação', '2026-11-04', '10:00')).toContain('remarcar Depilação para quarta 04/11')
  })
})

describe('DEC-091/129 reagendamento conversacional', () => {
  it('frase (1): «Quero remarcar» sem dia pede o dia', async () => {
    const s = seed()
    try {
      s.say('inbound', 'Quero remarcar')
      const out = await s.run()
      expect(out.reason).toBe('reschedule_flow')
      const body = s.lastOutbound()
      expect(body).toBe(phraseAskDay())
      assertSafeClientCopy(body)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.phase).toBe('remarcando')
    } finally {
      s.close()
    }
  })

  it('frase (2): «Posso reagendar para quarta?» oferece slots e não pergunta zonas', async () => {
    const s = seed()
    try {
      s.say(
        'outbound',
        'Pode falar! Seu horário de depilação segue marcado para terça (03/11), às 10:00. Em que posso ajudar?',
      )
      s.say('inbound', 'Posso reagendar para quarta?')
      const out = await s.run()
      expect(out.reason).toBe('reschedule_flow')
      const body = s.lastOutbound()
      expect(body).toMatch(/^Na quarta 04\/11 tenho .+\. Algum serve para remarcar\?$/)
      assertSafeClientCopy(body)
      expect(body.toLowerCase()).not.toMatch(/qual zona/)
      expect(body.toLowerCase()).not.toMatch(/temos axila/)
      expect(body).toMatch(/\d{2}:\d{2}/)
    } finally {
      s.close()
    }
  })

  it('frase (3): sem vagas pede outro dia sem perguntar zonas', async () => {
    const s = seed()
    try {
      // Domingo: sem expediente da Gi (só seg–sex).
      s.say('inbound', 'Posso reagendar para domingo?')
      const out = await s.run()
      expect(out.reason).toBe('reschedule_flow')
      const body = s.lastOutbound()
      expect(body).toBe(phraseDayFull('2026-11-01'))
      assertSafeClientCopy(body)
      expect(body.toLowerCase()).not.toMatch(/qual zona/)
    } finally {
      s.close()
    }
  })

  it('frase (4): hora pedida sem vaga oferece alternativas', async () => {
    const s = seed()
    try {
      // Ocupa 10:00 de quarta com outro contacto; deixa outras horas livres.
      const other = upsertContact(
        s.db,
        { tenantId: s.tenantId, waId: '5511900000099', displayName: 'Outra' },
        s.clock,
      )
      const zoneIds = s.db
        .all<{ id: string }>(
          `SELECT id FROM service_zones WHERE tenant_id = ? AND service_id = ?`,
          s.tenantId,
          s.svc.id,
        )
        .map((z) => z.id)
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          contactId: other.id,
          serviceId: s.svc.id,
          professionalId: s.gi.id,
          startsAt: zonedCivilToUtc(TZ, 2026, 11, 4, 10, 0),
          actorClerkUserId: s.caller.actorId!,
          clientRequestId: 'hold-wed-10',
          zoneIds: zoneIds.slice(0, 1),
        },
        s.clock,
      )
      s.say('inbound', 'Posso reagendar para quarta às 10:00?')
      const out = await s.run()
      expect(out.reason).toBe('reschedule_flow')
      const body = s.lastOutbound()
      expect(body).toMatch(/^Às 10:00 na quarta 04\/11 já não tenho vaga\. Tenho .+\. Qual fica melhor\?$/)
      assertSafeClientCopy(body)
    } finally {
      s.close()
    }
  })

  it('frase (5): falha ao montar proposta → envio falhado, sem afirmar remarcado', async () => {
    const s = seed()
    try {
      s.say('inbound', 'Posso reagendar para quarta?')
      await s.run()
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.pending?.options.length).toBeGreaterThan(0)
      const pick = frame!.pending!.options[0]!.key
      // Quota 0 → createProposal lança; catch usa a frase (5).
      const outcome = await tryAiReschedule(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        inboundText: pick,
        capability: true,
        abuseLimits: { ...DEFAULT_ABUSE_LIMITS, enabled: true, proposalsPerContact: 0 },
      })
      expect(outcome?.handled).toBe(true)
      const body = outcome!.replyText
      expect(body).toMatch(
        /^Não consegui enviar a confirmação da remarcação para quarta 04\/11 às \d{2}:\d{2}\. Ainda não está remarcado: a equipe vai te responder em seguida\.$/,
      )
      assertSafeClientCopy(body)
    } finally {
      s.close()
    }
  })

  it('frase (6): capacidade pausada → pausa da owner, sem proposta', async () => {
    const s = seed()
    try {
      s.say('inbound', 'Posso reagendar para quarta?')
      await s.run()
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      const pick = frame!.pending!.options[0]!.key
      s.say('inbound', pick)
      const second = await s.run({ autoBookPaused: true })
      expect(second.reason).toBe('reschedule_flow')
      const body = s.lastOutbound()
      expect(body).toMatch(
        /^Recebi seu pedido de remarcar Depilação para quarta 04\/11 às \d{2}:\d{2}\. Ainda não está remarcado: a equipe confirma e já te retorna\.$/,
      )
      assertSafeClientCopy(body)
      const proposalRow = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointment_proposals WHERE tenant_id = ?`,
        s.tenantId,
      )
      expect(proposalRow?.n ?? 0).toBe(0)
      // TR-487: alerta sem pausa (Precisa de alguém).
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)).toBeNull()
      const pending = s.db.all<{ kind: string }>(
        `SELECT kind FROM pending_communications
         WHERE tenant_id = ? AND conversation_id = ? AND status != 'resolved'`,
        s.tenantId,
        s.cnv.id,
      )
      expect(pending.some((p) => p.kind === 'alter_awaiting_team')).toBe(true)
    } finally {
      s.close()
    }
  })

  it.each(['Sala VIP relax', 'Pacote catálogo', 'Massagem Linha Premium', 'Sessão de intervalo'])(
    'DEC-131: serviço «%s» (termo proibido) → pausa da owner sem nome, sem lançar',
    async (serviceName) => {
      const s = seed()
      try {
        s.say('inbound', 'Posso reagendar para quarta?')
        await s.run()
        const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
        const pick = frame!.pending!.options[0]!.key
        s.db.run(`UPDATE services SET name = ? WHERE tenant_id = ? AND id = ?`, serviceName, s.tenantId, s.svc.id)
        s.say('inbound', pick)
        const second = await s.run({ autoBookPaused: true })
        expect(second.reason).toBe('reschedule_flow')
        const body = s.lastOutbound()
        expect(body).toBe(
          'Recebi seu pedido de remarcar. Ainda não está remarcado: a equipe confirma e já te retorna.',
        )
        assertSafeClientCopy(body)
      } finally {
        s.close()
      }
    },
  )

  it('escolhe horário → proposta replace → Confirmar actualiza o mesmo compromisso', async () => {
    const s = seed()
    try {
      s.say('inbound', 'Posso reagendar para quarta?')
      await s.run()
      const offer = s.lastOutbound()
      expect(offer).toMatch(/Algum serve para remarcar\?/)
      assertSafeClientCopy(offer)
      const times = [...offer.matchAll(/\b(\d{2}:\d{2})\b/g)].map((m) => m[1]!)
      expect(times.length).toBeGreaterThan(0)
      const pick = times[0]!
      s.say('inbound', pick)
      const second = await s.run()
      expect(second.reason).toBe('reschedule_flow')
      const proposalRow = s.db.get<{ id: string }>(
        `SELECT id FROM appointment_proposals WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
      )
      expect(proposalRow).toBeTruthy()
      const proposal = getProposal(s.db, s.tenantId, proposalRow!.id)!
      expect(proposal.replacesAppointmentId).toBe(s.aptId)
      expect(proposal.serviceId).toBe(s.svc.id)

      s.db.run(
        `UPDATE appointment_proposals SET state = 'enviada', sent_at = ?, expires_at = ? WHERE id = ?`,
        s.clock.nowMs(),
        s.clock.nowMs() + 30 * 60_000,
        proposal.id,
      )
      const click = handleProposalButtonClick(
        s.db,
        {
          tenantId: s.tenantId,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          buttonId: proposalButtonId(proposal.id, proposal.version, 'confirm'),
        },
        s.clock,
      )
      expect(click.handled).toBe(true)
      expect('handoff' in click).toBe(true)
      if (!('handoff' in click)) return
      const result = await executeProposalConfirmOp(
        s.db,
        s.caller,
        { handoff: click.handoff, capability: true },
        s.clock,
        {},
      )
      expect(result.status).toBe('booked')
      if (result.status !== 'booked') return
      expect(result.appointment.id).toBe(s.aptId)
      expect(result.appointment.startsAt).toBe(proposal.startsAt)
      const count = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ? AND contact_id = ? AND status = 'confirmed'`,
        s.tenantId,
        s.contact.id,
      )!.n
      expect(count).toBe(1)
    } finally {
      s.close()
    }
  })

  it('cancelar continua handoff humano', async () => {
    const s = seed()
    try {
      s.say('inbound', 'Quero cancelar o horário')
      const out = await s.run()
      expect(out.reason).toBe('human_handoff')
      expect(s.lastOutbound()).toBe(HUMAN_HANDOFF_TEXT)
    } finally {
      s.close()
    }
  })

  it('CF-22: texto outbound antigo sem frame não autoriza escolha de horário', async () => {
    const s = seed()
    try {
      // Copy antiga com marcador — sem lastOffer/pending/phase no frame.
      s.say(
        'outbound',
        'Para remarcar o mesmo atendimento na quarta 04/11, tenho 10:00, 11:00. Qual fica melhor?',
      )
      s.say('inbound', '10:00')
      const out = await s.run()
      expect(out.reason).not.toBe('reschedule_flow')
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.lastOffer).toBeFalsy()
    } finally {
      s.close()
    }
  })

  it('cutover: oferta grava lastOffer e o 2.º turno escolhe pelo frame', async () => {
    const s = seed()
    try {
      s.say('inbound', 'Posso reagendar para quarta?')
      await s.run()
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.phase).toBe('remarcando')
      expect(frame?.lastOffer?.slots.length).toBeGreaterThan(0)
      expect(frame?.pending?.options.length).toBeGreaterThan(0)
      const pick = frame!.pending!.options[0]!.key
      s.say('inbound', pick)
      const second = await s.run()
      expect(second.reason).toBe('reschedule_flow')
      const proposalRow = s.db.get<{ id: string }>(
        `SELECT id FROM appointment_proposals WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
      )
      expect(proposalRow).toBeTruthy()
    } finally {
      s.close()
    }
  })

  it('mid-booking «próxima terça» com lastOffer ofertado e compromisso futuro não vira remarcação', async () => {
    // Staging Paulo ~09/11: mid marcação nova (zonas+Horários sexta) + «Na próxima terça…»
    // com compromisso futuro → «Algum serve para remarcar?» + «Falar com a equipe».
    // G-07b / #644: só copy + botões; serviço do compromisso = Depilação (= frame),
    // por isso não apanha troca Depilação→Massagem (ver teste seguinte / G-07c).
    const s = seed()
    try {
      const offerMsg = s.say(
        'outbound',
        'Os próximos horários para Depilação são sexta 06/11 às 09:00, 10:00. Algum serve?',
      )
      const friMorning = zonedCivilToUtc(TZ, 2026, 11, 6, 9, 0)
      const friTen = zonedCivilToUtc(TZ, 2026, 11, 6, 10, 0)
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.svc.id,
          line: 'feminino',
          variantIds: s.zones.map((z) => z.id),
          date: '2026-11-06',
          phase: 'ofertado',
          pending: {
            slot: 'horario',
            options: [
              { key: '2026-11-06T09:00', label: 'sexta 06/11 às 09:00' },
              { key: '2026-11-06T10:00', label: 'sexta 06/11 às 10:00' },
            ],
            messageId: offerMsg.id,
          },
          lastOffer: {
            slots: [
              { startsAt: friMorning, professionalId: s.gi.id },
              { startsAt: friTen, professionalId: s.gi.id },
            ],
            messageId: offerMsg.id,
          },
        },
        s.clock,
      )

      s.say('inbound', 'Na próxima terça tem algum horário disponível?')
      const out = await s.run()
      expect(out.reason).not.toBe('reschedule_flow')
      expect(out.reason).not.toBe('human_handoff')
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.phase).not.toBe('remarcando')

      const body = s.lastOutbound()
      expect(body).not.toMatch(/remarcar/i)
      expect(body).toMatch(/Algum serve\?/)
      expect(body).toMatch(/terça|10\/11|03\/11|\d{1,2}:\d{2}/i)

      const interactive = s.db
        .all<{ kind: string; interactive_json: string | null }>(
          `SELECT kind, interactive_json FROM outbound_messages WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 3`,
          s.tenantId,
        )
        .map((m) => m.interactive_json ?? '')
        .join('\n')
      expect(interactive).toContain(SLOT_LIST_BUTTON_LABEL)
      expect(interactive).not.toMatch(/Falar com a equipe/)
    } finally {
      s.close()
    }
  })

  it('G-07c: day re-ask + time pick keeps Depilação when upcoming apt is Massagem', async () => {
    // Staging Paulo ~14:03 SP 09/11/2026: frame Depilação (Íntima/pernas) + compromisso
    // futuro Massagem·Ventosaterapia → «Para hoje tem horário?» / «As 15» propôs Massagem.
    // Pre-#644: priorRescheduleOfferFromFrame=true em ofertado → tryAiReschedule usava
    // apt.serviceId. G-07b/#644 só assertava copy/botões com o mesmo serviço no apt.
    const s = seed()
    try {
      s.db.run(`UPDATE appointments SET status = 'cancelled' WHERE id = ?`, s.aptId)

      const massagem = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Massagem',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 20000,
          variantKind: 'tipo',
          variantKindPlural: 'tipos',
          professionalIds: [s.gi.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      const massaZones = replaceServiceZonesOp(
        s.db,
        s.caller,
        massagem.id,
        [{ name: 'Ventosaterapia', durationMinutes: 60, priceCents: 20000, audience: 'ambos' }],
        s.clock,
      )
      const massaStarts = zonedCivilToUtc(TZ, 2026, 11, 4, 15, 0)
      const massaApt = confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'seed-apt-massagem',
          serviceId: massagem.id,
          professionalId: s.gi.id,
          startsAt: massaStarts,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          actorClerkUserId: s.caller.actorId!,
          zoneIds: massaZones.map((z) => z.id),
        },
        s.clock,
      )
      expect(massaApt.value.serviceId).toBe(massagem.id)

      const offerMsg = s.say(
        'outbound',
        'Os próximos horários para Depilação são sexta 06/11 às 09:00, 10:00. Algum serve?',
      )
      const friMorning = zonedCivilToUtc(TZ, 2026, 11, 6, 9, 0)
      const friTen = zonedCivilToUtc(TZ, 2026, 11, 6, 10, 0)
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.svc.id,
          line: 'feminino',
          variantIds: s.zones.map((z) => z.id),
          date: '2026-11-06',
          phase: 'ofertado',
          pending: {
            slot: 'horario',
            options: [
              { key: '2026-11-06T09:00', label: 'sexta 06/11 às 09:00' },
              { key: '2026-11-06T10:00', label: 'sexta 06/11 às 10:00' },
            ],
            messageId: offerMsg.id,
          },
          lastOffer: {
            slots: [
              { startsAt: friMorning, professionalId: s.gi.id },
              { startsAt: friTen, professionalId: s.gi.id },
            ],
            messageId: offerMsg.id,
          },
        },
        s.clock,
      )

      s.say('inbound', 'Para hoje tem horário?')
      const dayOut = await s.run()
      expect(dayOut.reason).not.toBe('reschedule_flow')
      expect(dayOut.reason).not.toBe('human_handoff')
      expect(s.lastOutbound()).not.toMatch(/remarcar/i)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.serviceId).toBe(s.svc.id)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.phase).not.toBe('remarcando')

      const frameAfterDay = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frameAfterDay?.serviceId).toBe(s.svc.id)
      // Prefer pending key of the *new* day offer; fall back to HH:MM from copy.
      // Do not send a stale sexta ISO key — extractTimes reads «2026» as 20:26.
      const pendingKey = frameAfterDay?.pending?.options?.[0]?.key
      const listed = [...s.lastOutbound().matchAll(/\b(\d{2}:\d{2})\b/g)].map((m) => m[1]!)
      expect(listed.length + (pendingKey ? 1 : 0)).toBeGreaterThan(0)
      const inboundPick =
        pendingKey && !listed.length
          ? pendingKey
          : listed.includes('15:00')
            ? 'As 15'
            : `As ${(listed[0] ?? pendingKey!.slice(-5)).slice(0, 2)}`
      s.say('inbound', inboundPick)
      const timeOut = await s.run()
      expect(timeOut.reason).not.toBe('reschedule_flow')

      const proposalRow = s.db.get<{ id: string }>(
        `SELECT id FROM appointment_proposals WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
      )
      expect(proposalRow).toBeTruthy()
      const proposal = getProposal(s.db, s.tenantId, proposalRow!.id)!
      expect(proposal.serviceId).toBe(s.svc.id)
      expect(proposal.serviceId).not.toBe(massagem.id)
      expect(proposal.replacesAppointmentId).toBeNull()
      expect(proposal.serviceName).toMatch(/Depilação/i)
      expect(proposal.serviceName).not.toMatch(/Massagem/i)
    } finally {
      s.close()
    }
  })

  it('G-07d: mid-booking SOFT_DAY «Posso para hoje?» não remarca apt Massagem', async () => {
    // Pós-#644: DAY_OR_PERIOD mid-booking já não entra (priorOffer só remarcando),
    // mas SOFT_DAY + hasUpcoming ainda chama tryAiReschedule no autodraft e
    // sobrescrevia o frame com apt.serviceId (audit service-identity C1).
    const s = seed()
    try {
      s.db.run(`UPDATE appointments SET status = 'cancelled' WHERE id = ?`, s.aptId)

      const massagem = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Massagem',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 20000,
          variantKind: 'tipo',
          variantKindPlural: 'tipos',
          professionalIds: [s.gi.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      const massaZones = replaceServiceZonesOp(
        s.db,
        s.caller,
        massagem.id,
        [{ name: 'Ventosaterapia', durationMinutes: 60, priceCents: 20000, audience: 'ambos' }],
        s.clock,
      )
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'seed-apt-massagem-soft',
          serviceId: massagem.id,
          professionalId: s.gi.id,
          startsAt: zonedCivilToUtc(TZ, 2026, 11, 4, 15, 0),
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          actorClerkUserId: s.caller.actorId!,
          zoneIds: massaZones.map((z) => z.id),
        },
        s.clock,
      )

      const offerMsg = s.say(
        'outbound',
        'Os próximos horários para Depilação são sexta 06/11 às 09:00, 10:00. Algum serve?',
      )
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.svc.id,
          line: 'feminino',
          variantIds: s.zones.map((z) => z.id),
          date: '2026-11-06',
          phase: 'ofertado',
          pending: {
            slot: 'horario',
            options: [
              { key: '2026-11-06T09:00', label: 'sexta 06/11 às 09:00' },
              { key: '2026-11-06T10:00', label: 'sexta 06/11 às 10:00' },
            ],
            messageId: offerMsg.id,
          },
          lastOffer: {
            slots: [
              { startsAt: zonedCivilToUtc(TZ, 2026, 11, 6, 9, 0), professionalId: s.gi.id },
              { startsAt: zonedCivilToUtc(TZ, 2026, 11, 6, 10, 0), professionalId: s.gi.id },
            ],
            messageId: offerMsg.id,
          },
        },
        s.clock,
      )

      expect(
        isRescheduleIntent('Posso para hoje?', { hasUpcoming: true, priorOffer: false }),
      ).toBe(true)

      s.say('inbound', 'Posso para hoje?')
      const out = await s.run()
      expect(out.reason).not.toBe('reschedule_flow')
      expect(out.reason).not.toBe('human_handoff')
      expect(s.lastOutbound()).not.toMatch(/remarcar/i)
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.serviceId).toBe(s.svc.id)
      expect(frame?.phase).not.toBe('remarcando')
    } finally {
      s.close()
    }
  })

})
