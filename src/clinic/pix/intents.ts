import type { Clock } from '../../db/clock'
import type { SchedulingIntentStatus } from '../constants'
import { newId } from '../ids'
import type { ClinicDb } from '../store'
import type { SchedulingIntentRow } from './types'

type IntentSql = {
  id: string
  tenant_id: string
  conversation_id: string
  contact_id: string
  opportunity_id: string | null
  service_id: string
  professional_id: string
  room_resource_id: string | null
  starts_at: number
  ends_at: number
  occupies_until: number
  timezone: string
  status: string
  active_charge_id: string | null
  waived_reason: string | null
  waived_by_clerk_user_id: string | null
  waived_at: number | null
  appointment_id: string | null
  created_by_clerk_user_id: string
  created_at: number
  updated_at: number
}

function mapRow(row: IntentSql): SchedulingIntentRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    opportunityId: row.opportunity_id,
    serviceId: row.service_id,
    professionalId: row.professional_id,
    roomResourceId: row.room_resource_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    occupiesUntil: row.occupies_until,
    timezone: row.timezone,
    status: row.status as SchedulingIntentStatus,
    activeChargeId: row.active_charge_id,
    waivedReason: row.waived_reason,
    waivedByClerkUserId: row.waived_by_clerk_user_id,
    waivedAt: row.waived_at,
    appointmentId: row.appointment_id,
    createdByClerkUserId: row.created_by_clerk_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export type CreateSchedulingIntentInput = {
  conversationId: string
  contactId: string
  opportunityId?: string | null
  serviceId: string
  professionalId: string
  roomResourceId?: string | null
  startsAt: number
  endsAt: number
  occupiesUntil: number
  timezone: string
  createdByClerkUserId: string
  activeChargeId?: string | null
}

export function createSchedulingIntent(
  db: ClinicDb,
  tenantId: string,
  input: CreateSchedulingIntentInput,
  clock: Clock,
): SchedulingIntentRow {
  const now = clock.nowMs()
  const id = newId('schint')
  db.run(
    `INSERT INTO scheduling_intents (
      id, tenant_id, conversation_id, contact_id, opportunity_id,
      service_id, professional_id, room_resource_id,
      starts_at, ends_at, occupies_until, timezone, status,
      active_charge_id, waived_reason, waived_by_clerk_user_id, waived_at,
      appointment_id, created_by_clerk_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_signal', ?, NULL, NULL, NULL, NULL, ?, ?, ?)`,
    id,
    tenantId,
    input.conversationId,
    input.contactId,
    input.opportunityId ?? null,
    input.serviceId,
    input.professionalId,
    input.roomResourceId ?? null,
    input.startsAt,
    input.endsAt,
    input.occupiesUntil,
    input.timezone,
    input.activeChargeId ?? null,
    input.createdByClerkUserId,
    now,
    now,
  )
  return getSchedulingIntent(db, tenantId, id)!
}

export function getSchedulingIntent(
  db: ClinicDb,
  tenantId: string,
  intentId: string,
): SchedulingIntentRow | null {
  const row = db.get<IntentSql>(
    `SELECT * FROM scheduling_intents WHERE tenant_id = ? AND id = ?`,
    tenantId,
    intentId,
  )
  return row ? mapRow(row) : null
}

export function listOpenSchedulingIntentsForConversation(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): SchedulingIntentRow[] {
  return db
    .all<IntentSql>(
      `SELECT * FROM scheduling_intents
       WHERE tenant_id = ? AND conversation_id = ? AND status = 'awaiting_signal'
       ORDER BY created_at DESC, id`,
      tenantId,
      conversationId,
    )
    .map(mapRow)
}

export function listOpenSchedulingIntentsForOpportunity(
  db: ClinicDb,
  tenantId: string,
  opportunityId: string,
): SchedulingIntentRow[] {
  return db
    .all<IntentSql>(
      `SELECT * FROM scheduling_intents
       WHERE tenant_id = ? AND opportunity_id = ? AND status = 'awaiting_signal'
       ORDER BY created_at DESC, id`,
      tenantId,
      opportunityId,
    )
    .map(mapRow)
}

export function updateSchedulingIntent(
  db: ClinicDb,
  tenantId: string,
  intentId: string,
  patch: {
    status: SchedulingIntentStatus
    activeChargeId?: string | null
    waivedReason?: string | null
    waivedByClerkUserId?: string | null
    waivedAt?: number | null
    appointmentId?: string | null
  },
  clock: Clock,
): SchedulingIntentRow {
  const current = getSchedulingIntent(db, tenantId, intentId)
  if (!current) {
    throw new Error(`scheduling_intent ${intentId} not found`)
  }
  const now = clock.nowMs()
  const next = {
    status: patch.status,
    activeChargeId:
      patch.activeChargeId !== undefined
        ? patch.activeChargeId
        : current.activeChargeId,
    waivedReason:
      patch.waivedReason !== undefined ? patch.waivedReason : current.waivedReason,
    waivedByClerkUserId:
      patch.waivedByClerkUserId !== undefined
        ? patch.waivedByClerkUserId
        : current.waivedByClerkUserId,
    waivedAt: patch.waivedAt !== undefined ? patch.waivedAt : current.waivedAt,
    appointmentId:
      patch.appointmentId !== undefined
        ? patch.appointmentId
        : current.appointmentId,
  }
  db.run(
    `UPDATE scheduling_intents SET
      status = ?,
      active_charge_id = ?,
      waived_reason = ?,
      waived_by_clerk_user_id = ?,
      waived_at = ?,
      appointment_id = ?,
      updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    next.status,
    next.activeChargeId,
    next.waivedReason,
    next.waivedByClerkUserId,
    next.waivedAt,
    next.appointmentId,
    now,
    tenantId,
    intentId,
  )
  return getSchedulingIntent(db, tenantId, intentId)!
}

export function setIntentActiveCharge(
  db: ClinicDb,
  tenantId: string,
  intentId: string,
  chargeId: string,
  clock: Clock,
): void {
  db.run(
    `UPDATE scheduling_intents SET active_charge_id = ?, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    chargeId,
    clock.nowMs(),
    tenantId,
    intentId,
  )
}
