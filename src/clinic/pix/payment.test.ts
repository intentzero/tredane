/**
 * #39 — pagamento Pix → confirmação atómica / pago sem horário.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { SimulatedPixAdapter } from '../../pix'
import {
  CLINIC_SCHEMA_VERSION,
  ValidationError,
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
import { countAppointmentAllocations } from './charges'
import {
  connectPixAccountOp,
  createSignalChargeAndSendOp,
  listOpenPaymentAlertsOp,
  processPixPaymentOp,
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
  const contact = upsertContact(
    db,
    { tenantId, waId: '5511999000011', displayName: 'Ana Silva' },
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
      bindingId: 'bind_pay_test',
      phoneNumberId: 'pn_pay',
      wabaId: 'waba_pay',
      displayPhone: '+15550001111',
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
    { appId: 'synth_pay_appid_abcdefgh', clerkUserId: 'user_synth_owner_a' },
    clock,
    { sealKeys: {}, environment: 'synthetic' },
  )
  return { tenantId, caller, pro, room, svc, contact, conversation }
}

describe('pix payment → atomic confirm (#39)', () => {
  it('schema v12 ready', () => {
    const { db, clock } = bootClinicDb()
    const state = db.get<{ version: number }>('SELECT version FROM clinic_schema_state WHERE id = 1')
    expect(state?.version).toBe(CLINIC_SCHEMA_VERSION)
    expect(CLINIC_SCHEMA_VERSION).toBe(23)
    void clock
  })

  it('AC-47: pagamento confirma horário livre; duplicata idempotente', async () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 8, 12, 0, 0))
    const { db } = bootClinicDb({ clock })
    const seeded = await seed(db, clock)
    const adapter = new SimulatedPixAdapter({
      clock: { now: () => new Date(clock.nowMs()) },
    })
    const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 10, 0)

    const created = await createSignalChargeAndSendOp(
      db,
      seeded.caller,
      {
        clientRequestId: 'pay-confirm-1',
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
    expect(countAppointmentAllocations(db, seeded.tenantId)).toBe(0)

    const paid = await adapter.simulatePayment(created.charge.providerChargeId!)
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    const evt = await adapter.validateWebhookEvent(paid.value.envelope)
    expect(evt.ok).toBe(true)
    if (!evt.ok) return

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
    expect(result.resolution).toBe('appointment_confirmed')
    expect(result.appointmentId).toBeTruthy()
    expect(result.charge.status).toBe('paid')
    expect(result.charge.paymentResolution).toBe('appointment_confirmed')
    expect(countAppointmentAllocations(db, seeded.tenantId)).toBe(2)
    expect(result.outbox.some((o) => o.type === 'cobranca.paga')).toBe(true)
    expect(result.outbox.some((o) => o.type === 'appointment.confirmed')).toBe(
      true,
    )

    const replay = processPixPaymentOp(
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
    expect(replay.idempotentReplay).toBe(true)
    expect(replay.appointmentId).toBe(result.appointmentId)
    expect(countAppointmentAllocations(db, seeded.tenantId)).toBe(2)
  })

  it('AC-48: slot ocupado → pago sem horário + alerta durável', async () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 8, 12, 0, 0))
    const { db } = bootClinicDb({ clock })
    const seeded = await seed(db, clock)
    const adapter = new SimulatedPixAdapter({
      clock: { now: () => new Date(clock.nowMs()) },
    })
    const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 11, 0)

    const created = await createSignalChargeAndSendOp(
      db,
      seeded.caller,
      {
        clientRequestId: 'pay-conflict-1',
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

    // Reserva manual ocupa o horário antes do pagamento.
    confirmAppointmentOp(
      db,
      seeded.caller,
      {
        clientRequestId: 'manual-book-1',
        serviceId: seeded.svc.id,
        professionalId: seeded.pro.id,
        roomResourceId: seeded.room.id,
        startsAt,
        actorClerkUserId: 'user_synth_owner_a',
        contactLabel: 'Outra cliente',
      },
      clock,
    )

    const paid = await adapter.simulatePayment(created.charge.providerChargeId!)
    if (!paid.ok) throw new Error('simulate failed')
    const evt = await adapter.validateWebhookEvent(paid.value.envelope)
    if (!evt.ok) throw new Error('validate failed')

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
    expect(result.appointmentId).toBeNull()
    expect(result.reason).toBe('slot_occupied')
    expect(result.alert?.status).toBe('open')
    expect(result.charge.paymentResolution).toBe('paid_without_slot')
    expect(result.outbox.some((o) => o.type === 'cobranca.sem_horario')).toBe(
      true,
    )

    const alerts = listOpenPaymentAlertsOp(db, seeded.caller, clock)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.chargeId).toBe(created.charge.id)

    // Só uma reserva (a manual) — pagamento não criou compromisso.
    expect(countAppointmentAllocations(db, seeded.tenantId)).toBe(2)
  })

  it('pagamento tardio após expires_at → pago sem horário (não ressuscita)', async () => {
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
        clientRequestId: 'pay-late-1',
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

    const expiresAt = created.charge.expiresAt!
    const latePaidAt = new Date(expiresAt + 60_000).toISOString()
    const paid = await adapter.simulatePayment(created.charge.providerChargeId!, {
      occurredAt: latePaidAt,
    })
    if (!paid.ok) throw new Error('simulate failed')
    const evt = await adapter.validateWebhookEvent(paid.value.envelope)
    if (!evt.ok) throw new Error('validate failed')

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
    expect(result.reason).toBe('payment_after_expiry')
    expect(countAppointmentAllocations(db, seeded.tenantId)).toBe(0)
  })

  it('nega conta/valor errados; cobrança desconhecida', async () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 8, 12, 0, 0))
    const { db } = bootClinicDb({ clock })
    const seeded = await seed(db, clock)
    const adapter = new SimulatedPixAdapter({
      clock: { now: () => new Date(clock.nowMs()) },
    })
    const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 15, 0)

    const created = await createSignalChargeAndSendOp(
      db,
      seeded.caller,
      {
        clientRequestId: 'pay-reject-1',
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

    expect(() =>
      processPixPaymentOp(
        db,
        seeded.caller,
        {
          eventId: 'evt_bad_account',
          eventType: 'charge.paid',
          providerChargeId: created.charge.providerChargeId!,
          accountId: 'wrong-account',
          amountCents: created.charge.amountCents,
          occurredAt: new Date(clock.nowMs()).toISOString(),
        },
        clock,
      ),
    ).toThrow(ValidationError)

    expect(() =>
      processPixPaymentOp(
        db,
        seeded.caller,
        {
          eventId: 'evt_bad_amount',
          eventType: 'charge.paid',
          providerChargeId: created.charge.providerChargeId!,
          accountId: created.charge.accountId,
          amountCents: created.charge.amountCents + 1,
          occurredAt: new Date(clock.nowMs()).toISOString(),
        },
        clock,
      ),
    ).toThrow(ValidationError)

    expect(() =>
      processPixPaymentOp(
        db,
        seeded.caller,
        {
          eventId: 'evt_unknown',
          eventType: 'charge.paid',
          providerChargeId: 'unknown_charge_xyz',
          accountId: created.charge.accountId,
          amountCents: 100,
          occurredAt: new Date(clock.nowMs()).toISOString(),
        },
        clock,
      ),
    ).toThrow(/não encontrada|not_found|desconhecida/i)
  })

  it('isolamento A/B: pagamento de B não altera A', async () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 8, 12, 0, 0))
    const { db: dbA } = bootClinicDb({ clock })
    const { db: dbB } = bootClinicDb({ clock })
    const a = await seed(dbA, clock)
    const callerB = workerCaller('clinic-demo-b', 'owner_b')
    const proB = upsertResourceOp(
      dbB,
      callerB,
      { kind: 'professional', name: 'Pro B' },
      clock,
    )
    const roomB = upsertResourceOp(
      dbB,
      callerB,
      { kind: 'room', name: 'Sala B', category: 'Sala com laser' },
      clock,
    )
    const svcB = upsertServiceOp(
      dbB,
      callerB,
      {
        name: 'Svc B',
        durationMinutes: 60,
        bufferMinutes: 15,
        priceCents: 10_000,
        professionalIds: [proB.id],
        roomRequirement: { mode: 'category', category: 'Sala com laser' },
        requiresSignal: true,
        signalKind: 'fixed',
        signalFixedCents: 1_000,
      },
      clock,
    )
    setWeeklyWindowsOp(
      dbB,
      callerB,
      {
        resourceId: proB.id,
        windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }],
      },
      clock,
    )
    setWeeklyWindowsOp(
      dbB,
      callerB,
      {
        resourceId: roomB.id,
        windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }],
      },
      clock,
    )
    const contactB = upsertContact(
      dbB,
      { tenantId: 'clinic-demo-b', waId: '5511888000022', displayName: 'B' },
      clock,
    )
    const convB = createConversation(
      dbB,
      { tenantId: 'clinic-demo-b', contactId: contactB.id },
      clock,
    )
    clinicWhatsapp.syncWhatsappChannel(
      dbB,
      'clinic-demo-b',
      {
        status: 'connected',
        bindingId: 'bind_b',
        phoneNumberId: 'pn_b',
        wabaId: 'waba_b',
        displayPhone: '+15550002222',
        action: 'channel_connected',
      },
      clock,
    )
    seedSyntheticWhatsappTemplates(dbB, 'clinic-demo-b', clock)
    insertMessage(
      dbB,
      {
        tenantId: 'clinic-demo-b',
        conversationId: convB.id,
        direction: 'inbound',
        body: 'oi',
        deliveryState: 'received',
      },
      clock,
    )
    await connectPixAccountOp(
      dbB,
      callerB,
      { appId: 'synth_pay_b_appid_abcdef', clerkUserId: 'owner_b' },
      clock,
      { sealKeys: {}, environment: 'synthetic' },
    )

    const adapterA = new SimulatedPixAdapter({
      clock: { now: () => new Date(clock.nowMs()) },
    })
    const adapterB = new SimulatedPixAdapter({
      clock: { now: () => new Date(clock.nowMs()) },
    })
    const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 16, 0)

    const chargeA = await createSignalChargeAndSendOp(
      dbA,
      a.caller,
      {
        clientRequestId: 'iso-a',
        conversationId: a.conversation.id,
        contactId: a.contact.id,
        serviceId: a.svc.id,
        professionalId: a.pro.id,
        roomResourceId: a.room.id,
        startsAt,
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
      { adapter: adapterA },
    )
    const chargeB = await createSignalChargeAndSendOp(
      dbB,
      callerB,
      {
        clientRequestId: 'iso-b',
        conversationId: convB.id,
        contactId: contactB.id,
        serviceId: svcB.id,
        professionalId: proB.id,
        roomResourceId: roomB.id,
        startsAt,
        actorClerkUserId: 'owner_b',
      },
      clock,
      { adapter: adapterB },
    )

    const paidB = await adapterB.simulatePayment(chargeB.charge.providerChargeId!)
    if (!paidB.ok) throw new Error('sim B')
    const evtB = await adapterB.validateWebhookEvent(paidB.value.envelope)
    if (!evtB.ok) throw new Error('val B')

    // Evento de B no DO de A → cobrança desconhecida
    expect(() =>
      processPixPaymentOp(
        dbA,
        a.caller,
        {
          eventId: evtB.value.eventId,
          eventType: 'charge.paid',
          providerChargeId: evtB.value.providerChargeId,
          accountId: evtB.value.accountId,
          amountCents: evtB.value.amountCents,
          occurredAt: evtB.value.occurredAt,
        },
        clock,
      ),
    ).toThrow()

    expect(chargeA.charge.status).toBe('awaiting_payment')
    expect(countAppointmentAllocations(dbA, a.tenantId)).toBe(0)
  })

  it('corrida: dois pagamentos / um slot → no máximo um compromisso', async () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 8, 12, 0, 0))
    const { db } = bootClinicDb({ clock })
    const seeded = await seed(db, clock)
    const adapter = new SimulatedPixAdapter({
      clock: { now: () => new Date(clock.nowMs()) },
    })
    const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 9, 0)

    // Duas conversas / duas cobranças para o mesmo slot.
    const contact2 = upsertContact(
      db,
      {
        tenantId: seeded.tenantId,
        waId: '5511999000099',
        displayName: 'Bruno',
      },
      clock,
    )
    const conv2 = createConversation(
      db,
      { tenantId: seeded.tenantId, contactId: contact2.id },
      clock,
    )
    insertMessage(
      db,
      {
        tenantId: seeded.tenantId,
        conversationId: conv2.id,
        direction: 'inbound',
        body: 'oi',
        deliveryState: 'received',
      },
      clock,
    )

    const c1 = await createSignalChargeAndSendOp(
      db,
      seeded.caller,
      {
        clientRequestId: 'race-1',
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
    const c2 = await createSignalChargeAndSendOp(
      db,
      seeded.caller,
      {
        clientRequestId: 'race-2',
        conversationId: conv2.id,
        contactId: contact2.id,
        serviceId: seeded.svc.id,
        professionalId: seeded.pro.id,
        roomResourceId: seeded.room.id,
        startsAt,
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
      { adapter },
    )

    const p1 = await adapter.simulatePayment(c1.charge.providerChargeId!)
    const p2 = await adapter.simulatePayment(c2.charge.providerChargeId!)
    if (!p1.ok || !p2.ok) throw new Error('sim')
    const e1 = await adapter.validateWebhookEvent(p1.value.envelope)
    const e2 = await adapter.validateWebhookEvent(p2.value.envelope)
    if (!e1.ok || !e2.ok) throw new Error('val')

    const r1 = processPixPaymentOp(
      db,
      seeded.caller,
      {
        eventId: e1.value.eventId,
        eventType: 'charge.paid',
        providerChargeId: e1.value.providerChargeId,
        accountId: e1.value.accountId,
        amountCents: e1.value.amountCents,
        occurredAt: e1.value.occurredAt,
      },
      clock,
    )
    const r2 = processPixPaymentOp(
      db,
      seeded.caller,
      {
        eventId: e2.value.eventId,
        eventType: 'charge.paid',
        providerChargeId: e2.value.providerChargeId,
        accountId: e2.value.accountId,
        amountCents: e2.value.amountCents,
        occurredAt: e2.value.occurredAt,
      },
      clock,
    )

    const confirmed = [r1, r2].filter(
      (r) => r.resolution === 'appointment_confirmed',
    )
    const without = [r1, r2].filter((r) => r.resolution === 'paid_without_slot')
    expect(confirmed).toHaveLength(1)
    expect(without).toHaveLength(1)
    expect(countAppointmentAllocations(db, seeded.tenantId)).toBe(2)
  })
})
