/**
 * Persistência D1 de assinaturas Web Push (#42).
 */
import type { Clock } from '../db/clock'
import { assertAdminSchemaReady } from '../db/admin/gate'
import type { AdminDb } from '../db/admin/store'
import { newId } from '../clinic/ids'
import type { PushSubscriptionInput, PushSubscriptionRow } from './types'

function mapRow(row: {
  id: string
  tenant_id: string
  clerk_user_id: string
  endpoint: string
  p256dh: string
  auth: string
  expiration_time: number | null
  user_agent: string | null
  notify_new_conversation: number
  created_at: number
  updated_at: number
  last_seen_at: number
}): PushSubscriptionRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clerkUserId: row.clerk_user_id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    expirationTime: row.expiration_time,
    userAgent: row.user_agent,
    notifyNewConversation: row.notify_new_conversation === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
  }
}

export function upsertPushSubscription(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    clerkUserId: string
    subscription: PushSubscriptionInput
    userAgent?: string | null
    notifyNewConversation?: boolean
  },
): PushSubscriptionRow {
  assertAdminSchemaReady(db)
  const endpoint = input.subscription.endpoint.trim()
  if (!endpoint.startsWith('https://') && !endpoint.startsWith('http://localhost')) {
    throw new Error('invalid_push_endpoint')
  }
  const p256dh = input.subscription.keys.p256dh?.trim()
  const auth = input.subscription.keys.auth?.trim()
  if (!p256dh || !auth) throw new Error('invalid_push_keys')

  const now = clock.nowMs()
  const notify =
    input.notifyNewConversation === undefined ? true : Boolean(input.notifyNewConversation)
  const existing = db.get<{ id: string }>(
    `SELECT id FROM push_subscriptions WHERE endpoint = ?`,
    endpoint,
  )

  if (existing) {
    db.run(
      `UPDATE push_subscriptions
       SET tenant_id = ?, clerk_user_id = ?, p256dh = ?, auth = ?,
           expiration_time = ?, user_agent = ?, notify_new_conversation = ?,
           updated_at = ?, last_seen_at = ?
       WHERE id = ?`,
      input.tenantId,
      input.clerkUserId,
      p256dh,
      auth,
      input.subscription.expirationTime ?? null,
      input.userAgent ?? null,
      notify ? 1 : 0,
      now,
      now,
      existing.id,
    )
    return getPushSubscriptionById(db, existing.id)!
  }

  const id = newId('psub')
  db.run(
    `INSERT INTO push_subscriptions (
       id, tenant_id, clerk_user_id, endpoint, p256dh, auth, expiration_time,
       user_agent, notify_new_conversation, created_at, updated_at, last_seen_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.tenantId,
    input.clerkUserId,
    endpoint,
    p256dh,
    auth,
    input.subscription.expirationTime ?? null,
    input.userAgent ?? null,
    notify ? 1 : 0,
    now,
    now,
    now,
  )
  return getPushSubscriptionById(db, id)!
}

export function getPushSubscriptionById(
  db: AdminDb,
  id: string,
): PushSubscriptionRow | undefined {
  assertAdminSchemaReady(db)
  const row = db.get<{
    id: string
    tenant_id: string
    clerk_user_id: string
    endpoint: string
    p256dh: string
    auth: string
    expiration_time: number | null
    user_agent: string | null
    notify_new_conversation: number
    created_at: number
    updated_at: number
    last_seen_at: number
  }>(
    `SELECT id, tenant_id, clerk_user_id, endpoint, p256dh, auth, expiration_time,
            user_agent, notify_new_conversation, created_at, updated_at, last_seen_at
     FROM push_subscriptions WHERE id = ?`,
    id,
  )
  return row ? mapRow(row) : undefined
}

export function listPushSubscriptionsForUser(
  db: AdminDb,
  tenantId: string,
  clerkUserId: string,
): PushSubscriptionRow[] {
  assertAdminSchemaReady(db)
  const rows = db.all<{
    id: string
    tenant_id: string
    clerk_user_id: string
    endpoint: string
    p256dh: string
    auth: string
    expiration_time: number | null
    user_agent: string | null
    notify_new_conversation: number
    created_at: number
    updated_at: number
    last_seen_at: number
  }>(
    `SELECT id, tenant_id, clerk_user_id, endpoint, p256dh, auth, expiration_time,
            user_agent, notify_new_conversation, created_at, updated_at, last_seen_at
     FROM push_subscriptions
     WHERE tenant_id = ? AND clerk_user_id = ?
     ORDER BY updated_at DESC`,
    tenantId,
    clerkUserId,
  )
  return rows.map(mapRow)
}

/** Destinatários com preferência de nova conversa ligada — revalidar membership no caller. */
export function listNewConversationSubscriptions(
  db: AdminDb,
  tenantId: string,
): PushSubscriptionRow[] {
  assertAdminSchemaReady(db)
  const rows = db.all<{
    id: string
    tenant_id: string
    clerk_user_id: string
    endpoint: string
    p256dh: string
    auth: string
    expiration_time: number | null
    user_agent: string | null
    notify_new_conversation: number
    created_at: number
    updated_at: number
    last_seen_at: number
  }>(
    `SELECT id, tenant_id, clerk_user_id, endpoint, p256dh, auth, expiration_time,
            user_agent, notify_new_conversation, created_at, updated_at, last_seen_at
     FROM push_subscriptions
     WHERE tenant_id = ? AND notify_new_conversation = 1`,
    tenantId,
  )
  return rows.map(mapRow)
}

export function deletePushSubscriptionByEndpoint(
  db: AdminDb,
  input: { tenantId: string; clerkUserId: string; endpoint: string },
): boolean {
  assertAdminSchemaReady(db)
  const result = db.run(
    `DELETE FROM push_subscriptions
     WHERE tenant_id = ? AND clerk_user_id = ? AND endpoint = ?`,
    input.tenantId,
    input.clerkUserId,
    input.endpoint,
  )
  return (result.changes ?? 0) > 0
}

export function deletePushSubscriptionsForMember(
  db: AdminDb,
  tenantId: string,
  clerkUserId: string,
): number {
  assertAdminSchemaReady(db)
  const result = db.run(
    `DELETE FROM push_subscriptions WHERE tenant_id = ? AND clerk_user_id = ?`,
    tenantId,
    clerkUserId,
  )
  return result.changes ?? 0
}

export function deletePushSubscriptionById(db: AdminDb, id: string): boolean {
  assertAdminSchemaReady(db)
  const result = db.run(`DELETE FROM push_subscriptions WHERE id = ?`, id)
  return (result.changes ?? 0) > 0
}

export function updatePushPreference(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    clerkUserId: string
    endpoint?: string
    notifyNewConversation: boolean
  },
): number {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  if (input.endpoint) {
    const result = db.run(
      `UPDATE push_subscriptions
       SET notify_new_conversation = ?, updated_at = ?
       WHERE tenant_id = ? AND clerk_user_id = ? AND endpoint = ?`,
      input.notifyNewConversation ? 1 : 0,
      now,
      input.tenantId,
      input.clerkUserId,
      input.endpoint,
    )
    return result.changes ?? 0
  }
  const result = db.run(
    `UPDATE push_subscriptions
     SET notify_new_conversation = ?, updated_at = ?
     WHERE tenant_id = ? AND clerk_user_id = ?`,
    input.notifyNewConversation ? 1 : 0,
    now,
    input.tenantId,
    input.clerkUserId,
  )
  return result.changes ?? 0
}
