/**
 * Segunda clínica de teste para o gerador M7 (#418).
 * Configuração diferente do cenário de referência: um só profissional,
 * Massagem + Depilação com variantes, sábado fechado, sinal fixo no peeling.
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
import { setClinicAiAssistEnabled, setClinicAiProfile } from '../../../config/settings'
import { upsertContact } from '../../../contacts'
import { workerCaller } from '../../../index'
import { createConversation } from '../../../inbox/conversations'
import { insertMessage } from '../../../inbox/messages'
import { bootClinicDb } from '../../../test-db'
import { syncWhatsappChannel } from '../../../whatsapp/channel'
import { listServices } from '../../../config/services'
import { queryAvailability } from '../../../scheduling/query'
import { allowedPricesCents as allowedPricesCentsOf } from '../../../../ai/reply-facts'
import type { DialogScenario } from './scenario'
import { DIALOG_NOW_MS, DIALOG_TZ } from './scenario'

type ControllableClock = Clock & { set(ms: number): void; advance(ms: number): void }

const WEEKDAYS = [1, 2, 3, 4, 5].map((d) => ({
  dayOfWeek: d,
  startMinute: 10 * 60,
  endMinute: 17 * 60,
}))

export function bootSecondClinicScenario(opts: {
  adapter?: AiProviderAdapter
  nowMs?: number
} = {}): DialogScenario {
  const nowMs = opts.nowMs ?? DIALOG_NOW_MS
  const clock = createControllableClock(nowMs - 5 * 60_000) as ControllableClock
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-dialogs-b'
  const caller = workerCaller(tenantId, 'user_synth_owner_b')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_dialog_b',
      phoneNumberId: 'pn_dialog_b',
      wabaId: 'waba_dialog_b',
      displayPhone: '+5511900000418',
      displayName: 'Clínica Diálogos B',
      action: 'channel_connected',
    },
    clock,
  )

  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala Única' }, clock)
  const lia = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Lia', homeRoomId: room.id },
    clock,
  )
  setWeeklyWindowsOp(db, caller, { resourceId: lia.id, windows: WEEKDAYS }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: CLINIC_SCOPE_ID, windows: WEEKDAYS }, clock)

  const massagem = upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem',
      durationMinutes: 40,
      bufferMinutes: 0,
      priceCents: 12000,
      professionalIds: [lia.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )

  const depilacao = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação a laser',
      durationMinutes: 20,
      bufferMinutes: 0,
      priceCents: null,
      variantKind: 'zona',
      variantKindPlural: 'zonas',
      professionalIds: [lia.id],
      roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
    },
    clock,
  )
  replaceServiceZonesOp(
    db,
    caller,
    depilacao.id,
    [
      { name: 'Buço', audience: 'ambos', durationMinutes: 10, priceCents: 3000 },
      { name: 'Axila', audience: 'feminino', durationMinutes: 20, priceCents: 4500 },
    ],
    clock,
  )

  const peeling = upsertServiceOp(
    db,
    caller,
    {
      name: 'Peeling suave',
      durationMinutes: 30,
      bufferMinutes: 0,
      priceCents: 20000,
      professionalIds: [lia.id],
      roomRequirement: { mode: 'none' },
      requiresSignal: true,
      signalKind: 'fixed',
      signalFixedCents: 5000,
    },
    clock,
  )

  setClinicAiAssistEnabled(db, tenantId, true, clock)
  setClinicAiProfile(
    db,
    tenantId,
    {
      reschedulePolicy: 'Remarcação até 12h antes sem custo.',
    },
    clock,
  )

  const contact = upsertContact(
    db,
    { tenantId, waId: '5511900000418', displayName: 'Diana Teste' },
    clock,
  )
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  clock.set(nowMs)

  const adapter = opts.adapter ?? new SimulatedAiAdapter()

  const sayInbound = (body: string) => {
    clock.advance(1_000)
    return insertMessage(
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
    ).id
  }

  const sayOutbound = (body: string) => {
    clock.advance(1_000)
    return insertMessage(
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
    ).id
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
    sayInboundMedia: () => {
      throw new Error('sayInboundMedia não usado na segunda clínica M7')
    },
    sayOutbound,
    allowedPricesCents: () => {
      const active = listServices(db, tenantId).filter((x) => x.active)
      const asCatalog = () =>
        active.map((x) => ({
          name: x.name,
          durationMinutes: x.durationMinutes,
          priceCents: x.priceCents,
          clientExplanation: null,
          audiencia: x.audiencia,
          zones: x.zones
            .filter((z) => z.active)
            .map((z) => ({
              name: z.name,
              durationMinutes: z.durationMinutes,
              priceCents: z.priceCents,
              audience: z.audience,
            })),
          combos: [],
        }))
      const out = new Set<number>(allowedPricesCentsOf(asCatalog()))
      for (const x of active) {
        if (!x.requiresSignal) continue
        if (x.signalKind === 'fixed' && x.signalFixedCents != null) out.add(x.signalFixedCents)
      }
      return out
    },
    freeTimesUnion: () => {
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
          const date = new Date(now + i * 86_400_000).toLocaleDateString('en-CA', {
            timeZone: DIALOG_TZ,
          })
          try {
            for (const slot of queryAvailability(db, tenantId, { serviceId: svc.id, date }, clock)
              .slots) {
              if (slot.startsAt > now) {
                out.add(fmt.format(new Date(slot.startsAt)).replace(/^(\d):/, '0$1:'))
              }
            }
          } catch {
            /* ignore */
          }
        }
      }
      return out
    },
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
      db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`, tenantId)!
        .n,
    ids: {
      ana: lia.id,
      bia: lia.id,
      gi: lia.id,
      sandra: lia.id,
      limpeza: massagem.id,
      depilacao: depilacao.id,
      massagem: massagem.id,
      massagemTipos: massagem.id,
      bronzeamento: peeling.id,
      peeling: peeling.id,
      micro: massagem.id,
    },
  }
}
