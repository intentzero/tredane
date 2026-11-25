/**
 * Cartões do quadro Acompanhar — DEC-187.
 * Com horário futuro confirmado + atendimento/marcação aberta, o ciclo em
 * Agendado permanece e nasce um cartão gémeo de atendimento. Quando a nova
 * marcação confirma, a sessão/proposta fecha e o gémeo desaparece (merge no
 * Agendado); o cartão Agendado mostra quantos horários futuros o contacto tem.
 *
 * Confirmado (Paulo, 16/11/2026): «atendimento aberto» também cobre fio activo
 * após Agendado sem `booking_sessions` — inbound novo depois da confirmação,
 * «Precisa de alguém» / handoff (mesmo critério DEC-156) ou quadro em `remarcando`.
 * Terminar / fecho idle (`idle_suppressed_at`) encerra esse fio: o inbound do
 * próprio botão Terminar não conta; só mensagem nova depois do fecho.
 */
import type { Clock } from '../../db/clock'
import { getOpenBookingSession } from '../ai/booking-session'
import { getBookingFrame } from '../ai/schedule-session'
import type { OpportunityStage } from '../constants'
import { conversationNeedsPerson, getConversation } from '../inbox/conversations'
import { getActiveProposalForConversation } from '../proposals/proposals'
import type { ClinicDb } from '../store'
import type { OpportunityListItem } from './types'

export type BoardCardKind = 'cycle' | 'open_attendance'

const ACTIVE_FRAME_PHASES = new Set([
  'coletando',
  'ofertado',
  'proposto',
  'pix_pendente',
  'remarcando',
])

/** Horários futuros confirmados do contacto (cliente). */
export function countFutureConfirmedAppointmentsForContact(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
  nowMs: number,
): number {
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM appointments
     WHERE tenant_id = ? AND contact_id = ? AND status = 'confirmed' AND ends_at > ?`,
    tenantId,
    contactId,
    nowMs,
  )
  return row?.n ?? 0
}

/**
 * Cliente voltou a escrever depois da última confirmação de horário nesta
 * conversa (ex.: nova conversa / FAQ / «quero outro» ainda sem sessão).
 *
 * Após Terminar / fecho idle, `idle_suppressed_at` marca o fim desse
 * atendimento: o próprio toque «Terminar» (inbound do botão) não mantém o
 * gémeo DEC-187 em «Em atendimento» / «Atendimento em curso». Nova mensagem
 * depois do Terminar volta a projectar o gémeo.
 */
export function hasInboundAfterLatestBookingConfirm(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  nowMs: number,
): boolean {
  const latest = db.get<{ confirmed_at: number | null }>(
    `SELECT MAX(confirmed_at) AS confirmed_at FROM appointments
     WHERE tenant_id = ? AND conversation_id = ? AND status = 'confirmed' AND ends_at > ?`,
    tenantId,
    conversationId,
    nowMs,
  )
  const confirmedAt = latest?.confirmed_at
  if (confirmedAt == null) return false
  // Terminar / idle close (#743): watermark para não contar o inbound do próprio
  // botão End como «atendimento aberto» (staging: Gislaine após 2× Terminar).
  const suppressed = db.get<{ at: number | null }>(
    `SELECT idle_suppressed_at AS at FROM conversations
     WHERE tenant_id = ? AND id = ?`,
    tenantId,
    conversationId,
  )
  const baseline = Math.max(confirmedAt, suppressed?.at ?? 0)
  const inbound = db.get<{ id: string }>(
    `SELECT id FROM messages
     WHERE tenant_id = ? AND conversation_id = ? AND direction = 'inbound'
       AND created_at > ?
     LIMIT 1`,
    tenantId,
    conversationId,
    baseline,
  )
  return inbound != null
}

/**
 * Atendimento/marcação em curso na conversa: sessão de booking aberta,
 * proposta activa, quadro de marcação activo (incl. remarcando),
 * «Precisa de alguém» (DEC-156), ou inbound novo após a última confirmação.
 * Conversa encerrada no painel: não projecta gémeo «Atendimento em curso».
 */
export function hasOpenAttendance(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
): boolean {
  const conv = getConversation(db, tenantId, conversationId)
  if (!conv || conv.status === 'closed') return false
  if (getOpenBookingSession(db, tenantId, conversationId)) return true
  if (getActiveProposalForConversation(db, tenantId, conversationId, clock)) return true
  const frame = getBookingFrame(db, tenantId, conversationId)
  if (frame && ACTIVE_FRAME_PHASES.has(frame.phase)) return true
  if (conversationNeedsPerson(db, tenantId, conversationId)) return true
  if (hasInboundAfterLatestBookingConfirm(db, tenantId, conversationId, clock.nowMs())) {
    return true
  }
  return false
}

/** Etapa do cartão gémeo de atendimento (DEC-228; não mexe na oportunidade real). */
export function openAttendanceBoardStage(): Extract<
  OpportunityStage,
  'em_atendimento'
> {
  return 'em_atendimento'
}

export function boardKeyFor(item: Pick<OpportunityListItem, 'id' | 'cardKind'>): string {
  return item.cardKind === 'open_attendance' ? `${item.id}:attendance` : item.id
}

export function toOpenAttendanceCard(
  cycle: OpportunityListItem,
  stage: Extract<OpportunityStage, 'em_atendimento'>,
): OpportunityListItem {
  return {
    ...cycle,
    stage,
    linkedAppointmentId: null,
    linkedAppointment: null,
    missingAppointment: false,
    openHold: null,
    cardKind: 'open_attendance',
    boardKey: `${cycle.id}:attendance`,
  }
}

export function shouldProjectOpenAttendance(item: OpportunityListItem): boolean {
  return (
    item.cardKind !== 'open_attendance' &&
    item.stage === 'agendado' &&
    item.status === 'open' &&
    item.futureAppointmentCount > 0 &&
    item.hasOpenAttendance === true
  )
}
