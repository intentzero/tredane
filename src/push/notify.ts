/**
 * Fan-out de push de nova conversa (#42 / DEC-040).
 * Autoriza membership ativa no envio; remove subs 404/410; sem conteúdo da mensagem.
 */
import type { Clock } from '../db/clock'
import type { AdminDb } from '../db/admin/store'
import type { AsyncAdminDb } from '../db/admin/async-store'
import { getMembership, getTenant } from '../db/admin'
import {
  deletePushSubscriptionById,
  listNewConversationSubscriptions,
} from './subscriptions'
import {
  deletePushSubscriptionByIdAsync,
  listNewConversationSubscriptionsAsync,
} from './subscriptions-async'
import {
  assertSafePushPayload,
  buildNewConversationPayload,
  buildNewMessagePayload,
  createPushTransport,
} from './send'
import { resolveVapidConfig, type VapidConfig } from './vapid'
import type { PushTransport, PushSendRecord } from './types'
import type { SimulatedPushTransport } from './synthetic'

export type NotifyNewConversationResult = {
  attempted: number
  sent: number
  skippedUnauthorized: number
  removedGone: number
  failed: number
  records: PushSendRecord[]
}

export type NotifyNewConversationDeps = {
  db: AdminDb
  clock: Clock
  vapid?: VapidConfig
  transport?: PushTransport
  simulated?: SimulatedPushTransport
}

export type NotifyNewConversationAsyncDeps = {
  db: AsyncAdminDb
  clock: Clock
  vapid?: VapidConfig
  transport?: PushTransport
  simulated?: SimulatedPushTransport
  /** Nome do tenant quando já conhecido (evita round-trip). */
  tenantName?: string
  tenantStatus?: 'active' | 'suspended' | 'pending_deletion' | 'purged'
}

/**
 * Notifica members com preferência + membership ativa (AdminDb sync — testes).
 */
export async function notifyNewConversation(
  deps: NotifyNewConversationDeps,
  input: {
    tenantId: string
    conversationId: string
    tenantName?: string
    /** Default: nova conversa. `new_message` = mensagem nova em conversa existente. */
    kind?: 'new_conversation' | 'new_message'
  },
): Promise<NotifyNewConversationResult> {
  const tenant = getTenant(deps.db, input.tenantId)
  if (!tenant || tenant.status !== 'active') {
    return emptyResult()
  }

  const payload = (input.kind === 'new_message' ? buildNewMessagePayload : buildNewConversationPayload)({
    tenantId: input.tenantId,
    tenantName: input.tenantName ?? tenant.name,
    conversationId: input.conversationId,
  })
  assertSafePushPayload(payload)

  const vapid = deps.vapid ?? resolveVapidConfig({})
  const transport =
    deps.transport ?? createPushTransport(vapid, { simulated: deps.simulated })

  const subs = listNewConversationSubscriptions(deps.db, input.tenantId)
  return deliverToSubs({
    subs,
    payload,
    vapidMode: vapid.mode,
    transport,
    clock: deps.clock,
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    isAuthorized: (clerkUserId) => {
      const membership = getMembership(deps.db, input.tenantId, clerkUserId)
      return Boolean(membership && membership.status === 'active')
    },
    removeSub: (id) => {
      deletePushSubscriptionById(deps.db, id)
    },
  })
}

/**
 * Variante async para Worker/D1 (queue consumer + harness).
 */
export async function notifyNewConversationAsync(
  deps: NotifyNewConversationAsyncDeps,
  input: {
    tenantId: string
    conversationId: string
    tenantName?: string
    /** Default: nova conversa. `new_message` = mensagem nova em conversa existente. */
    kind?: 'new_conversation' | 'new_message'
  },
): Promise<NotifyNewConversationResult> {
  let tenantName = input.tenantName ?? deps.tenantName
  let status = deps.tenantStatus

  if (!tenantName || !status) {
    const row = await deps.db.get<{ name: string; status: string }>(
      `SELECT name, status FROM tenants WHERE id = ?`,
      input.tenantId,
    )
    if (!row || row.status !== 'active') return emptyResult()
    tenantName = tenantName ?? row.name
    status = row.status as 'active'
  } else if (status !== 'active') {
    return emptyResult()
  }

  const payload = (input.kind === 'new_message' ? buildNewMessagePayload : buildNewConversationPayload)({
    tenantId: input.tenantId,
    tenantName: tenantName!,
    conversationId: input.conversationId,
  })
  assertSafePushPayload(payload)

  const vapid = deps.vapid ?? resolveVapidConfig({})
  const transport =
    deps.transport ?? createPushTransport(vapid, { simulated: deps.simulated })

  const subs = await listNewConversationSubscriptionsAsync(deps.db, input.tenantId)

  return deliverToSubs({
    subs,
    payload,
    vapidMode: vapid.mode,
    transport,
    clock: deps.clock,
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    isAuthorized: async (clerkUserId) => {
      const membership = await deps.db.get<{ status: string }>(
        `SELECT status FROM tenant_memberships
         WHERE tenant_id = ? AND clerk_user_id = ?`,
        input.tenantId,
        clerkUserId,
      )
      return membership?.status === 'active'
    },
    removeSub: async (id) => {
      await deletePushSubscriptionByIdAsync(deps.db, id)
    },
  })
}

function emptyResult(): NotifyNewConversationResult {
  return {
    attempted: 0,
    sent: 0,
    skippedUnauthorized: 0,
    removedGone: 0,
    failed: 0,
    records: [],
  }
}

async function deliverToSubs(input: {
  subs: Array<{
    id: string
    clerkUserId: string
    endpoint: string
    p256dh: string
    auth: string
  }>
  payload: ReturnType<typeof buildNewConversationPayload>
  vapidMode: 'synthetic' | 'live'
  transport: PushTransport
  clock: Clock
  tenantId: string
  conversationId: string
  isAuthorized: (clerkUserId: string) => boolean | Promise<boolean>
  removeSub: (id: string) => void | Promise<void>
}): Promise<NotifyNewConversationResult> {
  let sent = 0
  let skippedUnauthorized = 0
  let removedGone = 0
  let failed = 0
  const records: PushSendRecord[] = []

  for (const sub of input.subs) {
    const authorized = await input.isAuthorized(sub.clerkUserId)
    if (!authorized) {
      await input.removeSub(sub.id)
      skippedUnauthorized += 1
      continue
    }

    const result = await input.transport.send(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      input.payload,
    )

    const record: PushSendRecord = {
      id: `notify_${sub.id}_${input.clock.nowMs()}`,
      tenantId: input.tenantId,
      clerkUserId: sub.clerkUserId,
      endpoint: sub.endpoint,
      conversationId: input.conversationId,
      payload: input.payload,
      sentAt: input.clock.nowMs(),
      mode: input.vapidMode,
      status: result.ok ? 'sent' : result.gone ? 'gone' : 'failed',
      errorCode: result.ok
        ? undefined
        : result.gone
          ? 'gone'
          : 'errorCode' in result
            ? result.errorCode
            : 'failed',
    }
    records.push(record)

    if (result.ok) {
      sent += 1
      continue
    }
    if (result.gone) {
      await input.removeSub(sub.id)
      removedGone += 1
      continue
    }
    failed += 1
  }

  return {
    attempted: input.subs.length,
    sent,
    skippedUnauthorized,
    removedGone,
    failed,
    records,
  }
}
