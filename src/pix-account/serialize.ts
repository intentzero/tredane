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
  return {
    id: row.id,
    accountId: row.accountId,
    provider: row.provider,
    providerChargeId: row.providerChargeId,
    externalReference: row.externalReference,
    amountCents: row.amountCents,
    status: row.status,
    expiresAt: row.expiresAt,
    paidAt: row.paidAt,
    cancelledAt: row.cancelledAt,
    serviceId: row.serviceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // pixCopyPaste só em fluxos de cobrança (#38) — não listar em massa
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
