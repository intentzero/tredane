/**
 * Remarcar e cancelar pela página web da cliente (ADR-0018, Fases 3 e 4; DEC-197, DEC-198).
 * Funções puras sobre o SQLite da clínica, chamadas pelo Clinic DO.
 *
 * - Remarcar: proposta versionada com `replacesAppointmentId`, mesmo serviço e zonas (DEC-091),
 *   confirmada pelo mesmo executor do botão do WhatsApp (`channel: 'web'`). Não gera sinal novo.
 * - Cancelar: só marcações **sem sinal pago**. Com sinal pago a página pede à equipe, porque a
 *   janela de crédito (DEC-180/182) ainda não é aplicada pelo backend (DEC-198, regra Proposta).
 */
import type { Clock } from '../db/clock'
import { ConflictError, ValidationError } from '../clinic/errors'
import { getService } from '../clinic/config/services'
import { ensureClinicSettings } from '../clinic/config/settings'
import { readZoneSnapshots, zoneLabel } from '../clinic/config/zones'
import { PROPOSAL_SEND_ACTOR, PROPOSAL_SEND_ACTOR_DISPLAY } from '../clinic/constants'
import { appendPostCancelFollowup } from '../clinic/followup/post-booking'
import { sendOutboundMessageOp } from '../clinic/inbox/operations'
import { zonedCivilToUtc } from '../clinic/scheduling/timezone'
import { formatBookedWhenAt } from '../clinic/scheduling/format-booked-when'
import { queryAvailability } from '../clinic/scheduling/query'
import { addCivilDays, localHHMM } from '../clinic/ai/slot-offer'
import type { AbuseLimits } from '../clinic/ai/abuse-limits'
import type { ClinicCaller } from '../clinic/envelopes'
import { cancelAppointmentOp } from '../clinic/scheduling'
import type { OutboxRow } from '../clinic/outbox'
import type { ClinicDb } from '../clinic/store'
import {
  createOrSupersedeProposal,
  evaluateProposalAuthorization,
  markProposalSent,
} from '../clinic/proposals/proposals'
import type { AppointmentProposalRow } from '../clinic/proposals/types'
import type { ProposalConfirmHandoff } from '../clinic/proposals/buttons'
import { clampDateRange, CLIENT_WEB_MAX_SLOTS, readClientWebCatalog, type ClientWebSlot } from './booking'
import { emptyDaysForRange, type ClientWebEmptyDay } from './empty-day-reason'
import {
  pickRoundRobinProfessional,
  readRrLastProfessional,
  writeRrLastProfessional,
} from './round-robin'

export const WEB_CANCEL_ACTOR = 'contact:web'
export const WEB_CANCEL_RECEIPT_SENTENCE = 'Cancelado pela página. Não foi você? Fale com a equipe.'

export type WebAppointment = {
  id: string
  serviceId: string
  serviceName: string
  startsAt: number
  endsAt: number
  professionalId: string
  professionalName: string
  /** Sinal pago por Pix: a cliente não cancela sozinha (DEC-198, Proposto). */
  hasPaidSignal: boolean
}

/** Sinal pago ligado a esta marcação. */
export function hasPaidSignal(db: ClinicDb, tenantId: string, appointmentId: string): boolean {
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM pix_charges
      WHERE tenant_id = ? AND appointment_id = ? AND status IN ('paid', 'refund_requested', 'refund_failed')`,
    tenantId,
    appointmentId,
  )
  return (row?.n ?? 0) > 0
}

/** Marcação futura e confirmada que pertence ao contacto da sessão; senão `null`. */
export function loadWebAppointment(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  session: { contactId: string },
  appointmentId: string,
): WebAppointment | null {
  const row = db.get<{
    id: string
    service_id: string
    professional_id: string
    starts_at: number
    ends_at: number
    name: string | null
    professional_name: string | null
  }>(
    `SELECT a.id, a.service_id, a.professional_id, a.starts_at, a.ends_at, s.name,
            r.name AS professional_name
       FROM appointments a
       LEFT JOIN services s ON s.tenant_id = a.tenant_id AND s.id = a.service_id
       LEFT JOIN resources r ON r.tenant_id = a.tenant_id AND r.id = a.professional_id
      WHERE a.tenant_id = ? AND a.id = ? AND a.contact_id = ? AND a.status = 'confirmed' AND a.starts_at > ?`,
    tenantId,
    appointmentId,
    session.contactId,
    clock.nowMs(),
  )
  if (!row) return null
  return {
    id: row.id,
    serviceId: row.service_id,
    serviceName: row.name ?? 'Atendimento',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    professionalId: row.professional_id,
    professionalName: row.professional_name ?? 'Profissional',
    hasPaidSignal: hasPaidSignal(db, tenantId, row.id),
  }
}

function snapshotZoneIds(db: ClinicDb, tenantId: string, appointmentId: string): string[] {
  return readZoneSnapshots(db, tenantId, 'appointment', appointmentId)
    .map((z) => z.zoneId)
    .filter((id): id is string => Boolean(id))
}

/** Duração a manter: a da marcação (inclui as zonas já escolhidas). */
function appointmentMinutes(apt: WebAppointment): number {
  return Math.max(1, Math.round((apt.endsAt - apt.startsAt) / 60_000))
}

export type RescheduleSlotsResult =
  | { ok: true; slots: ClientWebSlot[]; from: string; to: string; emptyDays: ClientWebEmptyDay[] }
  | {
      ok: false
      error: 'appointment_not_found' | 'service_unavailable' | 'range_invalid' | 'professional_invalid'
    }

/** Horas livres para remarcar: a própria marcação não ocupa a vaga (`excludeAppointmentId`). */
export async function listRescheduleSlots(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  session: { contactId: string },
  input: {
    appointmentId: string
    from: string
    to: string
    daysOnly?: boolean
    /** DEC-218: preferência; null/omitido = Sem preferência. */
    professionalId?: string | null
  },
): Promise<RescheduleSlotsResult> {
  const apt = loadWebAppointment(db, tenantId, clock, session, input.appointmentId)
  if (!apt) return { ok: false, error: 'appointment_not_found' }
  const service = getService(db, tenantId, apt.serviceId)
  if (!service || !service.active) return { ok: false, error: 'service_unavailable' }
  const catalog = readClientWebCatalog(db, tenantId, clock)
  const catalogSvc = catalog.services.find((s) => s.id === apt.serviceId)
  const preferredId = input.professionalId?.trim() || null
  if (preferredId && catalogSvc && !catalogSvc.professionals.some((p) => p.id === preferredId)) {
    return { ok: false, error: 'professional_invalid' }
  }
  if (preferredId && !catalogSvc) {
    // Serviço ainda existe na marcação mas saiu do catálogo marcável: só aceita a própria profissional.
    if (preferredId !== apt.professionalId) return { ok: false, error: 'professional_invalid' }
  }
  const range = clampDateRange(catalog.today, input.from, input.to)
  if (!range) return { ok: false, error: 'range_invalid' }
  const slots: ClientWebSlot[] = []
  const datesWithoutSlots: string[] = []
  for (let date = range.from; date <= range.to; date = addCivilDays(date, 1)) {
    if (!input.daysOnly && slots.length >= CLIENT_WEB_MAX_SLOTS) break
    let avail: { slots: Array<{ startsAt: number }> }
    try {
      avail = queryAvailability(
        db,
        tenantId,
        {
          serviceId: apt.serviceId,
          date,
          excludeAppointmentId: apt.id,
          durationMinutesOverride: appointmentMinutes(apt),
          ...(preferredId ? { professionalId: preferredId } : {}),
        },
        clock,
      )
    } catch {
      break
    }
    const before = slots.length
    const seen = new Set<string>()
    for (const s of avail.slots) {
      if (s.startsAt <= clock.nowMs() || s.startsAt === apt.startsAt) continue
      const time = localHHMM(catalog.timezone, s.startsAt)
      if (seen.has(time)) continue
      seen.add(time)
      slots.push({ id: `${date}T${time}`, date, time })
      if (input.daysOnly) break
    }
    if (slots.length === before) datesWithoutSlots.push(date)
  }
  return {
    ok: true,
    slots,
    from: range.from,
    to: range.to,
    emptyDays: emptyDaysForRange(db, tenantId, clock, catalog.timezone, datesWithoutSlots),
  }
}

export type WebRescheduleError =
  | 'appointment_not_found'
  | 'service_unavailable'
  | 'slot_invalid'
  | 'slot_unavailable'
  | 'professional_invalid'
  | 'limit_reached'
  | 'proposal_failed'

export type PlannedWebReschedule =
  | { ok: true; proposal: AppointmentProposalRow; handoff: ProposalConfirmHandoff; previousStartsAt: number }
  | { ok: false; error: WebRescheduleError }

const SLOT_ID = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/

/**
 * Cria a proposta de remarcação (mesmo serviço e zonas) para a hora escolhida e devolve o handoff.
 * Quem marca é o executor, não esta função.
 */
export async function planWebReschedule(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  session: { contactId: string; conversationId: string },
  input: { appointmentId: string; slotId: string; professionalId?: string | null },
  deps: { abuseLimits?: AbuseLimits } = {},
): Promise<PlannedWebReschedule> {
  const apt = loadWebAppointment(db, tenantId, clock, session, input.appointmentId)
  if (!apt) return { ok: false, error: 'appointment_not_found' }
  const service = getService(db, tenantId, apt.serviceId)
  if (!service || !service.active) return { ok: false, error: 'service_unavailable' }

  const m = SLOT_ID.exec(input.slotId)
  if (!m) return { ok: false, error: 'slot_invalid' }
  const [, date, time] = m as unknown as [string, string, string]
  const catalog = readClientWebCatalog(db, tenantId, clock)
  if (!clampDateRange(catalog.today, date, date)) return { ok: false, error: 'slot_invalid' }
  const minutes = appointmentMinutes(apt)
  const catalogSvc = catalog.services.find((s) => s.id === apt.serviceId)
  const preferredId = input.professionalId?.trim() || null
  if (preferredId) {
    const allowed =
      catalogSvc?.professionals.some((p) => p.id === preferredId) || preferredId === apt.professionalId
    if (!allowed) return { ok: false, error: 'professional_invalid' }
  }

  let slot: { startsAt: number; professionalId: string } | undefined
  let usedRoundRobin = false
  try {
    if (preferredId) {
      const avail = queryAvailability(
        db,
        tenantId,
        {
          serviceId: apt.serviceId,
          date,
          excludeAppointmentId: apt.id,
          durationMinutesOverride: minutes,
          professionalId: preferredId,
        },
        clock,
      )
      slot = avail.slots.find(
        (s) =>
          s.startsAt > clock.nowMs() &&
          s.startsAt !== apt.startsAt &&
          localHHMM(catalog.timezone, s.startsAt) === time,
      )
    } else {
      const orderedIds = (catalogSvc?.professionals.map((p) => p.id) ?? [apt.professionalId]).filter(
        (id, i, arr) => arr.indexOf(id) === i,
      )
      const freeIds = new Set<string>()
      let startsAt: number | undefined
      for (const proId of orderedIds) {
        const avail = queryAvailability(
          db,
          tenantId,
          {
            serviceId: apt.serviceId,
            date,
            excludeAppointmentId: apt.id,
            durationMinutesOverride: minutes,
            professionalId: proId,
          },
          clock,
        )
        const hit = avail.slots.find(
          (s) =>
            s.startsAt > clock.nowMs() &&
            s.startsAt !== apt.startsAt &&
            localHHMM(catalog.timezone, s.startsAt) === time,
        )
        if (hit) {
          freeIds.add(proId)
          startsAt = hit.startsAt
        }
      }
      const picked = pickRoundRobinProfessional(
        orderedIds,
        freeIds,
        readRrLastProfessional(db, tenantId, apt.serviceId),
      )
      if (picked && startsAt != null) {
        slot = { startsAt, professionalId: picked }
        usedRoundRobin = true
      }
    }
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
        serviceId: apt.serviceId,
        professionalId: slot.professionalId,
        startsAt: slot.startsAt,
        endsAt: slot.startsAt + minutes * 60_000,
        durationMinutes: minutes,
        zoneIds: snapshotZoneIds(db, tenantId, apt.id),
        replacesAppointmentId: apt.id,
      },
      clock,
      deps.abuseLimits ? { abuseLimits: deps.abuseLimits } : {},
    ).proposal
  } catch (err) {
    if (err instanceof ConflictError && err.code === 'abuse_limit_reached') return { ok: false, error: 'limit_reached' }
    if (err instanceof ValidationError) return { ok: false, error: 'slot_unavailable' }
    return { ok: false, error: 'proposal_failed' }
  }

  if (usedRoundRobin) {
    writeRrLastProfessional(db, tenantId, apt.serviceId, slot.professionalId, clock)
  }

  const sent = markProposalSent(db, tenantId, proposal.id, clock)
  const authorization = evaluateProposalAuthorization(
    db,
    { tenantId, proposalId: sent.id, contactId: session.contactId, conversationId: session.conversationId },
    clock,
  )
  return {
    ok: true,
    proposal: sent,
    previousStartsAt: apt.startsAt,
    handoff: { action: 'confirm', authorization, proposal: sent, s5Todo: 'confirmAppointment_or_pix_signal' },
  }
}

/**
 * Toque duplo ao remarcar: a marcação já está na hora pedida (mudou há pouco) → devolve-a em vez de
 * dizer que a hora «já não está livre».
 */
export function rescheduleAlreadyAt(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  session: { contactId: string },
  input: { appointmentId: string; slotId: string },
): {
  id: string
  startsAt: number
  endsAt: number
  serviceName: string
  professionalName: string | null
} | null {
  const m = SLOT_ID.exec(input.slotId)
  if (!m) return null
  const tz = ensureClinicSettings(db, tenantId, clock).timezone || 'America/Sao_Paulo'
  const [y, mo, d] = (m[1] as string).split('-').map(Number) as [number, number, number]
  const [h, mi] = (m[2] as string).split(':').map(Number) as [number, number]
  const startsAt = zonedCivilToUtc(tz, y, mo, d, h, mi)
  const apt = loadWebAppointment(db, tenantId, clock, session, input.appointmentId)
  if (!apt || apt.startsAt !== startsAt) return null
  const row = db.get<{ updated_at: number | null }>(
    'SELECT updated_at FROM appointments WHERE tenant_id = ? AND id = ?',
    tenantId,
    apt.id,
  )
  // Só vale como repetição se a alteração é recente (10 min); senão a hora pedida é a atual e não faz sentido.
  if (!row?.updated_at || row.updated_at < clock.nowMs() - 10 * 60 * 1000) return null
  return {
    id: apt.id,
    startsAt: apt.startsAt,
    endsAt: apt.endsAt,
    serviceName: apt.serviceName,
    professionalName: apt.professionalName,
  }
}

export type WebCancelResult =
  | { status: 'cancelled'; serviceName: string; startsAt: number }
  | { status: 'needs_team' }
  | { status: 'not_found' }

/**
 * Cancela uma marcação sem sinal pago. Com sinal pago não cancela: devolve `needs_team`.
 * Idempotente por marcação (repetir o pedido devolve o mesmo resultado).
 */
export function cancelFromWeb(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  session: { contactId: string },
  appointmentId: string,
): { result: WebCancelResult; outbox: import('../clinic/outbox').OutboxRow[] } {
  const apt = loadWebAppointment(db, caller.tenantId, clock, session, appointmentId)
  if (!apt) {
    // Toque repetido: já cancelada pela própria cliente → mesmo resultado, sem novo efeito.
    const done = db.get<{ s: number; name: string | null }>(
      `SELECT a.starts_at AS s, sv.name AS name
         FROM appointments a
         LEFT JOIN services sv ON sv.tenant_id = a.tenant_id AND sv.id = a.service_id
        WHERE a.tenant_id = ? AND a.id = ? AND a.contact_id = ? AND a.status = 'cancelled' AND a.cancelled_by = ?`,
      caller.tenantId,
      appointmentId,
      session.contactId,
      WEB_CANCEL_ACTOR,
    )
    if (done) return { result: { status: 'cancelled', serviceName: done.name ?? 'Atendimento', startsAt: done.s }, outbox: [] }
    return { result: { status: 'not_found' }, outbox: [] }
  }
  if (apt.hasPaidSignal) return { result: { status: 'needs_team' }, outbox: [] }
  const cancelled = cancelAppointmentOp(
    db,
    caller,
    {
      clientRequestId: `web-cancel:${apt.id}`,
      appointmentId: apt.id,
      reason: 'contato_desistiu',
      actorClerkUserId: WEB_CANCEL_ACTOR,
      // Recibo web + follow-up DEC-086 saem em appendWebCancelChatEffects (evita duplicar DEC-095).
      skipCancelNotice: true,
    },
    clock,
  )
  return {
    result: { status: 'cancelled', serviceName: apt.serviceName, startsAt: apt.startsAt },
    outbox: cancelled.outbox,
  }
}

/** Texto do recibo de cancelamento no chat (DEC-197): serviço · zonas · quando + frase da página. */
export function cancelReceiptBody(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  input: { serviceName: string; startsAt: number; appointmentId?: string },
): string {
  const tz = ensureClinicSettings(db, tenantId, clock).timezone || 'America/Sao_Paulo'
  const zones = input.appointmentId
    ? readZoneSnapshots(db, tenantId, 'appointment', input.appointmentId)
    : []
  const label = zoneLabel(input.serviceName, zones)
  return `Cancelado: ${label} · ${formatBookedWhenAt(tz, input.startsAt)}. ${WEB_CANCEL_RECEIPT_SENTENCE}`
}

/**
 * Um recibo claro + «Posso ajudar em algo mais?» (DEC-086) após cancelar na página.
 * Melhor esforço: falha de envio não desfaz o cancelamento; fora das 24 h não sai.
 */
export function appendWebCancelChatEffects(
  db: ClinicDb,
  caller: ClinicCaller,
  input: {
    conversationId: string
    appointmentId: string
    serviceName: string
    startsAt: number
    /** Preferido: cta_url «Abrir agenda» no «Posso ajudar…» (DEC-202 / Meta). */
    agendaUrl?: string | null
  },
  clock: Clock,
  outbox: OutboxRow[],
): OutboxRow[] {
  let next = outbox
  try {
    const sent = sendOutboundMessageOp(
      db,
      caller,
      {
        conversationId: input.conversationId,
        body: cancelReceiptBody(db, caller.tenantId, clock, {
          serviceName: input.serviceName,
          startsAt: input.startsAt,
          appointmentId: input.appointmentId,
        }),
        clientRequestId: `web-cancel-receipt:${input.appointmentId}`,
        authorClerkUserId: PROPOSAL_SEND_ACTOR,
        authorDisplayName: PROPOSAL_SEND_ACTOR_DISPLAY,
      },
      clock,
    )
    next = [...next, ...sent.outbox]
  } catch {
    // Fora da janela de 24 h o recibo não sai; o cancelamento já está feito.
  }
  return appendPostCancelFollowup(
    db,
    caller,
    {
      conversationId: input.conversationId,
      appointmentId: input.appointmentId,
      agendaUrl: input.agendaUrl,
    },
    clock,
    next,
  )
}

