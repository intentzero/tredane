/**
 * Cenário de referência da matriz (docs/implementation/matriz-dialogos-conversacional.md).
 * Relógio: qui 05/11/2026 10:00 America/Sao_Paulo. Dados fictícios.
 */
import { SimulatedAiAdapter, type AiProviderAdapter } from '../../../../ai'
import { createControllableClock, type Clock } from '../../../../db/clock'
import {
  replaceServiceZonesOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../../../config'
import { CLINIC_SCOPE_ID } from '../../../config/types'

type ControllableClock = Clock & { set(ms: number): void; advance(ms: number): void }
import { setClinicAiAssistEnabled } from '../../../config/settings'
import { upsertContact } from '../../../contacts'
import { workerCaller } from '../../../index'
import { createConversation } from '../../../inbox/conversations'
import { insertMessage } from '../../../inbox/messages'
import { bootClinicDb } from '../../../test-db'
import { syncWhatsappChannel } from '../../../whatsapp/channel'
import type { ClinicCaller } from '../../../envelopes'
import type { ClinicDb } from '../../../store'

export const DIALOG_TZ = 'America/Sao_Paulo'
/** qui 05/11/2026 10:00 America/Sao_Paulo (= 13:00 UTC). */
export const DIALOG_NOW_MS = Date.UTC(2026, 10, 5, 13, 0)

const WEEKDAY_SPLIT = [1, 2, 3, 4, 5].flatMap((d) => [
  { dayOfWeek: d, startMinute: 9 * 60, endMinute: 12 * 60 },
  { dayOfWeek: d, startMinute: 13 * 60, endMinute: 18 * 60 },
])
const SATURDAY = [{ dayOfWeek: 6, startMinute: 9 * 60, endMinute: 12 * 60 }]

export type DialogScenario = {
  db: ClinicDb
  clock: ControllableClock
  caller: ClinicCaller
  tenantId: string
  conversationId: string
  contactId: string
  adapter: AiProviderAdapter
  close: () => void
  sayInbound: (body: string) => string
  outboundBodies: () => string[]
  proposalCount: () => number
  appointmentCount: () => number
  ids: {
    ana: string
    bia: string
    gi: string
    sandra: string
    limpeza: string
    depilacao: string
    massagem: string
    bronzeamento: string
    peeling: string
    micro: string
  }
}

export function bootDialogScenario(opts: {
  adapter?: AiProviderAdapter
} = {}): DialogScenario {
  const clock = createControllableClock(DIALOG_NOW_MS - 5 * 60_000)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-dialogs'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_dialog',
      phoneNumberId: 'pn_dialog',
      wabaId: 'waba_dialog',
      displayPhone: '+5511900000406',
      displayName: 'Clínica Diálogos',
      action: 'channel_connected',
    },
    clock,
  )

  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala Depilação', category: 'Sala' }, clock)
  const ana = upsertResourceOp(db, caller, { kind: 'professional', name: 'Ana', homeRoomId: room.id }, clock)
  const bia = upsertResourceOp(db, caller, { kind: 'professional', name: 'Bia', homeRoomId: room.id }, clock)
  const gi = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi', homeRoomId: room.id }, clock)
  const sandra = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Sandra', homeRoomId: room.id },
    clock,
  )

  for (const pro of [ana, bia, gi, sandra, room]) {
    setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: [...WEEKDAY_SPLIT, ...SATURDAY] }, clock)
  }
  setWeeklyWindowsOp(
    db,
    caller,
    { resourceId: CLINIC_SCOPE_ID, windows: [...WEEKDAY_SPLIT, ...SATURDAY] },
    clock,
  )

  const limpeza = upsertServiceOp(
    db,
    caller,
    {
      name: 'Limpeza de pele profunda',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: 18000,
      professionalIds: [ana.id, bia.id],
      roomRequirement: { mode: 'none' },
      clientExplanation: 'Limpeza profunda cadastrada para testes.',
    },
    clock,
  )
  // Alias curto usado nos diálogos da matriz («limpeza de pele»).
  upsertServiceOp(
    db,
    caller,
    {
      name: 'Limpeza de pele',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: 18000,
      professionalIds: [ana.id, bia.id],
      roomRequirement: { mode: 'none' },
      clientExplanation: 'Limpeza profunda cadastrada para testes.',
    },
    clock,
  )

  const depilacao = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 15,
      bufferMinutes: 0,
      priceCents: null,
      variantKind: 'zona',
      variantKindPlural: 'zonas',
      professionalIds: [gi.id],
      roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
    },
    clock,
  )
  replaceServiceZonesOp(
    db,
    caller,
    depilacao.id,
    [
      { name: 'Axila', audience: 'feminino', durationMinutes: 15, priceCents: 4000 },
      { name: 'Axila', audience: 'masculino', durationMinutes: 15, priceCents: 5000 },
      { name: 'Pernas', audience: 'feminino', durationMinutes: 30, priceCents: 12000 },
      { name: 'Pernas', audience: 'masculino', durationMinutes: 30, priceCents: 14000 },
      { name: 'Buço', audience: 'ambos', durationMinutes: 10, priceCents: 2500 },
    ],
    clock,
  )

  const massagem = upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem relaxante',
      durationMinutes: 50,
      bufferMinutes: 0,
      priceCents: 15000,
      professionalIds: [bia.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem',
      durationMinutes: 50,
      bufferMinutes: 0,
      priceCents: 15000,
      professionalIds: [bia.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )

  const bronzeamento = upsertServiceOp(
    db,
    caller,
    {
      name: 'Bronzeamento',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: 15000,
      professionalIds: [sandra.id],
      roomRequirement: { mode: 'none' },
      tempoCeu: 'sol',
    },
    clock,
  )

  const peeling = upsertServiceOp(
    db,
    caller,
    {
      name: 'Peeling químico',
      durationMinutes: 45,
      bufferMinutes: 0,
      priceCents: 30000,
      professionalIds: [ana.id],
      roomRequirement: { mode: 'none' },
      requiresSignal: true,
      signalKind: 'percent',
      signalPercent: 30,
    },
    clock,
  )

  const micro = upsertServiceOp(
    db,
    caller,
    {
      name: 'Microagulhamento',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: null,
      professionalIds: [ana.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )

  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000406', displayName: 'Carla Teste' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  clock.set(DIALOG_NOW_MS)

  const adapter = opts.adapter ?? new SimulatedAiAdapter()

  const sayInbound = (body: string) => {
    clock.advance(1_000)
    const m = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body,
        deliveryState: 'received',
        createdAt: clock.nowMs(),
      },
      clock,
    )
    return m.id
  }

  return {
    db,
    clock,
    caller,
    tenantId,
    conversationId: cnv.id,
    contactId: contact.id,
    adapter,
    close: boot.close,
    sayInbound,
    outboundBodies: () =>
      db
        .all<{ body: string }>(
          `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound' ORDER BY created_at ASC`,
          cnv.id,
        )
        .map((r) => r.body),
    proposalCount: () =>
      db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointment_proposals WHERE tenant_id = ? AND conversation_id = ?`,
        tenantId,
        cnv.id,
      )!.n,
    appointmentCount: () =>
      db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`, tenantId)!.n,
    ids: {
      ana: ana.id,
      bia: bia.id,
      gi: gi.id,
      sandra: sandra.id,
      limpeza: limpeza.id,
      depilacao: depilacao.id,
      massagem: massagem.id,
      bronzeamento: bronzeamento.id,
      peeling: peeling.id,
      micro: micro.id,
    },
  }
}
