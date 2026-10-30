/**
 * DEC-077 / S6 — aviso na marcação manual. A confirmação segue.
 * O clique da proposta continua a recusar (S5).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { formatClinicTime } from '../ai/schedule-context'
import {
  setForecastPlaceOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { upsertContact } from '../contacts'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { clinicInbox, clinicWhatsapp, workerCaller } from '../index'
import {
  createProposal,
  executeProposalConfirmOp,
  handleProposalButtonClick,
  markProposalSent,
  proposalButtonId,
} from '../proposals'
import { confirmAppointmentOp, queryAvailabilityOp } from '../scheduling'
import { serializeAvailability } from '../../scheduling/serialize'
import { bootClinicDb } from '../test-db'
import type { ForecastAdapter, SkySymbol } from './evaluate'
import { tempoWarningsAt, withTempoWarnings } from './warnings'

const DAY = '2024-01-08'
const CLOCK = Date.UTC(2024, 0, 8, 11, 0)

function reading(sky: SkySymbol, celsius: number): ForecastAdapter & { calls: number } {
  const adapter = {
    calls: 0,
    async read() {
      adapter.calls += 1
      return { ok: true as const, sky, celsius }
    },
  }
  return adapter
}

function failing(): ForecastAdapter & { calls: number } {
  const adapter = {
    calls: 0,
    async read() {
      adapter.calls += 1
      return { ok: false as const }
    },
  }
  return adapter
}

function seed() {
  const clock = createControllableClock(CLOCK)
  const boot = bootClinicDb({ clock })
  const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
  const room = upsertResourceOp(boot.db, caller, { kind: 'room', name: 'Sala 1' }, clock)
  const pro = upsertResourceOp(
    boot.db,
    caller,
    { kind: 'professional', name: 'Gi', homeRoomId: room.id },
    clock,
  )
  setWeeklyWindowsOp(
    boot.db,
    caller,
    { resourceId: pro.id, windows: [{ dayOfWeek: 1, startMinute: 8 * 60, endMinute: 18 * 60 }] },
    clock,
  )
  const bronze = upsertServiceOp(
    boot.db,
    caller,
    {
      name: 'Bronzeamento',
      durationMinutes: 60,
      bufferMinutes: 0,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
      tempoCeu: 'sol',
      tempoTemperatura: 'acima',
      tempoCelsius: 24,
    },
    clock,
  )
  setForecastPlaceOp(boot.db, caller, { mode: 'cidade', city: 'Campinas' }, clock)
  return { ...boot, clock, caller, pro, bronze }
}

function at15<T extends { startsAt: number }>(slots: T[]): T {
  const slot = slots.find((row) => formatClinicTime('America/Sao_Paulo', row.startsAt) === '15:00')
  if (!slot) throw new Error('15:00 em falta')
  return slot
}

describe('aviso do bloco Tempo na marcação manual (S6)', () => {
  it('15h com sol fraco continua na grade, o aviso vai na resposta e o compromisso nasce', async () => {
    const s = seed()
    try {
      const weak = reading('encoberto', 28)
      const team = await withTempoWarnings(
        s.db,
        s.caller.tenantId,
        queryAvailabilityOp(
          s.db,
          s.caller,
          { serviceId: s.bronze.id, date: DAY, professionalId: s.pro.id, tempoMode: 'equipe' },
          s.clock,
        ),
        weak,
        s.clock,
      )
      const slot = at15(team.slots)
      expect(slot.tempoWarnings).toEqual(['Sol fraco neste horário'])
      expect(serializeAvailability(team).slots.find((row) => row.startsAt === slot.startsAt)?.tempoWarnings).toEqual(
        slot.tempoWarnings,
      )
      expect(weak.calls).toBeGreaterThan(0)

      const booked = confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'req-tempo-manual',
          serviceId: s.bronze.id,
          professionalId: s.pro.id,
          startsAt: slot.startsAt,
          contactLabel: 'Ana Silva',
          actorClerkUserId: s.caller.actorId!,
        },
        s.clock,
      )
      const warnings = await tempoWarningsAt(
        s.db,
        s.caller.tenantId,
        s.bronze.id,
        slot.startsAt,
        reading('encoberto', 28),
        s.clock,
      )
      expect(booked.value.status).toBe('confirmed')
      expect(warnings).toEqual(slot.tempoWarnings)
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)?.n).toBe(1)
    } finally {
      s.close()
    }
  })

  it('céu e temperatura a falhar devolvem as duas frases e um compromisso', async () => {
    const s = seed()
    try {
      const both = reading('encoberto', 22)
      const team = await withTempoWarnings(
        s.db,
        s.caller.tenantId,
        queryAvailabilityOp(
          s.db,
          s.caller,
          { serviceId: s.bronze.id, date: DAY, professionalId: s.pro.id, tempoMode: 'equipe' },
          s.clock,
        ),
        both,
        s.clock,
      )
      const slot = at15(team.slots)
      expect(slot.tempoWarnings).toEqual([
        'Sol fraco neste horário',
        'Abaixo de 24 °C neste horário',
      ])
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'req-tempo-ambos',
          serviceId: s.bronze.id,
          professionalId: s.pro.id,
          startsAt: slot.startsAt,
          contactLabel: 'Ana Silva',
          actorClerkUserId: s.caller.actorId!,
        },
        s.clock,
      )
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)?.n).toBe(1)
    } finally {
      s.close()
    }
  })

  it('sem previsão o aviso é único e o compromisso também nasce', async () => {
    const s = seed()
    try {
      const slot = at15(
        queryAvailabilityOp(
          s.db,
          s.caller,
          { serviceId: s.bronze.id, date: DAY, professionalId: s.pro.id },
          s.clock,
        ).slots,
      )
      const warnings = await tempoWarningsAt(
        s.db,
        s.caller.tenantId,
        s.bronze.id,
        slot.startsAt,
        failing(),
        s.clock,
      )
      expect(warnings).toEqual(['Não deu para confirmar o tempo'])
      const booked = confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'req-tempo-cego',
          serviceId: s.bronze.id,
          professionalId: s.pro.id,
          startsAt: slot.startsAt,
          contactLabel: 'Ana Silva',
          actorClerkUserId: s.caller.actorId!,
        },
        s.clock,
      )
      expect(booked.value.status).toBe('confirmed')
    } finally {
      s.close()
    }
  })

  it('chuva em falta e frio em falta usam a frase do lado que falhou', async () => {
    const s = seed()
    try {
      const chuva = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Banho de chuva',
          durationMinutes: 60,
          bufferMinutes: 0,
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
          tempoCeu: 'chuva',
        },
        s.clock,
      )
      const frio = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Criolipólise',
          durationMinutes: 60,
          bufferMinutes: 0,
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
          tempoTemperatura: 'abaixo',
          tempoCelsius: 18,
        },
        s.clock,
      )
      const startsAt = at15(
        queryAvailabilityOp(
          s.db,
          s.caller,
          { serviceId: chuva.id, date: DAY, professionalId: s.pro.id },
          s.clock,
        ).slots,
      ).startsAt
      expect(
        await tempoWarningsAt(s.db, s.caller.tenantId, chuva.id, startsAt, reading('ceu_limpo', 30), s.clock),
      ).toEqual(['Sem chuva neste horário'])
      expect(
        await tempoWarningsAt(s.db, s.caller.tenantId, frio.id, startsAt, reading('ceu_limpo', 22), s.clock),
      ).toEqual(['Acima de 18 °C neste horário'])
    } finally {
      s.close()
    }
  })

  it('compromisso já confirmado permanece quando a previsão dessa hora deixa de servir', async () => {
    const s = seed()
    try {
      const slot = at15(
        queryAvailabilityOp(
          s.db,
          s.caller,
          { serviceId: s.bronze.id, date: DAY, professionalId: s.pro.id },
          s.clock,
        ).slots,
      )
      const booked = confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'req-tempo-fica',
          serviceId: s.bronze.id,
          professionalId: s.pro.id,
          startsAt: slot.startsAt,
          contactLabel: 'Ana Silva',
          actorClerkUserId: s.caller.actorId!,
        },
        s.clock,
      )
      const later = await tempoWarningsAt(
        s.db,
        s.caller.tenantId,
        s.bronze.id,
        slot.startsAt,
        failing(),
        s.clock,
      )
      expect(later).toEqual(['Não deu para confirmar o tempo'])
      expect(
        s.db.get<{ status: string }>(`SELECT status FROM appointments WHERE id = ?`, booked.value.id)?.status,
      ).toBe('confirmed')
    } finally {
      s.close()
    }
  })

  it('o clique da mesma hora não cria compromisso e também chama a avaliação', async () => {
    const clock = createControllableClock(CLOCK)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-a'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    try {
      clinicWhatsapp.syncWhatsappChannel(
        boot.db,
        tenantId,
        {
          status: 'connected',
          bindingId: 'bind_s6t',
          phoneNumberId: 'pn_s6t',
          wabaId: 'waba_s6t',
          displayPhone: '+5511999000000',
          displayName: 'Clínica Tempo',
          action: 'channel_connected',
        },
        clock,
      )
      clinicInbox.seedSyntheticWhatsappTemplates(boot.db, tenantId, clock)
      const room = upsertResourceOp(boot.db, caller, { kind: 'room', name: 'Sala 1' }, clock)
      const pro = upsertResourceOp(
        boot.db,
        caller,
        { kind: 'professional', name: 'Gi', homeRoomId: room.id },
        clock,
      )
      setWeeklyWindowsOp(
        boot.db,
        caller,
        { resourceId: pro.id, windows: [{ dayOfWeek: 1, startMinute: 8 * 60, endMinute: 18 * 60 }] },
        clock,
      )
      const service = upsertServiceOp(
        boot.db,
        caller,
        {
          name: 'Bronzeamento',
          durationMinutes: 60,
          bufferMinutes: 0,
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
          tempoCeu: 'sol',
          tempoTemperatura: 'acima',
          tempoCelsius: 24,
        },
        clock,
      )
      setForecastPlaceOp(boot.db, caller, { mode: 'cidade', city: 'Campinas' }, clock)
      const contact = upsertContact(boot.db, { tenantId, waId: '5511999000016', displayName: 'Ana' }, clock)
      const conversation = createConversation(boot.db, { tenantId, contactId: contact.id, status: 'open' }, clock)
      insertMessage(
        boot.db,
        {
          tenantId,
          conversationId: conversation.id,
          direction: 'inbound',
          body: 'Oi',
          externalMessageId: 'wamid.in_s6',
          deliveryState: 'received',
          authorClerkUserId: null,
          authorDisplayName: null,
          createdAt: clock.nowMs(),
        },
        clock,
      )
      const startsAt = at15(
        queryAvailabilityOp(
          boot.db,
          caller,
          { serviceId: service.id, date: DAY, professionalId: pro.id },
          clock,
        ).slots,
      ).startsAt
      const proposal = markProposalSent(
        boot.db,
        tenantId,
        createProposal(
          boot.db,
          tenantId,
          {
            contactId: contact.id,
            conversationId: conversation.id,
            serviceId: service.id,
            professionalId: pro.id,
            startsAt,
          },
          clock,
        ).id,
        clock,
      )
      boot.db.run(
        `UPDATE appointment_proposals SET send_provider_message_id = ? WHERE tenant_id = ? AND id = ?`,
        'wamid.proposal_s6',
        tenantId,
        proposal.id,
      )
      const forecast = reading('encoberto', 28)
      const handoff = handleProposalButtonClick(
        boot.db,
        {
          tenantId,
          contactId: contact.id,
          conversationId: conversation.id,
          buttonId: proposalButtonId(proposal.id, proposal.version, 'confirm'),
          contextMessageId: 'wamid.proposal_s6',
          providerEventKey: 'evt_s6',
        },
        clock,
      )
      if (!('handoff' in handoff)) throw new Error('expected handoff')
      const result = await executeProposalConfirmOp(
        boot.db,
        caller,
        {
          handoff: handoff.handoff,
          capability: true,
          providerEventKey: 'evt_s6',
          contextMessageId: 'wamid.proposal_s6',
          senderContactId: contact.id,
        },
        clock,
        { forecast },
      )
      expect(result.status).toBe('tempo_refused')
      expect(forecast.calls).toBeGreaterThan(0)
      expect(boot.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)?.n).toBe(0)
    } finally {
      boot.close()
    }
  })
})
