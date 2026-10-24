/**
 * Excepções do piloto (#45): concorrência, pagamento duplicado/tardio,
 * estorno falhado, envio incerto — dados sintéticos.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedPixAdapter } from '../pix'
import { ConflictError, NotFoundError, queueCaller, workerCaller } from '../clinic'
import {
  applyOutboundSendResultOp,
  sendOutboundMessageOp,
} from '../clinic/inbox/operations'
import { findOutboundByClientRequestId } from '../clinic/inbox'
import {
  confirmAppointmentOp,
  zonedCivilToUtc,
} from '../clinic/scheduling'
import {
  countAppointmentAllocations,
  createSignalChargeAndSendOp,
  expireDueChargesOp,
  getPixPaymentAlertByCharge,
  listOpenPaymentAlertsOp,
  processPixPaymentOp,
  requestRefundOp,
} from '../clinic/pix'
import {
  ATT_A,
  CLINIC_A,
  CLINIC_B,
  OWNER_A,
  TZ,
  seedPairClinics,
} from './fixtures'

async function createAwaitingCharge(
  seeded: Awaited<ReturnType<typeof seedPairClinics>>['a'],
  adapter: SimulatedPixAdapter,
  clientRequestId: string,
  hour: number,
) {
  const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, hour, 0)
  return createSignalChargeAndSendOp(
    seeded.db,
    seeded.caller,
    {
      clientRequestId,
      conversationId: seeded.conversation.id,
      contactId: seeded.contact.id,
      serviceId: seeded.svcSignal.id,
      professionalId: seeded.pro.id,
      roomResourceId: seeded.room.id,
      startsAt,
      actorClerkUserId: OWNER_A,
    },
    seeded.clock,
    { adapter },
  )
}

describe('MVP-31 — excepções E2E (#45)', () => {
  it('AC-47: pagamento duplicado é idempotente; assinatura de B não altera A', async () => {
    const { a, b, closeAll } = await seedPairClinics()
    try {
      const adapterA = new SimulatedPixAdapter({
        clock: { now: () => new Date(a.clock.nowMs()) },
      })
      const created = await createAwaitingCharge(a, adapterA, 'mvp31-dup-1', 10)
      const paid = await adapterA.simulatePayment(created.charge.providerChargeId!)
      if (!paid.ok) throw new Error('pay fail')
      const evt = await adapterA.validateWebhookEvent(paid.value.envelope)
      if (!evt.ok) throw new Error('evt fail')

      const first = processPixPaymentOp(
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
      expect(first.resolution).toBe('appointment_confirmed')

      const replay = processPixPaymentOp(
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
      expect(replay.idempotentReplay).toBe(true)
      expect(countAppointmentAllocations(a.db, CLINIC_A)).toBe(2)

      // Cobrança desconhecida (ex.: conta/id de B) → recusada em A; B intacto.
      expect(() =>
        processPixPaymentOp(
          a.db,
          a.caller,
          {
            eventId: 'evt_foreign_b',
            eventType: 'charge.paid',
            providerChargeId: 'chg_unknown_b',
            accountId: 'acct_clinic_b_foreign',
            amountCents: 5400,
            occurredAt: new Date(a.clock.nowMs()).toISOString(),
          },
          a.clock,
        ),
      ).toThrow(NotFoundError)
      expect(countAppointmentAllocations(b.db, CLINIC_B)).toBe(0)
      expect(countAppointmentAllocations(a.db, CLINIC_A)).toBe(2)
    } finally {
      closeAll()
    }
  })

  it('AC-48: slot ocupado → pago sem horário + alerta', async () => {
    const { a, closeAll } = await seedPairClinics()
    try {
      const adapter = new SimulatedPixAdapter({
        clock: { now: () => new Date(a.clock.nowMs()) },
      })
      const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 11, 0)
      const created = await createSignalChargeAndSendOp(
        a.db,
        a.caller,
        {
          clientRequestId: 'mvp31-noslot-1',
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

      confirmAppointmentOp(
        a.db,
        a.caller,
        {
          clientRequestId: 'mvp31-manual-occupy',
          serviceId: a.svcPlain.id,
          professionalId: a.pro.id,
          roomResourceId: a.room.id,
          startsAt,
          contactLabel: 'Outra cliente fictícia',
          actorClerkUserId: OWNER_A,
        },
        a.clock,
      )

      const paid = await adapter.simulatePayment(created.charge.providerChargeId!)
      if (!paid.ok) throw new Error('pay fail')
      const evt = await adapter.validateWebhookEvent(paid.value.envelope)
      if (!evt.ok) throw new Error('evt fail')

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
      expect(result.resolution).toBe('paid_without_slot')
      expect(result.reason).toBe('slot_occupied')
      expect(listOpenPaymentAlertsOp(a.db, a.caller, a.clock).length).toBeGreaterThanOrEqual(1)
      expect(countAppointmentAllocations(a.db, CLINIC_A)).toBe(2)
    } finally {
      closeAll()
    }
  })

  it('AC-49: expiração + pagamento tardio → pago sem horário rastreável', async () => {
    const { a, closeAll } = await seedPairClinics()
    try {
      const adapter = new SimulatedPixAdapter({
        clock: { now: () => new Date(a.clock.nowMs()) },
      })
      const created = await createAwaitingCharge(a, adapter, 'mvp31-late-1', 14)
      expect(created.charge.status).toBe('awaiting_payment')

      a.clock.advance(7200 * 1000 + 1000)
      const expired = await expireDueChargesOp(a.db, a.caller, a.clock, { adapter })
      expect(expired.expired.length).toBe(1)
      expect(expired.expired[0]!.charge.status).toBe('expired')

      const latePay = await adapter.simulatePayment(created.charge.providerChargeId!, {
        occurredAt: new Date(a.clock.nowMs()).toISOString(),
      })
      if (!latePay.ok) throw new Error('late pay fail')
      const lateEvt = await adapter.validateWebhookEvent(latePay.value.envelope)
      if (!lateEvt.ok) throw new Error('late evt fail')
      const lateResult = processPixPaymentOp(
        a.db,
        a.caller,
        {
          eventId: lateEvt.value.eventId,
          eventType: 'charge.paid',
          providerChargeId: lateEvt.value.providerChargeId,
          accountId: lateEvt.value.accountId,
          amountCents: lateEvt.value.amountCents,
          occurredAt: lateEvt.value.occurredAt,
        },
        a.clock,
      )
      expect(lateResult.resolution).toBe('paid_without_slot')
      expect(lateResult.reason).toBe('payment_after_expiry')
      expect(
        getPixPaymentAlertByCharge(a.db, CLINIC_A, created.charge.id)?.status,
      ).toBe('open')
    } finally {
      closeAll()
    }
  })

  it('AC-50: estorno falhado não marca Devolvido; retry pode confirmar', async () => {
    const { a, closeAll } = await seedPairClinics()
    try {
      const adapter = new SimulatedPixAdapter({
        clock: { now: () => new Date(a.clock.nowMs()) },
        failNextRefund: true,
      })
      const created = await createAwaitingCharge(a, adapter, 'mvp31-refund-1', 13)
      const paid = await adapter.simulatePayment(created.charge.providerChargeId!)
      if (!paid.ok) throw new Error('pay fail')
      const evt = await adapter.validateWebhookEvent(paid.value.envelope)
      if (!evt.ok) throw new Error('evt fail')
      processPixPaymentOp(
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

      const failed = await requestRefundOp(
        a.db,
        a.caller,
        {
          clientRequestId: 'mvp31-refund-fail',
          chargeId: created.charge.id,
          actorClerkUserId: OWNER_A,
        },
        a.clock,
        { adapter },
      )
      expect(failed.charge.status).toBe('refund_failed')
      expect(failed.refundConfirmed).toBe(false)

      const retry = await requestRefundOp(
        a.db,
        a.caller,
        {
          clientRequestId: 'mvp31-refund-retry',
          chargeId: created.charge.id,
          actorClerkUserId: OWNER_A,
        },
        a.clock,
        { adapter },
      )
      expect(retry.refundConfirmed).toBe(true)
      expect(retry.charge.status).toBe('refunded')
    } finally {
      closeAll()
    }
  })

  it('AC-09: confirmações concorrentes no mesmo profissional/sala — uma só vence', async () => {
    const { a, closeAll } = await seedPairClinics()
    try {
      const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 16, 30)
      const first = confirmAppointmentOp(
        a.db,
        a.caller,
        {
          clientRequestId: 'mvp31-race-1',
          serviceId: a.svcPlain.id,
          professionalId: a.pro.id,
          roomResourceId: a.room.id,
          startsAt,
          contactLabel: 'Cliente 1',
          actorClerkUserId: OWNER_A,
        },
        a.clock,
      )
      expect(first.value.status).toBe('confirmed')
      expect(() =>
        confirmAppointmentOp(
          a.db,
          a.caller,
          {
            clientRequestId: 'mvp31-race-2',
            serviceId: a.svcPlain.id,
            professionalId: a.pro.id,
            roomResourceId: a.room.id,
            startsAt,
            contactLabel: 'Cliente 2',
            actorClerkUserId: OWNER_A,
          },
          a.clock,
        ),
      ).toThrow(ConflictError)
    } finally {
      closeAll()
    }
  })

  it('AC-07: envio incerto não inicia repetição automática', async () => {
    const { a, closeAll } = await seedPairClinics()
    try {
      const sent = sendOutboundMessageOp(
        a.db,
        workerCaller(CLINIC_A, ATT_A),
        {
          conversationId: a.conversation.id,
          body: 'Mensagem com timeout Meta (fictícia)',
          clientRequestId: 'mvp31-exc-uncertain',
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
      const outbound = findOutboundByClientRequestId(
        a.db,
        CLINIC_A,
        'mvp31-exc-uncertain',
      )!
      expect(outbound.deliveryState).toBe('unknown')
      // Sem segundo outbox whatsapp.send automático.
      const sendCount = a.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM outbox_events
         WHERE tenant_id = ? AND type = 'whatsapp.send'`,
        CLINIC_A,
      )
      expect(Number(sendCount?.n ?? 0)).toBe(1)
    } finally {
      closeAll()
    }
  })
})
