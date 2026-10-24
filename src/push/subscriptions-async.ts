/**
 * Assinaturas Web Push em D1 assíncrono (Worker HTTP / queue).
 */
import type { Clock } from '../db/clock'
import { ADMIN_SCHEMA_VERSION } from '../db/admin/constants'
import { SchemaNotReadyError } from '../db/admin/errors'
import type { AsyncAdminDb } from '../db/admin/async-store'
import { newId } from '../clinic/ids'
import type { PushSubscriptionInput, PushSubscriptionRow } from './types'

async function assertReady(db: AsyncAdminDb): Promise<void> {
  const row = await db.get<{ version: number }>(
    'SELECT version FROM admin_schema_state WHERE id = 1',
  )
  if (!row) throw new SchemaNotReadyError('versão administrativa ausente')
  if (row.version !== ADMIN_SCHEMA_VERSION) {
    throw new SchemaNotReadyError(
      `esperada ${ADMIN_SCHEMA_VERSION}, encontrada ${row.version}`,
    )
  }
}

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

const SELECT_COLS = `id, tenant_id, clerk_user_id, endpoint, p256dh, auth, expiration_time,
            user_agent, notify_new_conversation, created_at, updated_at, last_seen_at`

export async function upsertPushSubscriptionAsync(
  db: AsyncAdminDb,
  clock: Clock,
  input: {
    tenantId: string
    clerkUserId: string
    subscription: PushSubscriptionInput
    userAgent?: string | null
    notifyNewConversation?: boolean
  },
): Promise<PushSubscriptionRow> {
  await assertReady(db)
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
  const existing = await db.get<{ id: string }>(
    `SELECT id FROM push_subscriptions WHERE endpoint = ?`,
    endpoint,
  )

  if (existing) {
    await db.run(
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
    return (await getPushSubscriptionByIdAsync(db, existing.id))!
  }

  const id = newId('psub')
  await db.run(
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
  return (await getPushSubscriptionByIdAsync(db, id))!
}

export async function getPushSubscriptionByIdAsync(
  db: AsyncAdminDb,
  id: string,
): Promise<PushSubscriptionRow | undefined> {
  await assertReady(db)
  const row = await db.get<{
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
  }>(`SELECT ${SELECT_COLS} FROM push_subscriptions WHERE id = ?`, id)
  return row ? mapRow(row) : undefined
}

export async function listPushSubscriptionsForUserAsync(
  db: AsyncAdminDb,
  tenantId: string,
  clerkUserId: string,
): Promise<PushSubscriptionRow[]> {
  await assertReady(db)
  const rows = await db.all<{
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
    `SELECT ${SELECT_COLS} FROM push_subscriptions
     WHERE tenant_id = ? AND clerk_user_id = ?
     ORDER BY updated_at DESC`,
    tenantId,
    clerkUserId,
  )
  return rows.map(mapRow)
}

export async function listNewConversationSubscriptionsAsync(
  db: AsyncAdminDb,
  tenantId: string,
): Promise<PushSubscriptionRow[]> {
  await assertReady(db)
  const rows = await db.all<{
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
    `SELECT ${SELECT_COLS} FROM push_subscriptions
     WHERE tenant_id = ? AND notify_new_conversation = 1`,
    tenantId,
  )
  return rows.map(mapRow)
}

export async function deletePushSubscriptionByEndpointAsync(
  db: AsyncAdminDb,
  input: { tenantId: string; clerkUserId: string; endpoint: string },
): Promise<boolean> {
  await assertReady(db)
  const result = await db.run(
    `DELETE FROM push_subscriptions
     WHERE tenant_id = ? AND clerk_user_id = ? AND endpoint = ?`,
    input.tenantId,
    input.clerkUserId,
    input.endpoint,
  )
  return result.changes > 0
}

export async function deletePushSubscriptionsForMemberAsync(
  db: AsyncAdminDb,
  tenantId: string,
  clerkUserId: string,
): Promise<number> {
  await assertReady(db)
  const result = await db.run(
    `DELETE FROM push_subscriptions WHERE tenant_id = ? AND clerk_user_id = ?`,
    tenantId,
    clerkUserId,
  )
  return result.changes
}

export async function deletePushSubscriptionByIdAsync(
  db: AsyncAdminDb,
  id: string,
): Promise<boolean> {
  await assertReady(db)
  const result = await db.run(`DELETE FROM push_subscriptions WHERE id = ?`, id)
  return result.changes > 0
}

export async function updatePushPreferenceAsync(
  db: AsyncAdminDb,
  clock: Clock,
  input: {
    tenantId: string
    clerkUserId: string
    endpoint?: string
    notifyNewConversation: boolean
  },
): Promise<number> {
  await assertReady(db)
  const now = clock.nowMs()
  if (input.endpoint) {
    const result = await db.run(
      `UPDATE push_subscriptions
       SET notify_new_conversation = ?, updated_at = ?
       WHERE tenant_id = ? AND clerk_user_id = ? AND endpoint = ?`,
      input.notifyNewConversation ? 1 : 0,
      now,
      input.tenantId,
      input.clerkUserId,
      input.endpoint,
    )
    return result.changes
  }
  const result = await db.run(
    `UPDATE push_subscriptions
     SET notify_new_conversation = ?, updated_at = ?
     WHERE tenant_id = ? AND clerk_user_id = ?`,
    input.notifyNewConversation ? 1 : 0,
    now,
    input.tenantId,
    input.clerkUserId,
  )
  return result.changes
}
