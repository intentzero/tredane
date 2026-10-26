import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { SimulatedPixAdapter } from '../../pix'
import {
  CLINIC_SCHEMA_VERSION,
  ValidationError,
  clinicWhatsapp,
  workerCaller,
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
import { queryAvailabilityOp, zonedCivilToUtc } from '../scheduling'
import {
  connectPixAccountOp,
  countAppointmentAllocations,
  createSignalChargeAndSendOp,
  confirmWithoutSignalOp,
  listConversationPixChargesOp,
  reconcileUncertainChargeOp,
} from './index'
import { createWooviSandboxFixture } from '../../pix'

const TZ = 'America/Sao_Paulo'
const MONDAY = '2024-01-08'

async function seedSignalClinic(
  db: ReturnType<typeof bootClinicDb>['db'],
  clock: ReturnType<typeof createControllableClock>,
  options?: { connectWa?: boolean; inboundRecent?: boolean },
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
    {
      tenantId,
      waId: '5511999000011',
      displayName: 'Ana Silva',
    },
    clock,
  )
  const conversation = createConversation(
    db,
    { tenantId, contactId: contact.id },
    clock,
  )

  if (options?.connectWa !== false) {
    clinicWhatsapp.syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'bind_signal_test',
        phoneNumberId: 'pn_signal',
        wabaId: 'waba_signal',
        displayPhone: '+15550001111',
        action: 'channel_connected',
      },
      clock,
    )
    seedSyntheticWhatsappTemplates(db, tenantId, clock)
  }

  if (options?.inboundRecent !== false) {
    insertMessage(
      db,
      {
        tenantId,
        conversationId: conversation.id,
        direction: 'inbound',
        body: 'Oi, quero agendar',
        deliveryState: 'delivered',
        createdAt: clock.nowMs() - 60_000,
      },
      clock,
    )
  }

  const sandbox = await createWooviSandboxFixture()
  const appId = 'synth_signal_charge_app_001'
  sandbox.addValidAppId(appId)
  await connectPixAccountOp(
    db,
    caller,
    { appId, clerkUserId: 'user_synth_owner_a', environment: 'synthetic' },
    clock,
    {
      environment: 'synthetic',
      fetchImpl: sandbox.fetchImpl,
      baseUrl: sandbox.baseUrl,
      webhookPublicKeys: [sandbox.publicPem],
      sealKeys: {},
    },
  )

  const startsAt = zonedCivilToUtc(TZ, 2024, 1, 8, 14, 0)
  return {
    caller,
    tenantId,
    pro,
    room,
    svc,
    contact,
    conversation,
    startsAt,
    sandbox,
    appId,
  }
}

describe('sinal Pix na conversa sem reservar (#38)', () => {
  it('migra schema 11 com scheduling_intents e pix_charge_commands', () => {
    const { db, close } = bootClinicDb()
    try {
      expect(
        db.get<{ version: number }>(
          'SELECT version FROM clinic_schema_state WHERE id = 1',
        )?.version,
      ).toBe(CLINIC_SCHEMA_VERSION)
      expect(
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='scheduling_intents'`,
        )?.n,
      ).toBe(1)
      expect(
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='pix_charge_commands'`,
        )?.n,
      ).toBe(1)
    } finally {
      close()
    }
  })

  it('cria cobrança + mensagem e não aloca horário (AC-46)', async () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 8, 12, 0, 0))
    const { db, close } = bootClinicDb({ clock })
    const adapter = new SimulatedPixAdapter({
      clock: { now: () => new Date(clock.nowMs()) },
    })
    try {
      const ctx = await seedSignalClinic(db, clock)
      const beforeAlloc = countAppointmentAllocations(db, ctx.tenantId)

      const result = await createSignalChargeAndSendOp(
        db,
        ctx.caller,
        {
          clientRequestId: 'req-signal-1',
          conversationId: ctx.conversation.id,
          contactId: ctx.contact.id,
          serviceId: ctx.svc.id,
          professionalId: ctx.pro.id,
          roomResourceId: ctx.room.id,
          startsAt: ctx.startsAt,
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
        { adapter },
      )

      expect(result.idempotentReplay).toBe(false)
      expect(result.charge.status).toBe('awaiting_payment')
      expect(result.charge.providerCreateState).toBe('confirmed')
      expect(result.charge.amountCents).toBe(5_400)
      expect(result.charge.pixCopyPaste).toBeTruthy()
      expect(result.intent.status).toBe('awaiting_signal')
      expect(result.messageId).toBeTruthy()
      expect(result.whatsappSendError).toBeNull()
      expect(countAppointmentAllocations(db, ctx.tenantId)).toBe(beforeAlloc)

      const avail = queryAvailabilityOp(
        db,
        ctx.caller,
        {
          serviceId: ctx.svc.id,
          date: MONDAY,
          professionalId: ctx.pro.id,
        },
        clock,
      )
      expect(
        avail.slots.some(
          (s) =>
            s.startsAt === ctx.startsAt
            && s.professionalId === ctx.pro.id,
        ),
      ).toBe(true)

      const listed = listConversationPixChargesOp(
        db,
        ctx.caller,
        ctx.conversation.id,
        clock,
      )
      expect(listed).toHaveLength(1)
      expect(listed[0]?.id).toBe(result.charge.id)
    } finally {
      close()
    }
  })

  it('mesmo clientRequestId não duplica cobrança', async () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 8, 12, 0, 0))
    const { db, close } = bootClinicDb({ clock })
    const adapter = new SimulatedPixAdapter({
      clock: { now: () => new Date(clock.nowMs()) },
    })
    try {
      const ctx = await seedSignalClinic(db, clock)
      const input = {
        clientRequestId: 'req-signal-idem',
        conversationId: ctx.conversation.id,
        contactId: ctx.contact.id,
        serviceId: ctx.svc.id,
        professionalId: ctx.pro.id,
        roomResourceId: ctx.room.id,
        startsAt: ctx.startsAt,
        actorClerkUserId: 'user_synth_owner_a',
      }
      const first = await createSignalChargeAndSendOp(
        db,
        ctx.caller,
        input,
        clock,
        { adapter },
      )
      const second = await createSignalChargeAndSendOp(
        db,
        ctx.caller,
        input,
        clock,
        { adapter },
      )
      expect(second.idempotentReplay).toBe(true)
      expect(second.charge.id).toBe(first.charge.id)
      expect(
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM pix_charges WHERE tenant_id = ?`,
          ctx.tenantId,
        )?.n,
      ).toBe(1)
      const found = await adapter.findChargeByIdempotencyKey('req-signal-idem')
      expect(found.ok).toBe(true)
    } finally {
      close()
    }
  })

  it('timeout/uncertain fica reconciliável sem nova cobrança cega', async () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 8, 12, 0, 0))
    const { db, close } = bootClinicDb({ clock })
    const adapter = new SimulatedPixAdapter({
      clock: { now: () => new Date(clock.nowMs()) },
      uncertainNextCreate: true,
    })
    try {
      const ctx = await seedSignalClinic(db, clock)
      const result = await createSignalChargeAndSendOp(
        db,
        ctx.caller,
        {
          clientRequestId: 'req-uncertain-1',
          conversationId: ctx.conversation.id,
          contactId: ctx.contact.id,
          serviceId: ctx.svc.id,
          professionalId: ctx.pro.id,
          roomResourceId: ctx.room.id,
          startsAt: ctx.startsAt,
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
        { adapter },
      )
      expect(result.charge.providerCreateState).toBe('uncertain')
      expect(result.messageId).toBeNull()

      const reconciled = await reconcileUncertainChargeOp(
        db,
        ctx.caller,
        result.charge.id,
        clock,
        {
          adapter,
          findByIdempotencyKey: (key) => adapter.findChargeByIdempotencyKey(key),
        },
      )
      expect(reconciled.charge.providerCreateState).toBe('confirmed')
      expect(reconciled.charge.providerChargeId).toBeTruthy()
      const found = await adapter.findChargeByIdempotencyKey('req-uncertain-1')
      expect(found.ok).toBe(true)
    } finally {
      close()
    }
  })

  it('fora da janela 24h usa template tredane_cobranca_sinal_pix', async () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 8, 12, 0, 0))
    const { db, close } = bootClinicDb({ clock })
    const adapter = new SimulatedPixAdapter({
      clock: { now: () => new Date(clock.nowMs()) },
    })
    try {
      const ctx = await seedSignalClinic(db, clock, { inboundRecent: false })
      // inbound antigo (>24h)
      insertMessage(
        db,
        {
          tenantId: ctx.tenantId,
          conversationId: ctx.conversation.id,
          direction: 'inbound',
          body: 'mensagem antiga',
          deliveryState: 'delivered',
          createdAt: clock.nowMs() - 25 * 60 * 60 * 1000,
        },
        clock,
      )

      const result = await createSignalChargeAndSendOp(
        db,
        ctx.caller,
        {
          clientRequestId: 'req-tpl-1',
          conversationId: ctx.conversation.id,
          contactId: ctx.contact.id,
          serviceId: ctx.svc.id,
          professionalId: ctx.pro.id,
          roomResourceId: ctx.room.id,
          startsAt: ctx.startsAt,
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
        { adapter },
      )
      expect(result.messageId).toBeTruthy()
      const outbound = db.get<{ template_name: string; kind: string }>(
        `SELECT template_name, kind FROM outbound_messages WHERE tenant_id = ? AND message_id = ?`,
        ctx.tenantId,
        result.messageId,
      )
      expect(outbound?.kind).toBe('template')
      expect(outbound?.template_name).toBe('tredane_cobranca_sinal_pix')
    } finally {
      close()
    }
  })

  it('falha WhatsApp não cancela nem duplica cobrança', async () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 8, 12, 0, 0))
    const { db, close } = bootClinicDb({ clock })
    const adapter = new SimulatedPixAdapter({
      clock: { now: () => new Date(clock.nowMs()) },
    })
    try {
      const ctx = await seedSignalClinic(db, clock, { connectWa: false })
      const result = await createSignalChargeAndSendOp(
        db,
        ctx.caller,
        {
          clientRequestId: 'req-wa-fail',
          conversationId: ctx.conversation.id,
          contactId: ctx.contact.id,
          serviceId: ctx.svc.id,
          professionalId: ctx.pro.id,
          roomResourceId: ctx.room.id,
          startsAt: ctx.startsAt,
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
        { adapter },
      )
      expect(result.charge.status).toBe('awaiting_payment')
      expect(result.charge.providerCreateState).toBe('confirmed')
      expect(result.whatsappSendError).toMatch(/WhatsApp/i)
      expect(result.messageId).toBeNull()
      expect(
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM pix_charges WHERE tenant_id = ?`,
          ctx.tenantId,
        )?.n,
      ).toBe(1)
    } finally {
      close()
    }
  })

  it('Confirmar sem sinal exige motivo e confirma com alocação (AC-51)', async () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 8, 12, 0, 0))
    const { db, close } = bootClinicDb({ clock })
    const adapter = new SimulatedPixAdapter({
      clock: { now: () => new Date(clock.nowMs()) },
    })
    try {
      const ctx = await seedSignalClinic(db, clock)

      await expect(
        confirmWithoutSignalOp(
          db,
          ctx.caller,
          {
            clientRequestId: 'req-waive-bad',
            conversationId: ctx.conversation.id,
            contactId: ctx.contact.id,
            serviceId: ctx.svc.id,
            professionalId: ctx.pro.id,
            roomResourceId: ctx.room.id,
            startsAt: ctx.startsAt,
            waiveReason: '   ',
            actorClerkUserId: 'user_synth_owner_a',
          },
          clock,
          { adapter },
        ),
      ).rejects.toBeInstanceOf(ValidationError)

      // Cobrança prévia aberta — deve ser cancelada ao confirmar sem sinal
      const charged = await createSignalChargeAndSendOp(
        db,
        ctx.caller,
        {
          clientRequestId: 'req-before-waive',
          conversationId: ctx.conversation.id,
          contactId: ctx.contact.id,
          serviceId: ctx.svc.id,
          professionalId: ctx.pro.id,
          roomResourceId: ctx.room.id,
          startsAt: ctx.startsAt,
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
        { adapter },
      )
      expect(countAppointmentAllocations(db, ctx.tenantId)).toBe(0)

      const waived = await confirmWithoutSignalOp(
        db,
        ctx.caller,
        {
          clientRequestId: 'req-waive-ok',
          conversationId: ctx.conversation.id,
          contactId: ctx.contact.id,
          serviceId: ctx.svc.id,
          professionalId: ctx.pro.id,
          roomResourceId: ctx.room.id,
          startsAt: ctx.startsAt,
          waiveReason: 'Cliente preferiu pagar na clínica',
          actorClerkUserId: 'user_synth_owner_a',
          supersedeChargeId: charged.charge.id,
        },
        clock,
        { adapter },
      )
      expect(waived.appointmentId).toBeTruthy()
      expect(waived.supersededChargeId).toBe(charged.charge.id)
      expect(waived.intent?.status).toBe('waived')
      expect(waived.intent?.waivedReason).toMatch(/preferiu/)
      expect(countAppointmentAllocations(db, ctx.tenantId)).toBeGreaterThan(0)

      const after = listConversationPixChargesOp(
        db,
        ctx.caller,
        ctx.conversation.id,
        clock,
      )
      expect(after[0]?.status).toBe('cancelled')
    } finally {
      close()
    }
  })
})
