/**
 * Agendar pela página web da cliente (ADR-0018, Fase 2; DEC-196/197/201).
 * Funções puras sobre o SQLite da clínica, chamadas pelo Clinic DO.
 *
 * Nada aqui marca: `planWebProposal` só cria a proposta versionada e a deixa autorizada;
 * a marcação (ou o Pix) sai do `executeProposalConfirmOp`, o mesmo executor do botão do
 * WhatsApp, com `channel: 'web'`.
 */
import type { Clock } from '../db/clock'
import { ConflictError, ValidationError } from '../clinic/errors'
import { listServices, getService } from '../clinic/config/services'
import { quoteVisit } from '../clinic/config/zones'
import { ensureClinicSettings } from '../clinic/config/settings'
import { clinicCivilDateFromUtc, zonedCivilToUtc } from '../clinic/scheduling/timezone'
import { queryAutomaticAvailability } from '../clinic/tempo/automatic'
import { readOpenMeteo } from '../clinic/tempo/open-meteo'
import type { ForecastAdapter } from '../clinic/tempo/evaluate'
import { addCivilDays, localHHMM } from '../clinic/ai/slot-offer'
import type { AbuseLimits } from '../clinic/ai/abuse-limits'
import type { ClinicDb } from '../clinic/store'
import type { ServiceRow } from '../clinic/config/types'
import {
  createOrSupersedeProposal,
  evaluateProposalAuthorization,
  markProposalSent,
} from '../clinic/proposals/proposals'
import type { ProposalConfirmHandoff } from '../clinic/proposals/buttons'
import type { AppointmentProposalRow } from '../clinic/proposals/types'

/**
 * Quantos dias à frente a página deixa marcar. **Provisório**: o horizonte é uma configuração
 * da clínica (DEC-201, Confirmado, ainda não implementada); até existir vale este valor fixo.
 */
export const CLIENT_WEB_HORIZON_DAYS = 30

/** Teto de horas devolvidas por pedido. */
export const CLIENT_WEB_MAX_SLOTS = 400

export type ClientWebLine = 'feminino' | 'masculino'

export type ClientWebCatalogZone = {
  id: string
  name: string
  /** DEC-110: só para a pesquisa casar; a página nunca os mostra. */
  synonyms: string[]
  audience: 'feminino' | 'masculino' | 'ambos'
  durationMinutes: number
  priceCents: number | null
}

export type ClientWebCatalogService = {
  id: string
  name: string
  /** DEC-110: só para a pesquisa casar; a página nunca os mostra. */
  synonyms: string[]
  durationMinutes: number
  priceCents: number | null
  /** Audiência do serviço (DEC-075), não da pessoa. */
  audience: ServiceRow['audiencia']
  variantKind: string | null
  variantKindPlural: string | null
  variantSelection: 'uma' | 'varias'
  zones: ClientWebCatalogZone[]
  /** Há sinal a pagar por Pix no chat (a página só avisa). */
  requiresSignal: boolean
}

export type ClientWebCatalog = {
  timezone: string
  horizonDays: number
  today: string
  services: ClientWebCatalogService[]
}

/** Serviço ativo e marcável: com zonas, tem de haver pelo menos uma ativa (#540). */
function isBookable(service: ServiceRow): boolean {
  if (!service.active) return false
  if (service.zones.length > 0 && !service.zones.some((z) => z.active)) return false
  return true
}

export function readClientWebCatalog(db: ClinicDb, tenantId: string, clock: Clock): ClientWebCatalog {
  const settings = ensureClinicSettings(db, tenantId, clock)
  const timezone = settings.timezone || 'America/Sao_Paulo'
  const services = listServices(db, tenantId)
    .filter(isBookable)
    .map<ClientWebCatalogService>((s) => ({
      id: s.id,
      name: s.name,
      synonyms: [...s.synonyms],
      durationMinutes: s.durationMinutes,
      priceCents: s.priceCents,
      audience: s.audiencia,
      variantKind: s.variantKind,
      variantKindPlural: s.variantKindPlural,
      variantSelection: s.variantSelection,
      requiresSignal: s.requiresSignal,
      zones: s.zones
        .filter((z) => z.active)
        .map((z) => ({
          id: z.id,
          name: z.name,
          synonyms: [...z.synonyms],
          audience: z.audience,
          durationMinutes: z.durationMinutes,
          priceCents: z.priceCents,
        })),
    }))
  return {
    timezone,
    horizonDays: CLIENT_WEB_HORIZON_DAYS,
    today: clinicCivilDateFromUtc(timezone, clock.nowMs()),
    services,
  }
}

export type ClientWebSlot = { id: string; date: string; time: string }

function visitDurationMinutes(db: ClinicDb, tenantId: string, service: ServiceRow, zoneIds: string[]): number {
  if (zoneIds.length === 0 && service.zones.every((z) => !z.active)) return service.durationMinutes
  return quoteVisit(db, tenantId, service, zoneIds.length > 0 ? zoneIds : null).durationMinutes
}

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Limita o intervalo pedido a [hoje, hoje + horizonte - 1]. */
export function clampDateRange(today: string, from: string, to: string): { from: string; to: string } | null {
  if (!CIVIL_DATE.test(from) || !CIVIL_DATE.test(to)) return null
  const last = addCivilDays(today, CLIENT_WEB_HORIZON_DAYS - 1)
  const lo = from < today ? today : from
  const hi = to > last ? last : to
  return lo <= hi ? { from: lo, to: hi } : null
}

export type ClientWebSlotsResult =
  | { ok: true; slots: ClientWebSlot[]; from: string; to: string }
  | { ok: false; error: 'service_unavailable' | 'variants_invalid' | 'range_invalid' }

/**
 * Horas livres entre duas datas civis da clínica, no mesmo motor do chat (sala, profissional,
 * audiência, Tempo, antecedência). Sem previsão a tempo, não lista «às escuras» (DEC-077).
 */
export async function listClientWebSlots(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  input: {
    serviceId: string
    variantIds: string[]
    from: string
    to: string
    /** Calendário: só a primeira hora de cada dia (sem o teto de horas). */
    daysOnly?: boolean
    forecast?: ForecastAdapter
  },
): Promise<ClientWebSlotsResult> {
  const service = getService(db, tenantId, input.serviceId)
  if (!service || !isBookable(service)) return { ok: false, error: 'service_unavailable' }
  const catalog = readClientWebCatalog(db, tenantId, clock)
  const range = clampDateRange(catalog.today, input.from, input.to)
  if (!range) return { ok: false, error: 'range_invalid' }
  let duration: number
  try {
    duration = visitDurationMinutes(db, tenantId, service, input.variantIds)
  } catch {
    return { ok: false, error: 'variants_invalid' }
  }
  const forecast = input.forecast ?? { read: readOpenMeteo }
  const slots: ClientWebSlot[] = []
  for (let date = range.from; date <= range.to; date = addCivilDays(date, 1)) {
    if (!input.daysOnly && slots.length >= CLIENT_WEB_MAX_SLOTS) break
    let avail: { slots: Array<{ startsAt: number }> }
    try {
      avail = await queryAutomaticAvailability(
        db,
        tenantId,
        { serviceId: service.id, date, durationMinutesOverride: duration },
        clock,
        forecast,
      )
    } catch {
      break
    }
    const seen = new Set<string>()
    for (const slot of avail.slots) {
      if (slot.startsAt <= clock.nowMs()) continue
      const time = localHHMM(catalog.timezone, slot.startsAt)
      if (seen.has(time)) continue
      seen.add(time)
      slots.push({ id: `${date}T${time}`, date, time })
      if (input.daysOnly) break
    }
  }
  return { ok: true, slots, from: range.from, to: range.to }
}

/** Resposta da página depois de Confirmar. Nunca leva ids internos de proposta. */
export type ClientWebBookResult =
  | { status: 'booked'; appointment: { id: string; startsAt: number; endsAt: number; serviceName: string } }
  | { status: 'pix_signal' }
  | { status: 'slot_taken' }
  | { status: 'paused' }
  | { status: 'error'; error: WebBookingError | 'expired' | 'not_allowed' | 'appointment_not_found' }

export type WebBookingInput = {
  serviceId: string
  variantIds: string[]
  line: ClientWebLine | null
  /** `YYYY-MM-DDTHH:MM` civil da clínica. */
  slotId: string
}

export type WebBookingError =
  | 'service_unavailable'
  | 'variants_invalid'
  | 'line_required'
  | 'line_mismatch'
  | 'slot_invalid'
  | 'slot_unavailable'
  | 'limit_reached'
  | 'proposal_failed'

export type PlannedWebProposal =
  | {
      ok: true
      proposal: AppointmentProposalRow
      handoff: ProposalConfirmHandoff
    }
  | { ok: false; error: WebBookingError }

const SLOT_ID = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/

/**
 * Toque duplo ou reenvio: se a própria cliente já marcou este serviço neste horário nos últimos
 * 10 minutos, devolve essa marcação em vez de dizer que a hora «já não está livre».
 */
export function findRecentWebBooking(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  session: { contactId: string },
  input: { serviceId: string; slotId: string },
): { id: string; startsAt: number; endsAt: number; serviceName: string } | null {
  const m = SLOT_ID.exec(input.slotId)
  if (!m) return null
  const tz = ensureClinicSettings(db, tenantId, clock).timezone || 'America/Sao_Paulo'
  const [y, mo, d] = (m[1] as string).split('-').map(Number) as [number, number, number]
  const [h, mi] = (m[2] as string).split(':').map(Number) as [number, number]
  const startsAt = zonedCivilToUtc(tz, y, mo, d, h, mi)
  const row = db.get<{ id: string; starts_at: number; ends_at: number; name: string | null }>(
    `SELECT a.id, a.starts_at, a.ends_at, s.name
       FROM appointments a
       LEFT JOIN services s ON s.tenant_id = a.tenant_id AND s.id = a.service_id
      WHERE a.tenant_id = ? AND a.contact_id = ? AND a.service_id = ? AND a.starts_at = ?
        AND a.status = 'confirmed' AND a.created_at > ?
      ORDER BY a.created_at DESC LIMIT 1`,
    tenantId,
    session.contactId,
    input.serviceId,
    startsAt,
    clock.nowMs() - 10 * 60 * 1000,
  )
  return row ? { id: row.id, startsAt: row.starts_at, endsAt: row.ends_at, serviceName: row.name ?? 'Atendimento' } : null
}

/**
 * Valida o pedido contra o catálogo e a agenda, cria a proposta versionada (30 min) e devolve
 * o handoff de confirmação. A marcação não acontece aqui.
 */
export async function planWebProposal(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  session: { contactId: string; conversationId: string },
  input: WebBookingInput,
  deps: { forecast?: ForecastAdapter; abuseLimits?: AbuseLimits } = {},
): Promise<PlannedWebProposal> {
  const service = getService(db, tenantId, input.serviceId)
  if (!service || !isBookable(service)) return { ok: false, error: 'service_unavailable' }

  // Zonas escolhidas têm de existir, estar ativas e respeitar a linha (DEC-079).
  const activeZones = service.zones.filter((z) => z.active)
  const chosen = activeZones.filter((z) => input.variantIds.includes(z.id))
  if (chosen.length !== new Set(input.variantIds).size) return { ok: false, error: 'variants_invalid' }
  const needLine =
    activeZones.some((z) => z.audience === 'feminino') && activeZones.some((z) => z.audience === 'masculino')
  if (needLine && !input.line) return { ok: false, error: 'line_required' }
  if (input.line) {
    if (service.audiencia !== 'qualquer' && service.audiencia !== input.line) {
      return { ok: false, error: 'line_mismatch' }
    }
    if (chosen.some((z) => z.audience !== 'ambos' && z.audience !== input.line)) {
      return { ok: false, error: 'line_mismatch' }
    }
  }

  let duration: number
  try {
    duration = visitDurationMinutes(db, tenantId, service, input.variantIds)
  } catch {
    return { ok: false, error: 'variants_invalid' }
  }

  const m = SLOT_ID.exec(input.slotId)
  if (!m) return { ok: false, error: 'slot_invalid' }
  const [, date, time] = m as unknown as [string, string, string]
  const catalog = readClientWebCatalog(db, tenantId, clock)
  if (!clampDateRange(catalog.today, date, date)) return { ok: false, error: 'slot_invalid' }

  // A hora tem de estar livre agora: o motor devolve também a profissional.
  let slot: { startsAt: number; professionalId: string } | undefined
  try {
    const avail = await queryAutomaticAvailability(
      db,
      tenantId,
      { serviceId: service.id, date, durationMinutesOverride: duration },
      clock,
      deps.forecast ?? { read: readOpenMeteo },
    )
    slot = avail.slots.find(
      (s) => s.startsAt > clock.nowMs() && localHHMM(catalog.timezone, s.startsAt) === time,
    )
  } catch {
    return { ok: false, error: 'slot_unavailable' }
  }
  if (!slot) return { ok: false, error: 'slot_unavailable' }

  let proposal: AppointmentProposalRow
  try {
    proposal = createOrSupersedeProposal(
      db,
      tenantId,
      {
        contactId: session.contactId,
        conversationId: session.conversationId,
        serviceId: service.id,
        professionalId: slot.professionalId,
        startsAt: slot.startsAt,
        zoneIds: input.variantIds.length > 0 ? input.variantIds : null,
      },
      clock,
      deps.abuseLimits ? { abuseLimits: deps.abuseLimits } : {},
    ).proposal
  } catch (err) {
    if (err instanceof ConflictError && err.code === 'abuse_limit_reached') {
      return { ok: false, error: 'limit_reached' }
    }
    if (err instanceof ValidationError) return { ok: false, error: 'variants_invalid' }
    return { ok: false, error: 'proposal_failed' }
  }

  // A página é o canal de envio desta proposta: vale 30 min a partir de agora.
  const sent = markProposalSent(db, tenantId, proposal.id, clock)
  const authorization = evaluateProposalAuthorization(
    db,
    {
      tenantId,
      proposalId: sent.id,
      contactId: session.contactId,
      conversationId: session.conversationId,
    },
    clock,
  )
  return {
    ok: true,
    proposal: sent,
    handoff: {
      action: 'confirm',
      authorization,
      proposal: sent,
      s5Todo: 'confirmAppointment_or_pix_signal',
    },
  }
}
