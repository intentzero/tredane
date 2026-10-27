/**
 * Reserva por bloco — leitura/mapeamento de linhas (sem dependências de
 * pipeline/booking, para evitar ciclos de import).
 */
import type { ScheduleHoldStatus } from '../constants'
import type { ClinicDb } from '../store'

export type ScheduleHoldView = {
  id: string
  status: ScheduleHoldStatus
  opportunityId: string | null
  conversationId: string
  contactId: string
  contactName: string | null
  serviceId: string
  serviceName: string
  professionalId: string
  professionalName: string
  durationMinutes: number
  windowStartsAt: number
  windowEndsAt: number
  confirmBy: number | null
  appointmentId: string | null
  responsibleClerkUserId: string | null
  responsibleDisplayName: string | null
  createdBy: string
  createdAt: number
  updatedAt: number
  resolvedAt: number | null
  expiredAt: number | null
  cancelledAt: number | null
  alertDismissedAt: number | null
}

export type HoldSql = {
  id: string
  tenant_id: string
  client_request_id: string | null
  opportunity_id: string | null
  conversation_id: string
  contact_id: string
  service_id: string
  professional_id: string
  duration_minutes: number
  window_starts_at: number
  window_ends_at: number
  confirm_by: number | null
  status: string
  appointment_id: string | null
  responsible_clerk_user_id: string | null
  responsible_display_name: string | null
  created_by: string
  created_at: number
  updated_at: number
  resolved_at: number | null
  expired_at: number | null
  cancelled_at: number | null
  alert_dismissed_at: number | null
  contact_name: string | null
  service_name: string | null
  professional_name: string | null
}

export const HOLD_SELECT = `SELECT h.*, c.display_name AS contact_name,
    s.name AS service_name, r.name AS professional_name
  FROM schedule_holds h
  LEFT JOIN contacts c ON c.tenant_id = h.tenant_id AND c.id = h.contact_id
  LEFT JOIN services s ON s.tenant_id = h.tenant_id AND s.id = h.service_id
  LEFT JOIN resources r ON r.tenant_id = h.tenant_id AND r.id = h.professional_id`

export function mapHold(row: HoldSql): ScheduleHoldView {
  return {
    id: row.id,
    status: row.status as ScheduleHoldStatus,
    opportunityId: row.opportunity_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    contactName: row.contact_name,
    serviceId: row.service_id,
    serviceName: row.service_name ?? row.service_id,
    professionalId: row.professional_id,
    professionalName: row.professional_name ?? row.professional_id,
    durationMinutes: row.duration_minutes,
    windowStartsAt: row.window_starts_at,
    windowEndsAt: row.window_ends_at,
    confirmBy: row.confirm_by,
    appointmentId: row.appointment_id,
    responsibleClerkUserId: row.responsible_clerk_user_id,
    responsibleDisplayName: row.responsible_display_name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    expiredAt: row.expired_at,
    cancelledAt: row.cancelled_at,
    alertDismissedAt: row.alert_dismissed_at,
  }
}

export function getHold(
  db: ClinicDb,
  tenantId: string,
  holdId: string,
): ScheduleHoldView | null {
  const row = db.get<HoldSql>(
    `${HOLD_SELECT} WHERE h.tenant_id = ? AND h.id = ?`,
    tenantId,
    holdId,
  )
  return row ? mapHold(row) : null
}

/**
 * Bloco «em aberto» da oportunidade (activo, ou vencido sem hora) — para o
 * cartão de «A definir». Só blocos deste ciclo (criados após a oportunidade).
 */
export function loadOpenHoldForOpportunity(
  db: ClinicDb,
  tenantId: string,
  opportunityId: string,
): ScheduleHoldView | null {
  const row = db.get<HoldSql>(
    `${HOLD_SELECT}
     WHERE h.tenant_id = ? AND h.opportunity_id = ?
       AND h.status IN ('active', 'expired')
     ORDER BY CASE h.status WHEN 'active' THEN 0 ELSE 1 END, h.created_at DESC, h.id DESC
     LIMIT 1`,
    tenantId,
    opportunityId,
  )
  return row ? mapHold(row) : null
}
