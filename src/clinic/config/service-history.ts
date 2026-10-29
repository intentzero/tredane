import type { ClinicDb } from '../store'

/** Motivo pelo qual um serviço não pode ser apagado (só desativado). */
export type ServiceDeleteBlocker = {
  code:
    | 'service_has_appointments'
    | 'service_has_pending_pix'
    | 'service_has_pending_proposal'
    | 'service_has_history'
  message: string
}

const KEEP = 'Desative-o para tirá-lo de novos agendamentos e manter o histórico.'

function tableExists(db: ClinicDb, table: string): boolean {
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`,
    table,
  )
  return (row?.n ?? 0) > 0
}

function count(
  db: ClinicDb,
  table: string,
  tenantId: string,
  serviceId: string,
  extra = '',
): number {
  if (!tableExists(db, table)) return 0
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ? AND service_id = ?${extra}`,
    tenantId,
    serviceId,
  )
  return row?.n ?? 0
}

/**
 * Serviço só pode ser apagado se nunca teve marcação (de nenhum estado, incluindo
 * canceladas e passadas), nem Pix, proposta/reserva ou intenção ligada a ele.
 * `null` = pode apagar.
 */
export function serviceDeleteBlocker(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
): ServiceDeleteBlocker | null {
  if (count(db, 'appointments', tenantId, serviceId) > 0) {
    return {
      code: 'service_has_appointments',
      message: `Não é possível apagar: este serviço já teve marcações. ${KEEP}`,
    }
  }
  const pendingPix =
    count(db, 'pix_charges', tenantId, serviceId, ` AND status IN ('awaiting_payment', 'refund_requested')`)
    + count(db, 'scheduling_intents', tenantId, serviceId, ` AND status = 'awaiting_signal'`)
  if (pendingPix > 0) {
    return {
      code: 'service_has_pending_pix',
      message: `Não é possível apagar: há um Pix pendente ligado a este serviço. ${KEEP}`,
    }
  }
  const pendingProposal =
    count(db, 'schedule_holds', tenantId, serviceId, ` AND status = 'active'`)
    + count(
      db,
      'appointment_proposals',
      tenantId,
      serviceId,
      ` AND state IN ('preparada', 'envio_pendente', 'envio_incerto', 'enviada')`,
    )
  if (pendingProposal > 0) {
    return {
      code: 'service_has_pending_proposal',
      message: `Não é possível apagar: há uma proposta de horário pendente para este serviço. ${KEEP}`,
    }
  }
  const history =
    count(db, 'pix_charges', tenantId, serviceId)
    + count(db, 'scheduling_intents', tenantId, serviceId)
    + count(db, 'schedule_holds', tenantId, serviceId)
    + count(db, 'appointment_proposals', tenantId, serviceId)
  if (history > 0) {
    return {
      code: 'service_has_history',
      message: `Não é possível apagar: este serviço já tem histórico de cobranças ou propostas. ${KEEP}`,
    }
  }
  return null
}
