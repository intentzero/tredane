import type {
  PixAccountStatus,
  PixAlertResolutionKind,
  PixChargeStatus,
  PixEnvironment,
  PixPaidWithoutSlotReason,
  PixPaymentAlertStatus,
  PixPaymentResolution,
  PixProviderCreateState,
  PixSignalDisposition,
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
  /** Decisão humana Devolver/Reter (#40). */
  signalDisposition: PixSignalDisposition | null
  signalDispositionBy: string | null
  signalDispositionAt: number | null
  signalDispositionNote: string | null
  refundIdempotencyKey: string | null
  refundProviderId: string | null
  refundRequestedAt: number | null
  refundCompletedAt: number | null
  refundFailureReason: string | null
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
  resolutionKind: PixAlertResolutionKind | null
  resolvedByClerkUserId: string | null
  resolvedAppointmentId: string | null
}

export type ResolveAlertAltSlotInput = {
  clientRequestId: string
  alertId: string
  serviceId: string
  professionalId: string
  roomResourceId?: string | null
  startsAt: number
  actorClerkUserId: string
}

export type ResolveAlertRefundInput = {
  clientRequestId: string
  alertId: string
  actorClerkUserId: string
  reason?: string | null
}

export type CancelUnpaidChargeInput = {
  clientRequestId: string
  chargeId: string
  actorClerkUserId: string
}

export type RequestRefundInput = {
  clientRequestId: string
  chargeId: string
  actorClerkUserId: string
  /** Motivo operacional (auditoria); não vai para dados bancários. */
  reason?: string | null
}

export type CancelPaidWithSignalInput = {
  clientRequestId: string
  appointmentId: string
  reason: import('../constants').AppointmentChangeReason
  /** Devolver ou reter — obrigatório quando há sinal pago (REQ-082). */
  signalDisposition: PixSignalDisposition
  actorClerkUserId: string
  expectedVersion?: number | null
  note?: string | null
}

export type ProcessPixLifecycleInput = {
  eventId: string
  eventType: 'charge.expired' | 'charge.cancelled' | 'refund.updated'
  providerChargeId: string
  accountId: string
  amountCents: number
  occurredAt: string
  receiptId?: string | null
  /** Presente em refund.updated. */
  refund?: {
    providerRefundId: string
    status: 'requested' | 'succeeded' | 'failed'
    amountCents: number
    failureReason?: string | null
  } | null
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
  /** DEC-078: zonas da visita. Obrigatório quando o serviço tem zonas ativas. */
  zoneIds?: string[] | null
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
  zoneIds?: string[] | null
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
