import type { ChargeStatus, RefundStatus } from '../types'

/** Status Woovi → domínio Tredane. */
export function mapWooviChargeStatus(status: string): ChargeStatus {
  switch (status.toUpperCase()) {
    case 'COMPLETED':
      return 'paid'
    case 'EXPIRED':
      return 'expired'
    case 'ACTIVE':
      return 'awaiting_payment'
    default:
      // Cobranças canceladas/removidas: tratamos como cancelled quando aplicável.
      if (status.toUpperCase().includes('CANCEL')) return 'cancelled'
      return 'awaiting_payment'
  }
}

export function mapWooviRefundStatus(status: string): RefundStatus {
  switch (status.toUpperCase()) {
    case 'CONFIRMED':
    case 'COMPLETED':
      return 'succeeded'
    case 'REJECTED':
    case 'FAILED':
      return 'failed'
    case 'IN_PROCESSING':
    case 'PENDING':
    default:
      return 'requested'
  }
}

export function mapWooviWebhookEvent(
  event: string,
): 'charge.paid' | 'charge.expired' | 'charge.cancelled' | 'refund.updated' | null {
  const e = event.toUpperCase()
  if (e === 'OPENPIX:CHARGE_COMPLETED' || e === 'OPENPIX:CHARGE_COMPLETED_NOT_SAME_CUSTOMER') {
    return 'charge.paid'
  }
  if (e === 'OPENPIX:CHARGE_EXPIRED') return 'charge.expired'
  if (e.includes('CHARGE') && e.includes('CANCEL')) return 'charge.cancelled'
  if (e.includes('REFUND') || e.includes('CHARGE_REFUND')) return 'refund.updated'
  return null
}

export const WOOVI_ADDITIONAL_TENANT = 'tredaneTenantId'
export const WOOVI_ADDITIONAL_ACCOUNT = 'tredaneAccountId'

export function readAdditional(
  additionalInfo: Array<{ key?: string; value?: string }> | undefined,
  key: string,
): string | undefined {
  if (!additionalInfo) return undefined
  const found = additionalInfo.find((i) => i.key === key)
  return found?.value
}
