/**
 * #40 — pago sem horário, expiração, cancelamento e estorno.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { SimulatedPixAdapter } from '../../pix'
import {
  CLINIC_SCHEMA_VERSION,
  ConflictError,
  workerCaller,
  clinicWhatsapp,
} from '../index'
import { bootClinicDb } from '../test-db'
import {
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { upsertContact } from '../contacts'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { seedSyntheticWhatsappTemplates } from '../inbox/templates'
import {
  confirmAppointmentOp,
  zonedCivilToUtc,
} from '../scheduling'
import {
  cancelPaidAppointmentWithSignalOp,
  cancelUnpaidChargeOp,
  connectPixAccountOp,
  createSignalChargeAndSendOp,
  expireDueChargesOp,
  getPixCharge,
  getPixPaymentAlertByCharge,
  listOpenPaymentAlertsOp,
  processPixLifecycleExpireCancelOp,
  processPixLifecycleRefundOp,
  processPixPaymentOp,
  requestRefundOp,
  resolveAlertAltSlotOp,
  resolveAlertRefundOp,
  updatePixSignalSettingsOp,
} from './index'

const TZ = 'America/Sao_Paulo'

async function seed(
  db: ReturnType<typeof bootClinicDb>['db'],
  clock: ReturnType<typeof createControllableClock>,
) {
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  const pro = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Dra. Paula Reis' },
    clock,
  )
  const room = upsertResourceOp(
    db,
    caller,
    { kind: 'room', name: 'Sala 2', category: 'Sala com laser' },
    clock,
  )
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação a laser — pernas',
      durationMinutes: 60,
      bufferMinutes: 15,
      priceCents: 54_000,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'category', category: 'Sala com laser' },
      requiresSignal: true,
      signalKind: 'fixed',
      signalFixedCents: 5_400,
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: pro.id,
      windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }],
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: room.id,
      windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }],
    },
    clock,
  )
  updatePixSignalSettingsOp(
    db,
    caller,
    {
      deadlineSeconds: 7200,
      cancellationPolicy: 'Sinal devolvido se remarcar com 24h; senão retido.',
    },
    clock,
  )
  const contact = upsertContact(
    db,
    { tenantId, waId: '5511999000040', displayName: 'Bia Costa' },
    clock,
  )
  const conversation = createConversation(
    db,
    { tenantId, contactId: contact.id },
    clock,
  )
  clinicWhatsapp.syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_exc_test',
      phoneNumberId: 'pn_exc',
      wabaId: 'waba_exc',
      displayPhone: '+15550004444',
      action: 'channel_connected',
    },
    clock,
  )
  seedSyntheticWhatsappTemplates(db, tenantId, clock)
  insertMessage(
    db,
    {
      tenantId,
      conversationId: conversation.id,
      direction: 'inbound',
      body: 'oi',
      deliveryState: 'received',
    },
    clock,
  )
  await connectPixAccountOp(
    db,
    caller,
    { appId: 'synth_exc_appid_abcdefgh', clerkUserId: 'user_synth_owner_a' },
    clock,
    { sealKeys: {}, environment: 'synthetic' },
  )
  return { tenantId, caller, pro, room, svc, contact, conversation }
}

async function createPaidWithoutSlot(
  db: ReturnType<typeof bootClinicDb>['db'],
  clock: ReturnType<typeof createControllableClock>,
  seeded: Awaited<ReturnType<typeof seed>>,
  adapter: SimulatedPixAdapter,
) {
  const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 10, 0)
  // Ocupar o horário antes do pagamento.
  confirmAppointmentOp(
    db,
    seeded.caller,
    {
      clientRequestId: 'occupy-slot',
      serviceId: seeded.svc.id,
      professionalId: seeded.pro.id,
      roomResourceId: seeded.room.id,
      startsAt,
      contactLabel: 'Outra cliente',
      actorClerkUserId: 'user_synth_owner_a',
    },
    clock,
  )
  const created = await createSignalChargeAndSendOp(
    db,
    seeded.caller,
    {
      clientRequestId: 'exc-charge-1',
      conversationId: seeded.conversation.id,
      contactId: seeded.contact.id,
      serviceId: seeded.svc.id,
      professionalId: seeded.pro.id,
      roomResourceId: seeded.room.id,
      startsAt,
      actorClerkUserId: 'user_synth_owner_a',
    },
    clock,
    { adapter },
  )
  const paid = await adapter.simulatePayment(created.charge.providerChargeId!)
  expect(paid.ok).toBe(true)
  if (!paid.ok) throw new Error('pay failed')
  const evt = await adapter.validateWebhookEvent(paid.value.envelope)
  expect(evt.ok).toBe(true)
  if (!evt.ok) throw new Error('evt failed')
  const result = processPixPaymentOp(
    db,
    seeded.caller,
    {
      eventId: evt.value.eventId,
      eventType: 'charge.paid',
      providerChargeId: evt.value.providerChargeId,
      accountId: evt.value.accountId,
      amountCents: evt.value.amountCents,
      occurredAt: evt.value.occurredAt,
    },
    clock,
  )
  expect(result.resolution).toBe('paid_without_slot')
  expect(result.alert?.status).toBe('open')
  return { created, result, startsAt }
}

describe('pix exceptions (#40)', () => {
  it('schema v13 ready', () => {
    const { db } = bootClinicDb()
    const state = db.get<{ version: number }>(
      'SELECT version FROM clinic_schema_state WHERE id = 1',
    )
    expect(state?.version).toBe(CLINIC_SCHEMA_VERSION)
    expect(CLINIC_SCHEMA_VERSION).toBe(20)
  })

  it('AC-48: alt horário confirma com sinal pago; conflito preserva alerta', async () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 8, 12, 0, 0))
    const { db } = bootClinicDb({ clock })
    const seeded = await seed(db, clock)
    const adapter = new SimulatedPixAdapter({
      clock: { now: () => new Date(clock.nowMs()) },
    })
    const { result } = await createPaidWithoutSlot(db, clock, seeded, adapter)
    const alertId = result.alert!.id

    // Conflito no mesmo horário — alerta permanece.
    expect(() =>
      resolveAlertAltSlotOp(
        db,
        seeded.caller,
        {
          clientRequestId: 'alt-conflict',
          alertId,
          serviceId: seeded.svc.id,
          professionalId: seeded.pro.id,
          roomResourceId: seeded.room.id,
          startsAt: zonedCivilToUtc(TZ, 2024, 1, 8, 10, 0),
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      ),
    ).toThrow(ConflictError)

    const stillOpen = listOpenPaymentAlertsOp(db, seeded.caller, clock)
    expect(stillOpen.some((a) => a.id === alertId)).toBe(true)
    expect(getPixCharge(db, seeded.tenantId, result.charge.id)?.status).toBe(
      'paid',
    )

    // Horário livre (14h — 10h ocupa até ~11h15 com buffer).
    const alt = resolveAlertAltSlotOp(
      db,
      seeded.caller,
      {
        clientRequestId: 'alt-ok',
        alertId,
        serviceId: seeded.svc.id,
        professionalId: seeded.pro.id,
        roomResourceId: seeded.room.id,
        startsAt: zonedCivilToUtc(TZ, 2024, 1, 8, 14, 0),
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
    )
    expect(alt.alert.status).toBe('resolved')
    expect(alt.alert.resolutionKind).toBe('alt_slot_confirmed')
    expect(alt.charge.paymentResolution).toBe('appointment_confirmed')
    expect(alt.charge.appointmentId).toBe(alt.appointmentId)

    // Retry idempotente.
    const replay = resolveAlertAltSlotOp(
      db,
      seeded.caller,
      {
        clientRequestId: 'alt-ok',
        alertId,
        serviceId: seeded.svc.id,
        professionalId: seeded.pro.id,
        roomResourceId: seeded.room.id,
        startsAt: zonedCivilToUtc(TZ, 2024, 1, 8, 14, 0),
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
    )
    expect(replay.idempotentReplay).toBe(true)
    expect(replay.appointmentId).toBe(alt.appointmentId)
  })

  it('AC-48: devolver sinal; dois retries não duplicam; UI só Devolvido após confirmação', async () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 8, 12, 0, 0))
    const { db } = bootClinicDb({ clock })
    const seeded = await seed(db, clock)
    const adapter = new SimulatedPixAdapter({
      clock: { now: () => new Date(clock.nowMs()) },
    })
    const { result } = await createPaidWithoutSlot(db, clock, seeded, adapter)

    const refund1 = await resolveAlertRefundOp(
      db,
      seeded.caller,
      {
        clientRequestId: 'refund-alert-1',
        alertId: result.alert!.id,
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
      { adapter },
    )
    expect(refund1.refundConfirmed).toBe(true)
    expect(refund1.charge.status).toBe('refunded')
    expect(refund1.alert?.status).toBe('resolved')
    expect(refund1.alert?.resolutionKind).toBe('refunded')

    const refund2 = await resolveAlertRefundOp(
      db,
      seeded.caller,
      {
        clientRequestId: 'refund-alert-1',
        alertId: result.alert!.id,
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
      { adapter },
    )
    expect(refund2.idempotentReplay).toBe(true)
    expect(refund2.charge.status).toBe('refunded')
  })

  it('estorno falhou → tentar de novo; status incerto não marca Devolvido', async () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 8, 12, 0, 0))
    const { db } = bootClinicDb({ clock })
    const seeded = await seed(db, clock)
    const adapter = new SimulatedPixAdapter({
      clock: { now: () => new Date(clock.nowMs()) },
      failNextRefund: true,
    })
    const { result } = await createPaidWithoutSlot(db, clock, seeded, adapter)

    const failed = await requestRefundOp(
      db,
      seeded.caller,
      {
        clientRequestId: 'refund-fail-1',
        chargeId: result.charge.id,
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
      { adapter },
    )
    expect(failed.charge.status).toBe('refund_failed')
    expect(failed.refundConfirmed).toBe(false)
    // Alerta permanece aberto até devolução efectiva.
    expect(
      getPixPaymentAlertByCharge(db, seeded.tenantId, result.charge.id)?.status,
    ).toBe('open')

    const retry = await requestRefundOp(
      db,
      seeded.caller,
      {
        clientRequestId: 'refund-retry-1',
        chargeId: result.charge.id,
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
      { adapter },
    )
    expect(retry.refundConfirmed).toBe(true)
    expect(retry.charge.status).toBe('refunded')
  })

  it('AC-49: expiração local 2h; pagamento tardio fica rastreável (pago sem horário)', async () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 8, 12, 0, 0))
    const { db } = bootClinicDb({ clock })
    const seeded = await seed(db, clock)
    const adapter = new SimulatedPixAdapter({
      clock: { now: () => new Date(clock.nowMs()) },
    })
    const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 14, 0)
    const created = await createSignalChargeAndSendOp(
      db,
      seeded.caller,
      {
        clientRequestId: 'exp-charge',
        conversationId: seeded.conversation.id,
        contactId: seeded.contact.id,
        serviceId: seeded.svc.id,
        professionalId: seeded.pro.id,
        roomResourceId: seeded.room.id,
        startsAt,
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
      { adapter },
    )
    expect(created.charge.status).toBe('awaiting_payment')
    expect(created.charge.deadlineSecondsSnapshot).toBe(7200)

    // Avança além do prazo.
    clock.advance(7200 * 1000 + 1000)
    const expired = await expireDueChargesOp(db, seeded.caller, clock, {
      adapter,
    })
    expect(expired.expired.length).toBe(1)
    expect(expired.expired[0]!.charge.status).toBe('expired')
    expect(
      expired.expired[0]!.outbox.some((o) => o.type === 'cobranca.expirada'),
    ).toBe(true)

    // Pagamento tardio no provedor → pago sem horário (dinheiro rastreável).
    const paid = await adapter.simulatePayment(created.charge.providerChargeId!, {
      occurredAt: new Date(clock.nowMs()).toISOString(),
    })
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    const evt = await adapter.validateWebhookEvent(paid.value.envelope)
    if (!evt.ok) return
    const late = processPixPaymentOp(
      db,
      seeded.caller,
      {
        eventId: evt.value.eventId,
        eventType: 'charge.paid',
        providerChargeId: evt.value.providerChargeId,
        accountId: evt.value.accountId,
        amountCents: evt.value.amountCents,
        occurredAt: evt.value.occurredAt,
      },
      clock,
    )
    expect(late.resolution).toBe('paid_without_slot')
    expect(late.reason).toBe('payment_after_expiry')
    expect(late.charge.status).toBe('paid')
  })

  it('AC-49: cancelar cobrança não paga; webhook expired reconcilia', async () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 8, 12, 0, 0))
    const { db } = bootClinicDb({ clock })
    const seeded = await seed(db, clock)
    const adapter = new SimulatedPixAdapter({
      clock: { now: () => new Date(clock.nowMs()) },
    })
    const created = await createSignalChargeAndSendOp(
      db,
      seeded.caller,
      {
        clientRequestId: 'cancel-unpaid',
        conversationId: seeded.conversation.id,
        contactId: seeded.contact.id,
        serviceId: seeded.svc.id,
        professionalId: seeded.pro.id,
        roomResourceId: seeded.room.id,
        startsAt: zonedCivilToUtc(TZ, 2024, 1, 8, 15, 0),
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
      { adapter },
    )

    const cancelled = await cancelUnpaidChargeOp(
      db,
      seeded.caller,
      {
        clientRequestId: 'cancel-1',
        chargeId: created.charge.id,
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
      { adapter },
    )
    expect(cancelled.charge.status).toBe('cancelled')
    expect(
      cancelled.outbox.some((o) => o.type === 'cobranca.cancelada'),
    ).toBe(true)

    const replay = await cancelUnpaidChargeOp(
      db,
      seeded.caller,
      {
        clientRequestId: 'cancel-1',
        chargeId: created.charge.id,
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
      { adapter },
    )
    expect(replay.idempotentReplay).toBe(true)

    // Webhook expired sobre já cancelada → ignore/idempotente.
    const expWh = await adapter.simulateExpirationWebhook(
      created.charge.providerChargeId!,
    )
    expect(expWh.ok).toBe(true)
    if (!expWh.ok) return
    const evt = await adapter.validateWebhookEvent(expWh.value.envelope)
    if (!evt.ok) return
    const life = processPixLifecycleExpireCancelOp(
      db,
      seeded.caller,
      {
        eventId: evt.value.eventId,
        eventType: 'charge.expired',
        providerChargeId: evt.value.providerChargeId,
        accountId: evt.value.accountId,
        amountCents: evt.value.amountCents,
        occurredAt: evt.value.occurredAt,
      },
      clock,
    )
    expect(life.charge.status).toBe('cancelled')
  })

  it('AC-50: cancelar compromisso pago exige Devolver/Reter; reserva ≠ sucesso financeiro', async () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 8, 12, 0, 0))
    const { db } = bootClinicDb({ clock })
    const seeded = await seed(db, clock)
    const adapter = new SimulatedPixAdapter({
      clock: { now: () => new Date(clock.nowMs()) },
      failNextRefund: true,
    })
    const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 10, 0)
    const created = await createSignalChargeAndSendOp(
      db,
      seeded.caller,
      {
        clientRequestId: 'paid-apt',
        conversationId: seeded.conversation.id,
        contactId: seeded.contact.id,
        serviceId: seeded.svc.id,
        professionalId: seeded.pro.id,
        roomResourceId: seeded.room.id,
        startsAt,
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
      { adapter },
    )
    const paid = await adapter.simulatePayment(created.charge.providerChargeId!)
    if (!paid.ok) return
    const evt = await adapter.validateWebhookEvent(paid.value.envelope)
    if (!evt.ok) return
    const confirmed = processPixPaymentOp(
      db,
      seeded.caller,
      {
        eventId: evt.value.eventId,
        eventType: 'charge.paid',
        providerChargeId: evt.value.providerChargeId,
        accountId: evt.value.accountId,
        amountCents: evt.value.amountCents,
        occurredAt: evt.value.occurredAt,
      },
      clock,
    )
    expect(confirmed.appointmentId).toBeTruthy()

    const cancelled = await cancelPaidAppointmentWithSignalOp(
      db,
      seeded.caller,
      {
        clientRequestId: 'cancel-paid-1',
        appointmentId: confirmed.appointmentId!,
        reason: 'contato_desistiu',
        signalDisposition: 'refund',
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
      { adapter },
    )
    expect(cancelled.appointment.status).toBe('cancelled')
    expect(cancelled.charge?.signalDisposition).toBe('refund')
    expect(cancelled.charge?.signalDispositionBy).toBe('user_synth_owner_a')
    // Reserva cancelada mesmo com estorno falho.
    expect(cancelled.refund?.refundConfirmed).toBe(false)
    expect(cancelled.charge?.status).toBe('refund_failed')

    // Reter sem estorno (14h — janela até 18h; 75 min de ocupação).
    const startsAt2 = zonedCivilToUtc(TZ, 2024, 1, 8, 14, 0)
    const created2 = await createSignalChargeAndSendOp(
      db,
      seeded.caller,
      {
        clientRequestId: 'paid-apt-2',
        conversationId: seeded.conversation.id,
        contactId: seeded.contact.id,
        serviceId: seeded.svc.id,
        professionalId: seeded.pro.id,
        roomResourceId: seeded.room.id,
        startsAt: startsAt2,
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
      { adapter },
    )
    const paid2 = await adapter.simulatePayment(created2.charge.providerChargeId!)
    if (!paid2.ok) return
    const evt2 = await adapter.validateWebhookEvent(paid2.value.envelope)
    if (!evt2.ok) return
    const confirmed2 = processPixPaymentOp(
      db,
      seeded.caller,
      {
        eventId: evt2.value.eventId,
        eventType: 'charge.paid',
        providerChargeId: evt2.value.providerChargeId,
        accountId: evt2.value.accountId,
        amountCents: evt2.value.amountCents,
        occurredAt: evt2.value.occurredAt,
      },
      clock,
    )
    expect(confirmed2.resolution).toBe('appointment_confirmed')
    expect(confirmed2.appointmentId).toBeTruthy()
    const retained = await cancelPaidAppointmentWithSignalOp(
      db,
      seeded.caller,
      {
        clientRequestId: 'cancel-retain-1',
        appointmentId: confirmed2.appointmentId!,
        reason: 'nao_compareceu',
        signalDisposition: 'retain',
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
      { adapter },
    )
    expect(retained.appointment.status).toBe('cancelled')
    expect(retained.charge?.signalDisposition).toBe('retain')
    expect(retained.charge?.status).toBe('paid')
    expect(retained.refund).toBeNull()
  })

  it('webhook refund.updated confirma Devolvido; aviso expired após pago = rasto', async () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 8, 12, 0, 0))
    const { db } = bootClinicDb({ clock })
    const seeded = await seed(db, clock)
    const adapter = new SimulatedPixAdapter({
      clock: { now: () => new Date(clock.nowMs()) },
    })
    const { result } = await createPaidWithoutSlot(db, clock, seeded, adapter)

    // Marca solicitado localmente sem confirmar ainda.
    db.run(
      `UPDATE pix_charges SET status = 'refund_requested',
        refund_idempotency_key = ?, refund_requested_at = ?, updated_at = ?
       WHERE id = ?`,
      `pixrefund:${result.charge.id}`,
      clock.nowMs(),
      clock.nowMs(),
      result.charge.id,
    )

    const life = processPixLifecycleRefundOp(
      db,
      seeded.caller,
      {
        eventId: 'rfnd_evt_1',
        eventType: 'refund.updated',
        providerChargeId: result.charge.providerChargeId!,
        accountId: result.charge.accountId,
        amountCents: result.charge.amountCents,
        occurredAt: new Date(clock.nowMs()).toISOString(),
        refund: {
          providerRefundId: 'rfnd_1',
          status: 'succeeded',
          amountCents: result.charge.amountCents,
        },
      },
      clock,
    )
    expect(life.charge.status).toBe('refunded')
    expect(life.refundConfirmed).toBe(true)
    expect(life.alert?.status).toBe('resolved')

    // Expired tardio após pago/refunded — mantém rasto.
    const lateExp = processPixLifecycleExpireCancelOp(
      db,
      seeded.caller,
      {
        eventId: 'late_exp_1',
        eventType: 'charge.expired',
        providerChargeId: result.charge.providerChargeId!,
        accountId: result.charge.accountId,
        amountCents: result.charge.amountCents,
        occurredAt: new Date(clock.nowMs()).toISOString(),
      },
      clock,
    )
    expect(lateExp.charge.status).toBe('refunded')
  })
})
