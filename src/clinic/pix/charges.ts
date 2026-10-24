import type { Clock } from '../../db/clock'
import type { SignalKind } from '../../pix/money'
import { newId } from '../ids'
import type { ClinicDb } from '../store'
import type {
  PixChargeStatus,
  PixPaidWithoutSlotReason,
  PixPaymentResolution,
  PixProviderCreateState,
} from '../constants'
import type { PixChargeRow, RecordChargeInput } from './types'

type ChargeSql = {
  id: string
  tenant_id: string
  account_id: string
  provider: string
  provider_charge_id: string | null
  external_reference: string
  amount_cents: number
  status: string
  pix_copy_paste: string | null
  expires_at: number | null
  paid_at: number | null
  cancelled_at: number | null
  service_id: string | null
  scheduling_intent_id?: string | null
  conversation_id?: string | null
  contact_id?: string | null
  opportunity_id?: string | null
  message_id?: string | null
  outbound_message_id?: string | null
  professional_id?: string | null
  room_resource_id?: string | null
  starts_at?: number | null
  ends_at?: number | null
  occupies_until?: number | null
  timezone?: string | null
  cancellation_policy_snapshot?: string | null
  deadline_seconds_snapshot?: number | null
  signal_kind_snapshot?: string | null
  signal_fixed_cents_snapshot?: number | null
  signal_percent_snapshot?: number | null
  service_price_cents_snapshot?: number | null
  idempotency_key?: string | null
  provider_create_state?: string | null
  created_by_clerk_user_id?: string | null
  whatsapp_send_error?: string | null
  payment_resolution?: string | null
  appointment_id?: string | null
  paid_without_slot_reason?: string | null
  created_at: number
  updated_at: number
}

function mapRow(row: ChargeSql): PixChargeRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    accountId: row.account_id,
    provider: row.provider,
    providerChargeId: row.provider_charge_id,
    externalReference: row.external_reference,
    amountCents: row.amount_cents,
    status: row.status as PixChargeStatus,
    pixCopyPaste: row.pix_copy_paste,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    cancelledAt: row.cancelled_at,
    serviceId: row.service_id,
    schedulingIntentId: row.scheduling_intent_id ?? null,
    conversationId: row.conversation_id ?? null,
    contactId: row.contact_id ?? null,
    opportunityId: row.opportunity_id ?? null,
    messageId: row.message_id ?? null,
    outboundMessageId: row.outbound_message_id ?? null,
    professionalId: row.professional_id ?? null,
    roomResourceId: row.room_resource_id ?? null,
    startsAt: row.starts_at ?? null,
    endsAt: row.ends_at ?? null,
    occupiesUntil: row.occupies_until ?? null,
    timezone: row.timezone ?? null,
    cancellationPolicySnapshot: row.cancellation_policy_snapshot ?? null,
    deadlineSecondsSnapshot: row.deadline_seconds_snapshot ?? null,
    signalKindSnapshot: (row.signal_kind_snapshot as SignalKind | null) ?? null,
    signalFixedCentsSnapshot: row.signal_fixed_cents_snapshot ?? null,
    signalPercentSnapshot: row.signal_percent_snapshot ?? null,
    servicePriceCentsSnapshot: row.service_price_cents_snapshot ?? null,
    idempotencyKey: row.idempotency_key ?? null,
    providerCreateState: (row.provider_create_state as PixProviderCreateState) ??
      'confirmed',
    createdByClerkUserId: row.created_by_clerk_user_id ?? null,
    whatsappSendError: row.whatsapp_send_error ?? null,
    paymentResolution: (row.payment_resolution as PixPaymentResolution | null) ?? null,
    appointmentId: row.appointment_id ?? null,
    paidWithoutSlotReason:
      (row.paid_without_slot_reason as PixPaidWithoutSlotReason | null) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function recordPixCharge(
  db: ClinicDb,
  tenantId: string,
  input: RecordChargeInput,
  clock: Clock,
): PixChargeRow {
  const now = clock.nowMs()
  const existing = db.get<ChargeSql>(
    `SELECT * FROM pix_charges WHERE tenant_id = ? AND external_reference = ?`,
    tenantId,
    input.externalReference,
  )
  if (existing) {
    return mapRow(existing)
  }
  const id = newId('pixchg')
  db.run(
    `INSERT INTO pix_charges (
      id, tenant_id, account_id, provider, provider_charge_id, external_reference,
      amount_cents, status, pix_copy_paste, expires_at, paid_at, cancelled_at,
      service_id, provider_create_state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'confirmed', ?, ?)`,
    id,
    tenantId,
    input.accountId,
    input.provider,
    input.providerChargeId,
    input.externalReference,
    input.amountCents,
    input.status,
    input.pixCopyPaste ?? null,
    input.expiresAt ?? null,
    input.serviceId ?? null,
    now,
    now,
  )
  return getPixCharge(db, tenantId, id)!
}

export type InsertPendingSignalChargeInput = {
  id?: string
  accountId: string
  provider: string
  externalReference: string
  idempotencyKey: string
  amountCents: number
  serviceId: string
  schedulingIntentId: string
  conversationId: string
  contactId: string
  opportunityId?: string | null
  professionalId: string
  roomResourceId?: string | null
  startsAt: number
  endsAt: number
  occupiesUntil: number
  timezone: string
  cancellationPolicySnapshot: string
  deadlineSecondsSnapshot: number
  signalKindSnapshot: SignalKind
  signalFixedCentsSnapshot: number | null
  signalPercentSnapshot: number | null
  servicePriceCentsSnapshot: number | null
  createdByClerkUserId: string
  expiresAt: number
}

export function insertPendingSignalCharge(
  db: ClinicDb,
  tenantId: string,
  input: InsertPendingSignalChargeInput,
  clock: Clock,
): PixChargeRow {
  const now = clock.nowMs()
  const byIdem = db.get<ChargeSql>(
    `SELECT * FROM pix_charges WHERE tenant_id = ? AND idempotency_key = ?`,
    tenantId,
    input.idempotencyKey,
  )
  if (byIdem) return mapRow(byIdem)
  const byRef = db.get<ChargeSql>(
    `SELECT * FROM pix_charges WHERE tenant_id = ? AND external_reference = ?`,
    tenantId,
    input.externalReference,
  )
  if (byRef) return mapRow(byRef)

  const id = input.id ?? newId('pixchg')
  db.run(
    `INSERT INTO pix_charges (
      id, tenant_id, account_id, provider, provider_charge_id, external_reference,
      amount_cents, status, pix_copy_paste, expires_at, paid_at, cancelled_at,
      service_id, scheduling_intent_id, conversation_id, contact_id, opportunity_id,
      message_id, outbound_message_id, professional_id, room_resource_id,
      starts_at, ends_at, occupies_until, timezone,
      cancellation_policy_snapshot, deadline_seconds_snapshot,
      signal_kind_snapshot, signal_fixed_cents_snapshot, signal_percent_snapshot,
      service_price_cents_snapshot, idempotency_key, provider_create_state,
      created_by_clerk_user_id, whatsapp_send_error, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, NULL, ?, ?, 'awaiting_payment', NULL, ?, NULL, NULL,
      ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending',
      ?, NULL, ?, ?
    )`,
    id,
    tenantId,
    input.accountId,
    input.provider,
    input.externalReference,
    input.amountCents,
    input.expiresAt,
    input.serviceId,
    input.schedulingIntentId,
    input.conversationId,
    input.contactId,
    input.opportunityId ?? null,
    input.professionalId,
    input.roomResourceId ?? null,
    input.startsAt,
    input.endsAt,
    input.occupiesUntil,
    input.timezone,
    input.cancellationPolicySnapshot,
    input.deadlineSecondsSnapshot,
    input.signalKindSnapshot,
    input.signalFixedCentsSnapshot,
    input.signalPercentSnapshot,
    input.servicePriceCentsSnapshot,
    input.idempotencyKey,
    input.createdByClerkUserId,
    now,
    now,
  )
  return getPixCharge(db, tenantId, id)!
}

export function applyProviderChargeResult(
  db: ClinicDb,
  tenantId: string,
  chargeId: string,
  result:
    | {
        state: 'confirmed'
        providerChargeId: string
        pixCopyPaste: string
        expiresAt: number
      }
    | { state: 'uncertain' }
    | { state: 'failed'; message?: string },
  clock: Clock,
): PixChargeRow {
  const now = clock.nowMs()
  if (result.state === 'confirmed') {
    db.run(
      `UPDATE pix_charges SET
        provider_charge_id = ?, pix_copy_paste = ?, expires_at = ?,
        provider_create_state = 'confirmed', status = 'awaiting_payment',
        updated_at = ?
       WHERE tenant_id = ? AND id = ?`,
      result.providerChargeId,
      result.pixCopyPaste,
      result.expiresAt,
      now,
      tenantId,
      chargeId,
    )
  } else if (result.state === 'uncertain') {
    db.run(
      `UPDATE pix_charges SET provider_create_state = 'uncertain', updated_at = ?
       WHERE tenant_id = ? AND id = ?`,
      now,
      tenantId,
      chargeId,
    )
  } else {
    db.run(
      `UPDATE pix_charges SET
        provider_create_state = 'failed', status = 'cancelled',
        cancelled_at = ?, whatsapp_send_error = ?, updated_at = ?
       WHERE tenant_id = ? AND id = ?`,
      now,
      result.message?.slice(0, 500) ?? 'provider_create_failed',
      now,
      tenantId,
      chargeId,
    )
  }
  return getPixCharge(db, tenantId, chargeId)!
}

export function linkChargeMessage(
  db: ClinicDb,
  tenantId: string,
  chargeId: string,
  messageId: string,
  outboundMessageId: string,
  clock: Clock,
  whatsappSendError?: string | null,
): PixChargeRow {
  const now = clock.nowMs()
  db.run(
    `UPDATE pix_charges SET
      message_id = ?, outbound_message_id = ?,
      whatsapp_send_error = ?, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    messageId,
    outboundMessageId,
    whatsappSendError ?? null,
    now,
    tenantId,
    chargeId,
  )
  return getPixCharge(db, tenantId, chargeId)!
}

export function markChargeWhatsappError(
  db: ClinicDb,
  tenantId: string,
  chargeId: string,
  error: string,
  clock: Clock,
): PixChargeRow {
  db.run(
    `UPDATE pix_charges SET whatsapp_send_error = ?, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    error.slice(0, 500),
    clock.nowMs(),
    tenantId,
    chargeId,
  )
  return getPixCharge(db, tenantId, chargeId)!
}

export function markChargeCancelled(
  db: ClinicDb,
  tenantId: string,
  chargeId: string,
  clock: Clock,
): PixChargeRow {
  const now = clock.nowMs()
  db.run(
    `UPDATE pix_charges SET status = 'cancelled', cancelled_at = ?, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    now,
    now,
    tenantId,
    chargeId,
  )
  return getPixCharge(db, tenantId, chargeId)!
}

export function getPixCharge(
  db: ClinicDb,
  tenantId: string,
  chargeId: string,
): PixChargeRow | null {
  const row = db.get<ChargeSql>(
    `SELECT * FROM pix_charges WHERE tenant_id = ? AND id = ?`,
    tenantId,
    chargeId,
  )
  return row ? mapRow(row) : null
}

/** Lookup por id do provedor (correlationID Woovi) ou external_reference. */
export function findPixChargeByProviderId(
  db: ClinicDb,
  tenantId: string,
  providerChargeId: string,
): PixChargeRow | null {
  const byProvider = db.get<ChargeSql>(
    `SELECT * FROM pix_charges
     WHERE tenant_id = ? AND provider_charge_id = ?
     LIMIT 1`,
    tenantId,
    providerChargeId,
  )
  if (byProvider) return mapRow(byProvider)
  const byExternal = db.get<ChargeSql>(
    `SELECT * FROM pix_charges
     WHERE tenant_id = ? AND external_reference = ?
     LIMIT 1`,
    tenantId,
    providerChargeId,
  )
  return byExternal ? mapRow(byExternal) : null
}

export function markChargePaidConfirmed(
  db: ClinicDb,
  tenantId: string,
  chargeId: string,
  appointmentId: string,
  paidAt: number,
  clock: Clock,
): PixChargeRow {
  const now = clock.nowMs()
  db.run(
    `UPDATE pix_charges SET
      status = 'paid',
      paid_at = ?,
      payment_resolution = 'appointment_confirmed',
      appointment_id = ?,
      paid_without_slot_reason = NULL,
      updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    paidAt,
    appointmentId,
    now,
    tenantId,
    chargeId,
  )
  return getPixCharge(db, tenantId, chargeId)!
}

export function markChargePaidWithoutSlot(
  db: ClinicDb,
  tenantId: string,
  chargeId: string,
  reason: PixPaidWithoutSlotReason,
  paidAt: number,
  clock: Clock,
): PixChargeRow {
  const now = clock.nowMs()
  db.run(
    `UPDATE pix_charges SET
      status = 'paid',
      paid_at = ?,
      payment_resolution = 'paid_without_slot',
      paid_without_slot_reason = ?,
      updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    paidAt,
    reason,
    now,
    tenantId,
    chargeId,
  )
  return getPixCharge(db, tenantId, chargeId)!
}

export function getPixChargeByIdempotencyKey(
  db: ClinicDb,
  tenantId: string,
  idempotencyKey: string,
): PixChargeRow | null {
  const row = db.get<ChargeSql>(
    `SELECT * FROM pix_charges WHERE tenant_id = ? AND idempotency_key = ?`,
    tenantId,
    idempotencyKey,
  )
  return row ? mapRow(row) : null
}

export function listPixChargesByAccount(
  db: ClinicDb,
  tenantId: string,
  accountId: string,
): PixChargeRow[] {
  return db
    .all<ChargeSql>(
      `SELECT * FROM pix_charges
       WHERE tenant_id = ? AND account_id = ?
       ORDER BY created_at DESC, id`,
      tenantId,
      accountId,
    )
    .map(mapRow)
}

export function listPixCharges(
  db: ClinicDb,
  tenantId: string,
): PixChargeRow[] {
  return db
    .all<ChargeSql>(
      `SELECT * FROM pix_charges WHERE tenant_id = ? ORDER BY created_at DESC, id`,
      tenantId,
    )
    .map(mapRow)
}

export function listPixChargesForConversation(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): PixChargeRow[] {
  return db
    .all<ChargeSql>(
      `SELECT * FROM pix_charges
       WHERE tenant_id = ? AND conversation_id = ?
       ORDER BY created_at DESC, id`,
      tenantId,
      conversationId,
    )
    .map(mapRow)
}

export function countPixCharges(
  db: ClinicDb,
  tenantId: string,
): number {
  return (
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM pix_charges WHERE tenant_id = ?`,
      tenantId,
    )?.n ?? 0
  )
}

export function countAppointmentAllocations(
  db: ClinicDb,
  tenantId: string,
): number {
  return (
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM appointment_allocations WHERE tenant_id = ?`,
      tenantId,
    )?.n ?? 0
  )
}
