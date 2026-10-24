/**
 * Fixtures sintéticas partilhadas pelo harness E2E (#45).
 * Nomes, WA IDs e clínicas fictícias apenas.
 */
import { createControllableClock } from '../db/clock'
import {
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../clinic/config'
import { upsertContact } from '../clinic/contacts'
import { createConversation } from '../clinic/inbox/conversations'
import { insertMessage } from '../clinic/inbox/messages'
import { seedSyntheticWhatsappTemplates } from '../clinic/inbox/templates'
import { clinicWhatsapp, workerCaller } from '../clinic'
import { connectPixAccountOp } from '../clinic/pix'
import { bootClinicDb } from '../clinic/test-db'
import type { ClinicDb } from '../clinic/store'

export const TZ = 'America/Sao_Paulo'
export const CLINIC_A = 'clinic-demo-a'
export const CLINIC_B = 'clinic-demo-b'
export const OWNER_A = 'user_synth_owner_a'
export const ATT_A = 'user_synth_attendant_a'
export const OWNER_B = 'user_synth_owner_b'
export const MULTI = 'user_synth_multi'

export type SeededClinic = {
  tenantId: string
  db: ClinicDb
  clock: ReturnType<typeof createControllableClock>
  close: () => void
  caller: ReturnType<typeof workerCaller>
  pro: { id: string }
  room: { id: string }
  svcSignal: { id: string }
  svcPlain: { id: string }
  contact: { id: string }
  conversation: { id: string }
}

export async function seedOperationalClinic(opts: {
  tenantId: string
  ownerUserId: string
  waId: string
  displayName: string
  phoneDisplay: string
  withPix?: boolean
  clockMs?: number
}): Promise<SeededClinic> {
  const clock = createControllableClock(
    opts.clockMs ?? Date.UTC(2024, 0, 8, 12, 0, 0),
  )
  const { db, close } = bootClinicDb({ clock })
  const caller = workerCaller(opts.tenantId, opts.ownerUserId)

  const pro = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: `Prof. ${opts.displayName} (fictícia)` },
    clock,
  )
  const room = upsertResourceOp(
    db,
    caller,
    { kind: 'room', name: 'Sala Laser (fictícia)', category: 'Sala com laser' },
    clock,
  )
  const svcSignal = upsertServiceOp(
    db,
    caller,
    {
      name: 'Limpeza de pele (sinal)',
      durationMinutes: 60,
      bufferMinutes: 15,
      priceCents: 18_000,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'category', category: 'Sala com laser' },
      requiresSignal: true,
      signalKind: 'fixed',
      signalFixedCents: 5_400,
    },
    clock,
  )
  const svcPlain = upsertServiceOp(
    db,
    caller,
    {
      name: 'Consulta estética (sem sinal)',
      durationMinutes: 30,
      bufferMinutes: 0,
      priceCents: 12_000,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'category', category: 'Sala com laser' },
      requiresSignal: false,
    },
    clock,
  )
  for (const resourceId of [pro.id, room.id]) {
    setWeeklyWindowsOp(
      db,
      caller,
      {
        resourceId,
        windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }],
      },
      clock,
    )
  }

  clinicWhatsapp.syncWhatsappChannel(
    db,
    opts.tenantId,
    {
      status: 'connected',
      bindingId: `bind_${opts.tenantId}`,
      phoneNumberId: `pn_${opts.tenantId}`,
      wabaId: `waba_${opts.tenantId}`,
      displayPhone: opts.phoneDisplay,
      action: 'channel_connected',
    },
    clock,
  )
  seedSyntheticWhatsappTemplates(db, opts.tenantId, clock)

  if (opts.withPix !== false) {
    await connectPixAccountOp(
      db,
      caller,
      {
        appId: `synth_app_${opts.tenantId}_abcdefgh`,
        clerkUserId: opts.ownerUserId,
      },
      clock,
      { tokenSecret: 'test-secret-mvp31', environment: 'synthetic' },
    )
  }

  const contact = upsertContact(
    db,
    {
      tenantId: opts.tenantId,
      waId: opts.waId,
      displayName: opts.displayName,
    },
    clock,
  )
  const conversation = createConversation(
    db,
    { tenantId: opts.tenantId, contactId: contact.id },
    clock,
  )
  insertMessage(
    db,
    {
      tenantId: opts.tenantId,
      conversationId: conversation.id,
      direction: 'inbound',
      body: 'Olá, gostaria de agendar (fictício)',
      deliveryState: 'received',
    },
    clock,
  )

  return {
    tenantId: opts.tenantId,
    db,
    clock,
    close,
    caller,
    pro,
    room,
    svcSignal,
    svcPlain,
    contact,
    conversation,
  }
}

export async function seedPairClinics() {
  const a = await seedOperationalClinic({
    tenantId: CLINIC_A,
    ownerUserId: OWNER_A,
    waId: '5511999001001',
    displayName: 'Marina Aurora',
    phoneDisplay: '+15550001001',
  })
  const b = await seedOperationalClinic({
    tenantId: CLINIC_B,
    ownerUserId: OWNER_B,
    waId: '5511999002002',
    displayName: 'Bruno Horizonte',
    phoneDisplay: '+15550002002',
  })
  return {
    a,
    b,
    closeAll: () => {
      a.close()
      b.close()
    },
  }
}
