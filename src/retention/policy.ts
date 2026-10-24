import { RETENTION } from '../attachments/policy'

/** Dias Confirmados (DEC-011 / REQ-071) até expurgo total após encerramento. */
export const TENANT_PURGE_MAX_DAYS = RETENTION.tenantDeletionMaxDays

/** Alerta de atraso: N dias antes do deadline (Proposto de engenharia). */
export const TENANT_PURGE_ALERT_BEFORE_DAYS = 3 as const

export function purgeDeadlineAt(pendingDeletionAtMs: number): number {
  return pendingDeletionAtMs + TENANT_PURGE_MAX_DAYS * 24 * 60 * 60 * 1000
}

export function purgeAlertAt(deadlineAtMs: number): number {
  return deadlineAtMs - TENANT_PURGE_ALERT_BEFORE_DAYS * 24 * 60 * 60 * 1000
}
