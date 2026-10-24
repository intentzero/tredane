import type {
  PixAccountStatus,
  PixChargeStatus,
  PixEnvironment,
  PixPaidWithoutSlotReason,
  PixPaymentAlertStatus,
  PixPaymentResolution,
  PixProviderCreateState,
  SchedulingIntentStatus,
} from '../constants'
import type { SignalKind } from '../../pix/money'
import type { OutboxRow } from '../outbox'

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

export type SchedulingIntentRow = {
  id: string
  tenantId: string
  conversationId: string
  contactId: string
  opportunityId: string | null
  serviceId: string
  professionalId: string
  roomResourceId: string | null
  startsAt: number
  endsAt: number
  occupiesUntil: number
  timezone: string
  status: SchedulingIntentStatus
  activeChargeId: string | null
  waivedReason: string | null
  waivedByClerkUserId: string | null
  waivedAt: number | null
  appointmentId: string | null
  createdByClerkUserId: string
  createdAt: number
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
  schedulingIntentId: string | null
  conversationId: string | null
  contactId: string | null
  opportunityId: string | null
  messageId: string | null
  outboundMessageId: string | null
  professionalId: string | null
  roomResourceId: string | null
  startsAt: number | null
  endsAt: number | null
  occupiesUntil: number | null
  timezone: string | null
  cancellationPolicySnapshot: string | null
  deadlineSecondsSnapshot: number | null
  signalKindSnapshot: SignalKind | null
  signalFixedCentsSnapshot: number | null
  signalPercentSnapshot: number | null
  servicePriceCentsSnapshot: number | null
  idempotencyKey: string | null
  providerCreateState: PixProviderCreateState
  createdByClerkUserId: string | null
  whatsappSendError: string | null
  /** Null enquanto awaiting; preenchido no processamento #39. */
  paymentResolution: PixPaymentResolution | null
  appointmentId: string | null
  paidWithoutSlotReason: PixPaidWithoutSlotReason | null
  createdAt: number
  updatedAt: number
}

export type PixPaymentAlertRow = {
  id: string
  tenantId: string
  chargeId: string
  conversationId: string | null
  contactId: string | null
  opportunityId: string | null
  reason: PixPaidWithoutSlotReason
  status: PixPaymentAlertStatus
  createdAt: number
  updatedAt: number
  resolvedAt: number | null
}

export type ProcessPixPaymentInput = {
  /** Identificador estável do evento do provedor (idempotência). */
  eventId: string
  eventType: 'charge.paid'
  providerChargeId: string
  accountId: string
  amountCents: number
  /** Instantâneo reportado pelo provedor (ISO). */
  occurredAt: string
  /** Recibo D1 (rastreio; opcional em testes unitários). */
  receiptId?: string | null
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

export type CreateSignalChargeInput = {
  clientRequestId: string
  conversationId: string
  contactId?: string | null
  opportunityId?: string | null
  serviceId: string
  professionalId: string
  roomResourceId?: string | null
  startsAt: number
  actorClerkUserId: string
  authorDisplayName?: string | null
}

export type ConfirmWithoutSignalInput = {
  clientRequestId: string
  conversationId?: string | null
  contactId?: string | null
  opportunityId?: string | null
  serviceId: string
  professionalId: string
  roomResourceId?: string | null
  startsAt: number
  contactLabel?: string | null
  /** Motivo obrigatório (AC-51). */
  waiveReason: string
  actorClerkUserId: string
  /** Cobrança aberta a superseder (opcional; senão procura por conversa/slot). */
  supersedeChargeId?: string | null
}

export type SignalChargeResult = {
  intent: SchedulingIntentRow
  charge: PixChargeRow
  messageId: string | null
  outboundMessageId: string | null
  whatsappSendError: string | null
  outbox: OutboxRow[]
  idempotentReplay: boolean
}

export type ConfirmWithoutSignalResult = {
  appointmentId: string
  intent: SchedulingIntentRow | null
  supersededChargeId: string | null
  outbox: OutboxRow[]
  idempotentReplay: boolean
  detail: unknown
}
