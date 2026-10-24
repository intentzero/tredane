import type { PixAccountPublic, PixChargeRow, PixSignalSettings } from '../clinic/pix'
import { computeSignalAmountCents } from '../pix/money'
import type { ServiceRow } from '../clinic/config'

export function serializePixAccount(row: PixAccountPublic) {
  return {
    provider: row.provider,
    status: row.status,
    accountId: row.accountId,
    appIdHint: row.appIdHint,
    environment: row.environment,
    credentialVersion: row.credentialVersion,
    connectedAt: row.connectedAt,
    connectedByClerkUserId: row.connectedByClerkUserId,
    disconnectedAt: row.disconnectedAt,
    revokedAt: row.revokedAt,
    revokeReason: row.revokeReason,
    updatedAt: row.updatedAt,
    canCreateCharge: row.canCreateCharge,
  }
}

export function serializePixSignalSettings(row: PixSignalSettings) {
  return {
    deadlineSeconds: row.deadlineSeconds,
    cancellationPolicy: row.cancellationPolicy,
    updatedAt: row.updatedAt,
  }
}

export function serializePixCharge(row: PixChargeRow) {
  /** Estado de UI: pago sem horário (REQ-079/080); estorno ainda não confirmado ≠ Devolvido. */
  const displayStatus =
    row.status === 'paid' && row.paymentResolution === 'paid_without_slot'
      ? 'paid_without_slot'
      : row.status
  return {
    id: row.id,
    accountId: row.accountId,
    provider: row.provider,
    providerChargeId: row.providerChargeId,
    externalReference: row.externalReference,
    amountCents: row.amountCents,
    status: row.status,
    displayStatus,
    paymentResolution: row.paymentResolution,
    appointmentId: row.appointmentId,
    paidWithoutSlotReason: row.paidWithoutSlotReason,
    signalDisposition: row.signalDisposition,
    signalDispositionBy: row.signalDispositionBy,
    signalDispositionAt: row.signalDispositionAt,
    refundRequestedAt: row.refundRequestedAt,
    refundCompletedAt: row.refundCompletedAt,
    refundFailureReason: row.refundFailureReason,
    expiresAt: row.expiresAt,
    paidAt: row.paidAt,
    cancelledAt: row.cancelledAt,
    serviceId: row.serviceId,
    schedulingIntentId: row.schedulingIntentId,
    conversationId: row.conversationId,
    contactId: row.contactId,
    opportunityId: row.opportunityId,
    messageId: row.messageId,
    professionalId: row.professionalId,
    roomResourceId: row.roomResourceId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    timezone: row.timezone,
    deadlineSecondsSnapshot: row.deadlineSecondsSnapshot,
    cancellationPolicySnapshot: row.cancellationPolicySnapshot,
    providerCreateState: row.providerCreateState,
    whatsappSendError: row.whatsappSendError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // pixCopyPaste só no detalhe (#38)
  }
}

export function serializePixPaymentAlert(
  row: import('../clinic/pix').PixPaymentAlertRow,
) {
  return {
    id: row.id,
    chargeId: row.chargeId,
    conversationId: row.conversationId,
    contactId: row.contactId,
    opportunityId: row.opportunityId,
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
    resolutionKind: row.resolutionKind,
    resolvedByClerkUserId: row.resolvedByClerkUserId,
    resolvedAppointmentId: row.resolvedAppointmentId,
  }
}

/** Detalhe de cobrança — inclui Pix copia-e-cola (M-31). */
export function serializePixChargeDetail(row: PixChargeRow) {
  return {
    ...serializePixCharge(row),
    pixCopyPaste: row.pixCopyPaste,
  }
}

export function serializeSchedulingIntent(
  row: import('../clinic/pix').SchedulingIntentRow,
) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    contactId: row.contactId,
    opportunityId: row.opportunityId,
    serviceId: row.serviceId,
    professionalId: row.professionalId,
    roomResourceId: row.roomResourceId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    occupiesUntil: row.occupiesUntil,
    timezone: row.timezone,
    status: row.status,
    activeChargeId: row.activeChargeId,
    waivedReason: row.waivedReason,
    waivedByClerkUserId: row.waivedByClerkUserId,
    waivedAt: row.waivedAt,
    appointmentId: row.appointmentId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** Resumo de sinal do serviço para UI (valor calculado). */
export function serializeServiceSignal(svc: ServiceRow) {
  const amount = computeSignalAmountCents(
    {
      requiresSignal: svc.requiresSignal,
      kind: svc.signalKind,
      fixedCents: svc.signalFixedCents,
      percent: svc.signalPercent,
    },
    svc.priceCents,
  )
  return {
    requiresSignal: svc.requiresSignal,
    signalKind: svc.signalKind,
    signalFixedCents: svc.signalFixedCents,
    signalPercent: svc.signalPercent,
    signalAmountCents: amount.ok ? amount.amountCents : null,
  }
}
