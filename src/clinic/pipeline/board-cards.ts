/**
 * Cartões do quadro Acompanhar — DEC-187.
 * Com horário futuro confirmado + atendimento/marcação aberta, o ciclo em
 * Agendado permanece e nasce um cartão gémeo de atendimento. Quando a nova
 * marcação confirma, a sessão/proposta fecha e o gémeo desaparece (merge no
 * Agendado); o cartão Agendado mostra quantos horários futuros o contacto tem.
 *
 * Confirmado (Paulo, 16/11/2026): «atendimento aberto» também cobre fio activo
 * após Agendado sem `booking_sessions` — inbound novo depois da confirmação,
 * handoff/Assumir (IA pausada) ou quadro em `remarcando`.
 */
import type { Clock } from '../../db/clock'
import { getOpenBookingSession } from '../ai/booking-session'
import { getBookingFrame } from '../ai/schedule-session'
import type { OpportunityStage } from '../constants'
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
  const inbound = db.get<{ id: string }>(
    `SELECT id FROM messages
     WHERE tenant_id = ? AND conversation_id = ? AND direction = 'inbound'
       AND created_at > ?
     LIMIT 1`,
    tenantId,
    conversationId,
    confirmedAt,
  )
  return inbound != null
}

/** Handoff / Assumir: IA pausada e conversa ainda aberta. */
export function hasOpenHumanHandoffThread(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): boolean {
  const row = db.get<{ paused: number | null; status: string }>(
    `SELECT ai_reply_paused_at AS paused, status FROM conversations
     WHERE tenant_id = ? AND id = ?`,
    tenantId,
    conversationId,
  )
  if (!row || row.paused == null) return false
  return row.status === 'open' || row.status === 'new'
}

/**
 * Atendimento/marcação em curso na conversa: sessão de booking aberta,
 * proposta activa, quadro de marcação activo (incl. remarcando), handoff
 * humano, ou inbound novo após a última confirmação (DEC-187, 16/11/2026).
 */
export function hasOpenAttendance(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
): boolean {
  if (getOpenBookingSession(db, tenantId, conversationId)) return true
  if (getActiveProposalForConversation(db, tenantId, conversationId, clock)) return true
  const frame = getBookingFrame(db, tenantId, conversationId)
  if (frame && ACTIVE_FRAME_PHASES.has(frame.phase)) return true
  if (hasOpenHumanHandoffThread(db, tenantId, conversationId)) return true
  if (hasInboundAfterLatestBookingConfirm(db, tenantId, conversationId, clock.nowMs())) {
    return true
  }
  return false
}

/** Etapa do cartão gémeo de atendimento (não mexe na oportunidade real). */
export function openAttendanceBoardStage(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
): Extract<OpportunityStage, 'em_atendimento' | 'horario_proposto'> {
  if (getActiveProposalForConversation(db, tenantId, conversationId, clock)) {
    return 'horario_proposto'
  }
  const frame = getBookingFrame(db, tenantId, conversationId)
  if (frame && (frame.phase === 'proposto' || frame.phase === 'pix_pendente' || frame.phase === 'ofertado')) {
    return 'horario_proposto'
  }
  return 'em_atendimento'
}

export function boardKeyFor(item: Pick<OpportunityListItem, 'id' | 'cardKind'>): string {
  return item.cardKind === 'open_attendance' ? `${item.id}:attendance` : item.id
}

export function toOpenAttendanceCard(
  cycle: OpportunityListItem,
  stage: Extract<OpportunityStage, 'em_atendimento' | 'horario_proposto'>,
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
