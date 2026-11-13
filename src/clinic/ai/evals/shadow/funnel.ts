/**
 * Mede o funil REAL (autodraft → tryAiAutoBook) sobre o corpus fixo.
 *
 * Cada frase é a primeira mensagem de uma conversa nova no cenário do harness L1;
 * lê-se o `BookingFrame` que o funil gravou e compara-se com a leitura rotulada.
 * Sem chamadas ao modelo (adaptador simulado): mede o que o funil lê **sem** o
 * extrator LLM. O catálogo do cenário difere do `EVAL_BOOKING_CATALOG`, por isso
 * os ids traduzem-se por nome (e audiência, nas variantes).
 *
 * Limites: frases que dependem de pergunta pendente (tag `opcao`) ficam de fora —
 * exigem um turno anterior específico; e o quadro só guarda o que o funil decidiu
 * gravar nesse turno (um campo lido mas não gravado conta como não lido).
 */
import { SimulatedAiAdapter } from '../../../../ai'
import { replaceServiceZonesOp, upsertServiceOp } from '../../../config'
import { listServices } from '../../../config/services'
import { enqueueAutoDraft, runDueAutoDrafts } from '../../autodraft'
import { getBookingFrame } from '../../schedule-session'
import type { ShadowSlots } from '../../interpreter-shadow'
import { EVAL_BOOKING_CATALOG } from '../booking-object-catalog'
import { bootDialogScenario, type DialogScenario } from '../dialogs/scenario'
import type { ReplayPhrase } from './corpus'
import { scorePhrase } from './replay'

/** Serviços do corpus que o cenário de referência não tem. */
function addMissingServices(s: DialogScenario): void {
  const have = new Set(listServices(s.db, s.tenantId).map((x) => x.name))
  if (!have.has('Design de sobrancelha')) {
    upsertServiceOp(
      s.db,
      s.caller,
      {
        name: 'Design de sobrancelha',
        durationMinutes: 40,
        bufferMinutes: 0,
        priceCents: 6000,
        professionalIds: [s.ids.ana],
        roomRequirement: { mode: 'none' },
      },
      s.clock,
    )
  }
  if (!have.has('Laser facial')) {
    const laser = upsertServiceOp(
      s.db,
      s.caller,
      {
        name: 'Laser facial',
        durationMinutes: 30,
        bufferMinutes: 0,
        priceCents: null,
        variantKind: 'sessão',
        variantKindPlural: 'sessões',
        professionalIds: [s.ids.ana],
        roomRequirement: { mode: 'none' },
      },
      s.clock,
    )
    replaceServiceZonesOp(
      s.db,
      s.caller,
      laser.id,
      [
        { name: 'Sessão curta', audience: 'ambos', durationMinutes: 30, priceCents: 20000 },
        { name: 'Sessão longa', audience: 'ambos', durationMinutes: 60, priceCents: 35000 },
      ],
      s.clock,
    )
  }
}

/** Chave estável independente de ids: «Serviço» ou «Serviço|Variante|audiência». */
function corpusKeys(): { service: Map<string, string>; zone: Map<string, string> } {
  const service = new Map<string, string>()
  const zone = new Map<string, string>()
  for (const svc of EVAL_BOOKING_CATALOG) {
    service.set(svc.id, svc.name)
    for (const z of svc.zones) zone.set(z.id, `${svc.name}|${z.name}|${z.audience}`)
  }
  return { service, zone }
}

export type FunnelRead = { slots: ShadowSlots; frameFound: boolean }

/** Corre uma frase no funil real e devolve o que ficou no quadro, em ids do corpus. */
export async function readFunnel(phrase: ReplayPhrase): Promise<FunnelRead> {
  const s = bootDialogScenario({ adapter: new SimulatedAiAdapter() })
  try {
    addMissingServices(s)
    s.clock.advance(1_000)
    const messageId = s.sayInbound(phrase.text)
    enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.conversationId, messageId }, s.clock)
    s.clock.advance(7_000)
    await runDueAutoDrafts(s.db, s.caller, s.clock, { mode: 'synthetic', adapter: s.adapter })
    const frame = getBookingFrame(s.db, s.tenantId, s.conversationId)
    if (!frame) return { slots: {}, frameFound: false }

    const keys = corpusKeys()
    const corpusByService = new Map([...keys.service].map(([id, name]) => [name, id]))
    const corpusByZone = new Map([...keys.zone].map(([id, k]) => [k, id]))
    const services = listServices(s.db, s.tenantId)
    const svcName = new Map(services.map((x) => [x.id, x.name]))
    const zoneKey = new Map<string, string>()
    for (const svc of services) for (const z of svc.zones) zoneKey.set(z.id, `${svc.name}|${z.name}|${z.audience}`)

    const slots: ShadowSlots = {}
    const svc = frame.serviceId ? corpusByService.get(svcName.get(frame.serviceId) ?? '') : undefined
    if (svc) slots.service = svc
    const variants = (frame.variantIds ?? [])
      .map((id) => corpusByZone.get(zoneKey.get(id) ?? ''))
      .filter((x): x is string => Boolean(x))
    if (variants.length > 0) slots.variants = variants.sort()
    if (frame.line) slots.line = frame.line
    if (frame.date) slots.date = frame.date
    if (frame.period) slots.period = frame.period
    if (frame.time) slots.time = frame.time
    return { slots, frameFound: true }
  } finally {
    s.close()
  }
}

export type FunnelSummary = {
  phrases: number
  perfect: number
  fields: number
  ok: number
  wrong: number
  missed: number
  spurious: number
}

export function scoreFunnel(phrases: ReplayPhrase[], reads: Map<string, FunnelRead>): {
  summary: FunnelSummary
  perPhrase: Array<{ id: string; text: string; got: ShadowSlots; expect: ShadowSlots; wrong: string[]; missed: string[]; spurious: string[] }>
} {
  const summary: FunnelSummary = { phrases: 0, perfect: 0, fields: 0, ok: 0, wrong: 0, missed: 0, spurious: 0 }
  const perPhrase: ReturnType<typeof scoreFunnel>['perPhrase'] = []
  for (const p of phrases) {
    const read = reads.get(p.id)
    if (!read) continue
    const sc = scorePhrase(p, read.slots)
    summary.phrases += 1
    summary.ok += sc.ok.length
    summary.wrong += sc.wrong.length
    summary.missed += sc.missed.length
    summary.spurious += sc.spurious.length
    summary.fields += sc.ok.length + sc.wrong.length + sc.missed.length
    if (sc.wrong.length + sc.missed.length + sc.spurious.length === 0) summary.perfect += 1
    perPhrase.push({ id: p.id, text: p.text, got: read.slots, expect: p.expect, wrong: sc.wrong, missed: sc.missed, spurious: sc.spurious })
  }
  return { summary, perPhrase }
}
