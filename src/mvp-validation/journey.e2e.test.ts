/**
 * E2E sintético ponta a ponta (#45 / MVP-31):
 * WhatsApp → atendimento → Acompanhamento → agenda (com e sem Pix) + IA + exclusão.
 * Duas clínicas fictícias; sem dados reais; não activa piloto.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../ai'
import { SimulatedPixAdapter } from '../pix'
import {
  ConflictError,
  ingestContactMessage,
  queueCaller,
  workerCaller,
} from '../clinic'
import {
  applyOutboundSendResultOp,
  sendOutboundMessageOp,
} from '../clinic/inbox/operations'
import { findOutboundByClientRequestId } from '../clinic/inbox'
import {
  ensureOpenOpportunity,
  findOpenOpportunityForConversation,
  moveOpportunityStageOp,
} from '../clinic/pipeline'
import {
  confirmAppointmentOp,
  zonedCivilToUtc,
} from '../clinic/scheduling'
import {
  countAppointmentAllocations,
  createSignalChargeAndSendOp,
  processPixPaymentOp,
} from '../clinic/pix'
import { suggestReplyOp, decideSuggestionOp } from '../clinic/ai'
import { setClinicAiAssistEnabled } from '../clinic/config/settings'
import { deleteContactOp } from '../clinic/retention'
import { ANONYMIZED_CONTACT_LABEL } from '../clinic/retention/types'
import { listContacts, getContact } from '../clinic/contacts'
import {
  ATT_A,
  CLINIC_A,
  CLINIC_B,
  OWNER_A,
  TZ,
  seedPairClinics,
} from './fixtures'
import { MVP_EVIDENCE_MATRIX, summarizeEvidenceMatrix } from './matrix'

describe('MVP-31 — jornada E2E sintética (#45)', () => {
  it('matriz máquina-legível tem estados válidos e cobertura Confirmado', () => {
    const counts = summarizeEvidenceMatrix()
    expect(counts.Confirmado).toBeGreaterThanOrEqual(10)
    expect(MVP_EVIDENCE_MATRIX.some((r) => r.id === 'AC-54')).toBe(true)
    expect(MVP_EVIDENCE_MATRIX.some((r) => r.state === 'Em aberto')).toBe(true)
  })

  it('AC-04/08/13/JRN-01–03: mensagem → pipeline → agenda sem Pix; A≠B', async () => {
    const { a, b, closeAll } = await seedPairClinics()
    try {
      const ingA = ingestContactMessage(
        a.db,
        workerCaller(CLINIC_A, ATT_A),
        {
          providerEventKey: 'wa:mvp31:a:1',
          waId: '5511999001010',
          displayName: 'Carla Fictícia',
          body: 'Quero agendar limpeza',
        },
        a.clock,
      )
      expect(ingA.conversation).toBeTruthy()
      const opp = findOpenOpportunityForConversation(
        a.db,
        CLINIC_A,
        ingA.conversation!.id,
      )
      expect(opp?.stage).toBe('novo_contato')

      const moved = moveOpportunityStageOp(
        a.db,
        workerCaller(CLINIC_A, ATT_A),
        {
          opportunityId: opp!.id,
          toStage: 'em_atendimento',
          actorClerkUserId: ATT_A,
          actorDisplayName: 'Ana Atendente',
        },
        a.clock,
      )
      expect(moved.value.stage).toBe('em_atendimento')

      const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 10, 0)
      const booked = confirmAppointmentOp(
        a.db,
        a.caller,
        {
          clientRequestId: 'mvp31-plain-1',
          serviceId: a.svcPlain.id,
          professionalId: a.pro.id,
          roomResourceId: a.room.id,
          startsAt,
          contactLabel: 'Carla Fictícia',
          actorClerkUserId: OWNER_A,
          conversationId: ingA.conversation!.id,
          opportunityId: opp!.id,
        },
        a.clock,
      )
      expect(booked.value.status).toBe('confirmed')

      moveOpportunityStageOp(
        a.db,
        workerCaller(CLINIC_A, ATT_A),
        {
          opportunityId: opp!.id,
          toStage: 'agendado',
          actorClerkUserId: ATT_A,
          actorDisplayName: 'Ana Atendente',
        },
        a.clock,
      )

      // Clínica B: mesmo wa_id lógico não partilha estado.
      const ingB = ingestContactMessage(
        b.db,
        workerCaller(CLINIC_B, 'user_synth_owner_b'),
        {
          providerEventKey: 'wa:mvp31:b:1',
          waId: '5511999001010',
          displayName: 'Carla Outra Clínica',
          body: 'Olá B',
        },
        b.clock,
      )
      expect(ingB.contact!.id).not.toBe(ingA.contact!.id)
      expect(
        findOpenOpportunityForConversation(b.db, CLINIC_B, ingB.conversation!.id)
          ?.id,
      ).not.toBe(opp!.id)
      expect(countAppointmentAllocations(b.db, CLINIC_B)).toBe(0)
      expect(countAppointmentAllocations(a.db, CLINIC_A)).toBeGreaterThanOrEqual(1)
    } finally {
      closeAll()
    }
  })

  it('AC-06/JRN-16: IA assistiva + sinal Pix confirma horário livre', async () => {
    const { a, closeAll } = await seedPairClinics()
    try {
      ensureOpenOpportunity(
        a.db,
        {
          tenantId: CLINIC_A,
          contactId: a.contact.id,
          conversationId: a.conversation.id,
        },
        a.clock,
      )
      setClinicAiAssistEnabled(a.db, CLINIC_A, true, a.clock)

      const suggestion = await suggestReplyOp(
        a.db,
        workerCaller(CLINIC_A, ATT_A),
        {
          conversationId: a.conversation.id,
          clientRequestId: 'mvp31-ai-1',
          actorClerkUserId: ATT_A,
          actorDisplayName: 'Ana',
        },
        a.clock,
        { adapter: new SimulatedAiAdapter(), mode: 'synthetic' },
      )
      expect(suggestion.messageSent).toBe(false)
      expect(suggestion.suggestion.status).toBe('pending')

      const decided = decideSuggestionOp(
        a.db,
        workerCaller(CLINIC_A, ATT_A),
        {
          suggestionId: suggestion.suggestion.id,
          decision: 'discard',
          actorClerkUserId: ATT_A,
          actorDisplayName: 'Ana',
          clientRequestId: 'mvp31-ai-decide-1',
        },
        a.clock,
      )
      expect(decided.messageSent).toBe(false)

      const adapter = new SimulatedPixAdapter({
        clock: { now: () => new Date(a.clock.nowMs()) },
      })
      const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 14, 0)
      const charge = await createSignalChargeAndSendOp(
        a.db,
        a.caller,
        {
          clientRequestId: 'mvp31-pix-1',
          conversationId: a.conversation.id,
          contactId: a.contact.id,
          serviceId: a.svcSignal.id,
          professionalId: a.pro.id,
          roomResourceId: a.room.id,
          startsAt,
          actorClerkUserId: OWNER_A,
        },
        a.clock,
        { adapter },
      )
      expect(charge.charge.status).toBe('awaiting_payment')
      expect(countAppointmentAllocations(a.db, CLINIC_A)).toBe(0)

      const paid = await adapter.simulatePayment(charge.charge.providerChargeId!)
      if (!paid.ok) throw new Error('simulate payment failed')
      const evt = await adapter.validateWebhookEvent(paid.value.envelope)
      if (!evt.ok) throw new Error('validate webhook failed')

      const result = processPixPaymentOp(
        a.db,
        a.caller,
        {
          eventId: evt.value.eventId,
          eventType: 'charge.paid',
          providerChargeId: evt.value.providerChargeId,
          accountId: evt.value.accountId,
          amountCents: evt.value.amountCents,
          occurredAt: evt.value.occurredAt,
        },
        a.clock,
      )
      expect(result.resolution).toBe('appointment_confirmed')
      expect(result.charge.status).toBe('paid')
      expect(countAppointmentAllocations(a.db, CLINIC_A)).toBe(2)
    } finally {
      closeAll()
    }
  })

  it('AC-52: exclusão de contacto anonimiza compromisso e isola B', async () => {
    const { a, b, closeAll } = await seedPairClinics()
    try {
      const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 11, 0)
      confirmAppointmentOp(
        a.db,
        a.caller,
        {
          clientRequestId: 'mvp31-del-apt',
          serviceId: a.svcPlain.id,
          professionalId: a.pro.id,
          roomResourceId: a.room.id,
          startsAt,
          contactLabel: 'Marina Aurora',
          actorClerkUserId: OWNER_A,
          contactId: a.contact.id,
        },
        a.clock,
      )

      const contactsBBefore = listContacts(b.db, CLINIC_B).length
      const deleted = deleteContactOp(a.db, a.caller, a.contact.id, a.clock)
      expect(deleted.value.deletedMessageCount).toBeGreaterThanOrEqual(1)
      expect(getContact(a.db, CLINIC_A, a.contact.id)).toBeUndefined()

      const appt = a.db.get<{ contact_label: string | null; contact_id: string | null }>(
        `SELECT contact_label, contact_id FROM appointments WHERE tenant_id = ? LIMIT 1`,
        CLINIC_A,
      )
      expect(appt?.contact_id).toBeNull()
      expect(appt?.contact_label).toBe(ANONYMIZED_CONTACT_LABEL)
      expect(listContacts(b.db, CLINIC_B)).toHaveLength(contactsBBefore)
    } finally {
      closeAll()
    }
  })

  it('AC-01: caller de B não opera SQLite de A (tenant mismatch / isolamento)', async () => {
    const { a, closeAll } = await seedPairClinics()
    try {
      expect(() =>
        confirmAppointmentOp(
          a.db,
          workerCaller(CLINIC_B, OWNER_A),
          {
            clientRequestId: 'mvp31-cross',
            serviceId: a.svcPlain.id,
            professionalId: a.pro.id,
            roomResourceId: a.room.id,
            startsAt: zonedCivilToUtc(TZ, 2024, 1, 8, 15, 0),
            contactLabel: 'Invasor',
            actorClerkUserId: OWNER_A,
          },
          a.clock,
        ),
      ).toThrow()
    } finally {
      closeAll()
    }
  })

  it('concorrência de agenda: segundo confirmação no mesmo slot falha', async () => {
    const { a, closeAll } = await seedPairClinics()
    try {
      const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 16, 0)
      confirmAppointmentOp(
        a.db,
        a.caller,
        {
          clientRequestId: 'mvp31-c1',
          serviceId: a.svcPlain.id,
          professionalId: a.pro.id,
          roomResourceId: a.room.id,
          startsAt,
          contactLabel: 'Primeira',
          actorClerkUserId: OWNER_A,
        },
        a.clock,
      )
      expect(() =>
        confirmAppointmentOp(
          a.db,
          a.caller,
          {
            clientRequestId: 'mvp31-c2',
            serviceId: a.svcPlain.id,
            professionalId: a.pro.id,
            roomResourceId: a.room.id,
            startsAt,
            contactLabel: 'Segunda',
            actorClerkUserId: OWNER_A,
          },
          a.clock,
        ),
      ).toThrow(ConflictError)
    } finally {
      closeAll()
    }
  })

  it('AC-07: envio incerto fica unknown sem retry automático', async () => {
    const { a, closeAll } = await seedPairClinics()
    try {
      const sent = sendOutboundMessageOp(
        a.db,
        workerCaller(CLINIC_A, ATT_A),
        {
          conversationId: a.conversation.id,
          body: 'Resposta humana (fictícia)',
          clientRequestId: 'mvp31-uncertain-send',
          authorClerkUserId: ATT_A,
          authorDisplayName: 'Ana',
        },
        a.clock,
      )
      const sendOb = sent.outbox.find((o) => o.type === 'whatsapp.send')!
      applyOutboundSendResultOp(
        a.db,
        queueCaller(CLINIC_A),
        {
          outboundId: sent.value.outbound.id,
          outboxEventId: sendOb.id,
          idempotencyKey: sendOb.idempotencyKey,
          outcome: 'uncertain',
          errorCode: 'meta_timeout',
        },
        a.clock,
      )
      expect(
        findOutboundByClientRequestId(a.db, CLINIC_A, 'mvp31-uncertain-send')!
          .deliveryState,
      ).toBe('unknown')
    } finally {
      closeAll()
    }
  })
})
