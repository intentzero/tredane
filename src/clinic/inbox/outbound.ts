/**
 * Intenções de envio outbound (#33 / REQ-012/013/033).
 * Separadas de appointments: falha de envio nunca altera compromisso.
 */
import type { Clock } from '../../db/clock'
import {
  OUTBOUND_DELIVERY_RANK,
  type OutboundDeliveryState,
} from '../constants'
import { newId } from '../ids'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import type { MessageRow } from './types'

export type OutboundInteractiveButton = { id: string; title: string }

export type OutboundMessageRow = {
  id: string
  tenantId: string
  conversationId: string
  messageId: string
  clientRequestId: string
  providerMessageId: string | null
  kind: 'text' | 'template' | 'interactive'
  templateName: string | null
  templateLanguage: string | null
  templateParams: Record<string, string> | null
  /** Botões Cloud API quando kind=interactive (S4). */
  interactiveButtons: OutboundInteractiveButton[] | null
  deliveryState: OutboundDeliveryState
  failureReason: string | null
  outboxEventId: string | null
  createdAt: number
  updatedAt: number
}

type ObSql = {
  id: string
  tenant_id: string
  conversation_id: string
  message_id: string
  client_request_id: string
  provider_message_id: string | null
  kind: string
  template_name: string | null
  template_language: string | null
  template_params_json: string | null
  interactive_json: string | null
  delivery_state: string
  failure_reason: string | null
  outbox_event_id: string | null
  created_at: number
  updated_at: number
}

function parseInteractiveButtons(raw: string | null): OutboundInteractiveButton[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { buttons?: unknown }
    if (!parsed || !Array.isArray(parsed.buttons)) return null
    const buttons: OutboundInteractiveButton[] = []
    for (const b of parsed.buttons) {
      if (!b || typeof b !== 'object') continue
      const id = typeof (b as { id?: unknown }).id === 'string' ? (b as { id: string }).id : ''
      const title =
        typeof (b as { title?: unknown }).title === 'string' ? (b as { title: string }).title : ''
      if (id && title) buttons.push({ id, title })
    }
    return buttons.length > 0 ? buttons : null
  } catch {
    return null
  }
}

function mapOutbound(row: ObSql): OutboundMessageRow {
  let templateParams: Record<string, string> | null = null
  if (row.template_params_json) {
    try {
      const parsed = JSON.parse(row.template_params_json) as Record<string, unknown>
      templateParams = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') templateParams[k] = v
      }
    } catch {
      templateParams = null
    }
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    clientRequestId: row.client_request_id,
    providerMessageId: row.provider_message_id,
    kind: row.kind as 'text' | 'template' | 'interactive',
    templateName: row.template_name,
    templateLanguage: row.template_language,
    templateParams,
    interactiveButtons: parseInteractiveButtons(row.interactive_json ?? null),
    deliveryState: row.delivery_state as OutboundDeliveryState,
    failureReason: row.failure_reason,
    outboxEventId: row.outbox_event_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function findOutboundByClientRequestId(
  db: ClinicDb,
  tenantId: string,
  clientRequestId: string,
): OutboundMessageRow | undefined {
  assertClinicSchemaReady(db)
  const row = db.get<ObSql>(
    `SELECT * FROM outbound_messages
     WHERE tenant_id = ? AND client_request_id = ?`,
    tenantId,
    clientRequestId,
  )
  return row ? mapOutbound(row) : undefined
}

export function findOutboundByProviderMessageId(
  db: ClinicDb,
  tenantId: string,
  providerMessageId: string,
): OutboundMessageRow | undefined {
  assertClinicSchemaReady(db)
  const row = db.get<ObSql>(
    `SELECT * FROM outbound_messages
     WHERE tenant_id = ? AND provider_message_id = ?`,
    tenantId,
    providerMessageId,
  )
  return row ? mapOutbound(row) : undefined
}

export function findOutboundByMessageId(
  db: ClinicDb,
  tenantId: string,
  messageId: string,
): OutboundMessageRow | undefined {
  assertClinicSchemaReady(db)
  const row = db.get<ObSql>(
    `SELECT * FROM outbound_messages
     WHERE tenant_id = ? AND message_id = ?`,
    tenantId,
    messageId,
  )
  return row ? mapOutbound(row) : undefined
}

export function insertOutboundMessage(
  db: ClinicDb,
  input: {
    tenantId: string
    conversationId: string
    messageId: string
    clientRequestId: string
    kind: 'text' | 'template' | 'interactive'
    templateName?: string | null
    templateLanguage?: string | null
    templateParams?: Record<string, string> | null
    interactiveButtons?: OutboundInteractiveButton[] | null
    deliveryState?: OutboundDeliveryState
    failureReason?: string | null
    outboxEventId?: string | null
    id?: string
  },
  clock: Clock,
): OutboundMessageRow {
  assertClinicSchemaReady(db)
  const id = input.id ?? newId('obm')
  const now = clock.nowMs()
  const state = input.deliveryState ?? 'pending'
  const interactiveJson =
    input.kind === 'interactive' && input.interactiveButtons && input.interactiveButtons.length > 0
      ? JSON.stringify({ buttons: input.interactiveButtons })
      : null
  db.run(
    `INSERT INTO outbound_messages (
      id, tenant_id, conversation_id, message_id, client_request_id,
      provider_message_id, kind, template_name, template_language,
      template_params_json, interactive_json, delivery_state, failure_reason, outbox_event_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.tenantId,
    input.conversationId,
    input.messageId,
    input.clientRequestId,
    input.kind,
    input.templateName ?? null,
    input.templateLanguage ?? null,
    input.templateParams ? JSON.stringify(input.templateParams) : null,
    interactiveJson,
    state,
    input.failureReason ?? null,
    input.outboxEventId ?? null,
    now,
    now,
  )
  return findOutboundByClientRequestId(db, input.tenantId, input.clientRequestId)!
}

export function setOutboundOutboxEventId(
  db: ClinicDb,
  tenantId: string,
  outboundId: string,
  outboxEventId: string,
): void {
  assertClinicSchemaReady(db)
  db.run(
    `UPDATE outbound_messages
     SET outbox_event_id = ?, updated_at = updated_at
     WHERE tenant_id = ? AND id = ?`,
    outboxEventId,
    tenantId,
    outboundId,
  )
}

/**
 * Avanço monotónico de delivery (não regride).
 * `failed` é terminal; `unknown` pode reconciliar para aceite/falha/entregue/lida.
 */
export function canAdvanceDelivery(
  current: OutboundDeliveryState,
  next: OutboundDeliveryState,
): boolean {
  if (current === next) return false
  if (current === 'failed') return false
  if (current === 'read') return false
  if (next === 'failed') {
    // Falha confirmada só a partir de pending/unknown (não após aceite Meta).
    return current === 'pending' || current === 'unknown'
  }
  if (current === 'unknown') {
    return next === 'accepted' || next === 'delivered' || next === 'read'
  }
  return OUTBOUND_DELIVERY_RANK[next] > OUTBOUND_DELIVERY_RANK[current]
}

export function mapMetaStatusToDelivery(status: string): OutboundDeliveryState | null {
  const s = status.trim().toLowerCase()
  if (s === 'sent' || s === 'accepted') return 'accepted'
  if (s === 'delivered') return 'delivered'
  if (s === 'read') return 'read'
  if (s === 'failed') return 'failed'
  return null
}

export function applyOutboundDeliveryUpdate(
  db: ClinicDb,
  input: {
    tenantId: string
    outboundId: string
    nextState: OutboundDeliveryState
    providerMessageId?: string | null
    failureReason?: string | null
  },
  clock: Clock,
): { outbound: OutboundMessageRow; message: MessageRow; advanced: boolean } | null {
  assertClinicSchemaReady(db)
  const row = db.get<ObSql>(
    `SELECT * FROM outbound_messages WHERE tenant_id = ? AND id = ?`,
    input.tenantId,
    input.outboundId,
  )
  if (!row) return null
  const current = mapOutbound(row)
  const advanced = canAdvanceDelivery(current.deliveryState, input.nextState)
  const now = clock.nowMs()

  if (!advanced) {
    // Ainda assim pode preencher provider id em duplicate accepted.
    if (
      input.providerMessageId &&
      !current.providerMessageId &&
      (input.nextState === 'accepted' || current.deliveryState === 'accepted')
    ) {
      db.run(
        `UPDATE outbound_messages
         SET provider_message_id = ?, updated_at = ?
         WHERE tenant_id = ? AND id = ? AND provider_message_id IS NULL`,
        input.providerMessageId,
        now,
        input.tenantId,
        input.outboundId,
      )
      db.run(
        `UPDATE messages
         SET external_message_id = COALESCE(external_message_id, ?)
         WHERE tenant_id = ? AND id = ?`,
        input.providerMessageId,
        input.tenantId,
        current.messageId,
      )
    }
    const outbound = findOutboundByMessageId(db, input.tenantId, current.messageId)!
    const msg = db.get<{
      id: string
      tenant_id: string
      conversation_id: string
      direction: string
      body: string
      external_message_id: string | null
      delivery_state: string
      author_clerk_user_id: string | null
      author_display_name: string | null
      created_at: number
    }>(`SELECT * FROM messages WHERE tenant_id = ? AND id = ?`, input.tenantId, current.messageId)
    return {
      outbound,
      message: {
        id: msg!.id,
        tenantId: msg!.tenant_id,
        conversationId: msg!.conversation_id,
        direction: msg!.direction as MessageRow['direction'],
        body: msg!.body,
        externalMessageId: msg!.external_message_id,
        deliveryState: msg!.delivery_state as MessageRow['deliveryState'],
        authorClerkUserId: msg!.author_clerk_user_id,
        authorDisplayName: msg!.author_display_name,
        createdAt: msg!.created_at,
      },
      advanced: false,
    }
  }

  db.run(
    `UPDATE outbound_messages
     SET delivery_state = ?,
         provider_message_id = COALESCE(?, provider_message_id),
         failure_reason = CASE WHEN ? = 'failed' THEN ? ELSE failure_reason END,
         updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    input.nextState,
    input.providerMessageId ?? null,
    input.nextState,
    input.failureReason ?? null,
    now,
    input.tenantId,
    input.outboundId,
  )
  db.run(
    `UPDATE messages
     SET delivery_state = ?,
         external_message_id = COALESCE(?, external_message_id)
     WHERE tenant_id = ? AND id = ?`,
    input.nextState,
    input.providerMessageId ?? null,
    input.tenantId,
    current.messageId,
  )

  const outbound = findOutboundByMessageId(db, input.tenantId, current.messageId)!
  const msg = db.get<{
    id: string
    tenant_id: string
    conversation_id: string
    direction: string
    body: string
    external_message_id: string | null
    delivery_state: string
    author_clerk_user_id: string | null
    author_display_name: string | null
    created_at: number
  }>(`SELECT * FROM messages WHERE tenant_id = ? AND id = ?`, input.tenantId, current.messageId)!
  return {
    outbound,
    message: {
      id: msg.id,
      tenantId: msg.tenant_id,
      conversationId: msg.conversation_id,
      direction: msg.direction as MessageRow['direction'],
      body: msg.body,
      externalMessageId: msg.external_message_id,
      deliveryState: msg.delivery_state as MessageRow['deliveryState'],
      authorClerkUserId: msg.author_clerk_user_id,
      authorDisplayName: msg.author_display_name,
      createdAt: msg.created_at,
    },
    advanced: true,
  }
}
