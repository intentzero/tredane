/**
 * Cenário de referência da matriz (docs/implementation/matriz-dialogos-conversacional.md).
 * Relógio: qui 05/11/2026 10:00 America/Sao_Paulo. Dados fictícios.
 */
import { SimulatedAiAdapter, type AiProviderAdapter } from '../../../../ai'
import { allowedPricesCents as allowedPricesCentsOf } from '../../../../ai/reply-facts'
import { listServices } from '../../../config/services'
import { queryAvailability } from '../../../scheduling/query'
import { createControllableClock, type Clock } from '../../../../db/clock'
import {
  replaceServiceZonesOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../../../config'
import { CLINIC_SCOPE_ID } from '../../../config/types'

type ControllableClock = Clock & { set(ms: number): void; advance(ms: number): void }
import { setClinicAiAssistEnabled, setClinicAiProfile } from '../../../config/settings'
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
  /** Mensagem da clínica (já enviada) antes do turno da cliente. */
  sayOutbound: (body: string) => string
  inboundBodies: () => string[]
  /** Preços (centavos) que o catálogo permite dizer: linha, variantes por linha, somas, combos, sinal. */
  allowedPricesCents: () => Set<number>
  /** HH:MM livres (qualquer serviço, próximos 7 dias) — superconjunto independente do validador. */
  freeTimesUnion: () => Set<string>
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
  /** Relógio do cenário (default: qui 05/11/2026 10:00 SP). */
  nowMs?: number
} = {}): DialogScenario {
  const nowMs = opts.nowMs ?? DIALOG_NOW_MS
  const clock = createControllableClock(nowMs - 5 * 60_000)
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
  setClinicAiProfile(
    db,
    tenantId,
    {
      reschedulePolicy:
        'Pode desmarcar ou remarcar até 24h antes sem multa. Depois disso o sinal é retido.',
    },
    clock,
  )
  const contact = upsertContact(db, { tenantId, waId: '5511900000406', displayName: 'Carla Teste' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  clock.set(nowMs)

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

  const sayOutbound = (body: string) => {
    clock.advance(1_000)
    const m = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'outbound',
        body,
        deliveryState: 'delivered',
        createdAt: clock.nowMs(),
      },
      clock,
    )
    return m.id
  }

  const allowedPricesCents = (): Set<number> => {
    const active = listServices(db, tenantId).filter((x) => x.active)
    const asCatalog = (line: 'feminino' | 'masculino' | null) =>
      active.map((x) => ({
        name: x.name,
        durationMinutes: x.durationMinutes,
        priceCents: x.priceCents,
        clientExplanation: null,
        audiencia: x.audiencia,
        zones: x.zones
          .filter((z) => z.active && (line == null || z.audience === 'ambos' || z.audience === line))
          .map((z) => ({
            name: z.name,
            durationMinutes: z.durationMinutes,
            priceCents: z.priceCents,
            audience: z.audience,
          })),
        combos: x.combos
          .filter((c) => c.active)
          .map((c) => ({
            name: c.name,
            zoneNames: c.zoneIds.map((id) => x.zones.find((z) => z.id === id)?.name ?? ''),
            priceCents: c.priceCents,
          })),
      }))
    // Somas só dentro de cada linha: masculino com feminino nunca tem preço (DEC-079).
    const out = new Set<number>([
      ...allowedPricesCentsOf(asCatalog('feminino')),
      ...allowedPricesCentsOf(asCatalog('masculino')),
    ])
    for (const x of active) {
      if (!x.requiresSignal || x.priceCents == null) continue
      if (x.signalKind === 'fixed' && x.signalFixedCents != null) out.add(x.signalFixedCents)
      if (x.signalKind === 'percent' && x.signalPercent != null) {
        out.add(Math.trunc((x.priceCents * x.signalPercent) / 100))
      }
    }
    return out
  }

  const freeTimesUnion = (): Set<string> => {
    const fmt = new Intl.DateTimeFormat('pt-BR', {
      timeZone: DIALOG_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    const out = new Set<string>()
    const now = clock.nowMs()
    for (const svc of listServices(db, tenantId).filter((x) => x.active)) {
      for (let i = 0; i < 7; i++) {
        const date = new Date(now + i * 86_400_000).toLocaleDateString('en-CA', { timeZone: DIALOG_TZ })
        try {
          for (const slot of queryAvailability(db, tenantId, { serviceId: svc.id, date }, clock).slots) {
            if (slot.startsAt > now) out.add(fmt.format(new Date(slot.startsAt)).replace(/^(\d):/, '0$1:'))
          }
        } catch {
          /* serviço sem recurso utilizável */
        }
      }
    }
    return out
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
    sayOutbound,
    allowedPricesCents,
    freeTimesUnion,
    inboundBodies: () =>
      db
        .all<{ body: string }>(
          `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at ASC`,
          cnv.id,
        )
        .map((r) => r.body),
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
