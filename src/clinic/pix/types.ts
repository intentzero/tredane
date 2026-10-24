import type {
  PixAccountStatus,
  PixChargeStatus,
  PixEnvironment,
} from '../constants'
import type { SignalKind } from '../../pix/money'

export type PixAccountRow = {
  tenantId: string
  provider: 'woovi'
  status: PixAccountStatus
  accountId: string | null
  /** Cipher — nunca expor na API. */
  appIdCipher: string | null
  appIdHint: string | null
  environment: PixEnvironment
  credentialVersion: number
  connectedAt: number | null
  connectedByClerkUserId: string | null
  disconnectedAt: number | null
  revokedAt: number | null
  revokeReason: string | null
  updatedAt: number
}

/** Visão segura para API/UI — sem cipher/App ID. */
export type PixAccountPublic = {
  provider: 'woovi'
  status: PixAccountStatus
  accountId: string | null
  appIdHint: string | null
  environment: PixEnvironment
  credentialVersion: number
  connectedAt: number | null
  connectedByClerkUserId: string | null
  disconnectedAt: number | null
  revokedAt: number | null
  revokeReason: string | null
  updatedAt: number
  /** Sem conta connected → cobrança bloqueada (AC-45). */
  canCreateCharge: boolean
}

export type PixSignalSettings = {
  tenantId: string
  deadlineSeconds: number
  cancellationPolicy: string
  updatedAt: number
}

export type PixChargeRow = {
  id: string
  tenantId: string
  accountId: string
  provider: string
  providerChargeId: string | null
  externalReference: string
  amountCents: number
  status: PixChargeStatus
  pixCopyPaste: string | null
  expiresAt: number | null
  paidAt: number | null
  cancelledAt: number | null
  serviceId: string | null
  createdAt: number
  updatedAt: number
}

export type ServiceSignalFields = {
  requiresSignal: boolean
  signalKind: SignalKind | null
  signalFixedCents: number | null
  signalPercent: number | null
  /** Valor calculado quando possível; null se incompleto. */
  signalAmountCents: number | null
}

export type ConnectPixInput = {
  appId: string
  /** Actor Clerk (owner). */
  clerkUserId: string
  environment?: PixEnvironment
}

export type UpdateSignalSettingsInput = {
  deadlineSeconds?: number
  cancellationPolicy?: string
}

export type RecordChargeInput = {
  accountId: string
  provider: string
  providerChargeId: string
  externalReference: string
  amountCents: number
  status: PixChargeStatus
  pixCopyPaste?: string | null
  expiresAt?: number | null
  serviceId?: string | null
}
