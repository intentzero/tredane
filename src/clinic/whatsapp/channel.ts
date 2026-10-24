/**
 * Espelho operacional WhatsApp no SQLite do Clinic DO (#31).
 * Índice/credenciais vivem no D1; este espelho serve readiness e UI.
 */
import type { Clock } from '../../db/clock'
import type { WhatsappChannelStatus } from '../constants'
import { newId } from '../ids'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'

export type WhatsappChannelRow = {
  tenantId: string
  status: WhatsappChannelStatus
  bindingId: string | null
  phoneNumberId: string | null
  wabaId: string | null
  displayPhone: string | null
  displayName: string | null
  connectedBy: string | null
  connectedAt: number | null
  interruptedAt: number | null
  interruptReason: string | null
  lastInboundAt: number | null
  updatedAt: number
}

export type SyncWhatsappChannelInput = {
  status: WhatsappChannelStatus
  bindingId?: string | null
  phoneNumberId?: string | null
  wabaId?: string | null
  displayPhone?: string | null
  displayName?: string | null
  connectedBy?: string | null
  connectedAt?: number | null
  interruptedAt?: number | null
  interruptReason?: string | null
  lastInboundAt?: number | null
  actor?: string | null
  action: string
}

function mapRow(row: {
  tenant_id: string
  status: WhatsappChannelStatus
  binding_id: string | null
  phone_number_id: string | null
  waba_id: string | null
  display_phone: string | null
  display_name: string | null
  connected_by: string | null
  connected_at: number | null
  interrupted_at: number | null
  interrupt_reason: string | null
  last_inbound_at: number | null
  updated_at: number
}): WhatsappChannelRow {
  return {
    tenantId: row.tenant_id,
    status: row.status,
    bindingId: row.binding_id,
    phoneNumberId: row.phone_number_id,
    wabaId: row.waba_id,
    displayPhone: row.display_phone,
    displayName: row.display_name,
    connectedBy: row.connected_by,
    connectedAt: row.connected_at,
    interruptedAt: row.interrupted_at,
    interruptReason: row.interrupt_reason,
    lastInboundAt: row.last_inbound_at,
    updatedAt: row.updated_at,
  }
}

export function getWhatsappChannel(
  db: ClinicDb,
  tenantId: string,
): WhatsappChannelRow | null {
  assertClinicSchemaReady(db)
  const row = db.get<{
    tenant_id: string
    status: WhatsappChannelStatus
    binding_id: string | null
    phone_number_id: string | null
    waba_id: string | null
    display_phone: string | null
    display_name: string | null
    connected_by: string | null
    connected_at: number | null
    interrupted_at: number | null
    interrupt_reason: string | null
    last_inbound_at: number | null
    updated_at: number
  }>(`SELECT * FROM whatsapp_channel WHERE tenant_id = ?`, tenantId)
  return row ? mapRow(row) : null
}

export function isWhatsappConnected(db: ClinicDb, tenantId: string): boolean {
  const ch = getWhatsappChannel(db, tenantId)
  return ch?.status === 'connected'
}

export function syncWhatsappChannel(
  db: ClinicDb,
  tenantId: string,
  input: SyncWhatsappChannelInput,
  clock: Clock,
): WhatsappChannelRow {
  assertClinicSchemaReady(db)
  const now = clock.nowMs()
  return db.transactionSync(() => {
    db.run(
      `INSERT INTO whatsapp_channel (
        tenant_id, status, binding_id, phone_number_id, waba_id,
        display_phone, display_name, connected_by, connected_at,
        interrupted_at, interrupt_reason, last_inbound_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET
        status = excluded.status,
        binding_id = excluded.binding_id,
        phone_number_id = excluded.phone_number_id,
        waba_id = excluded.waba_id,
        display_phone = excluded.display_phone,
        display_name = excluded.display_name,
        connected_by = excluded.connected_by,
        connected_at = excluded.connected_at,
        interrupted_at = excluded.interrupted_at,
        interrupt_reason = excluded.interrupt_reason,
        last_inbound_at = COALESCE(excluded.last_inbound_at, whatsapp_channel.last_inbound_at),
        updated_at = excluded.updated_at`,
      tenantId,
      input.status,
      input.bindingId ?? null,
      input.phoneNumberId ?? null,
      input.wabaId ?? null,
      input.displayPhone ?? null,
      input.displayName ?? null,
      input.connectedBy ?? null,
      input.connectedAt ?? null,
      input.interruptedAt ?? null,
      input.interruptReason ?? null,
      input.lastInboundAt ?? null,
      now,
    )
    db.run(
      `INSERT INTO whatsapp_channel_events (
        id, tenant_id, action, actor, phone_number_id, detail_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      newId('wce'),
      tenantId,
      input.action,
      input.actor ?? null,
      input.phoneNumberId ?? null,
      JSON.stringify({
        status: input.status,
        bindingId: input.bindingId ?? null,
      }),
      now,
    )
    return getWhatsappChannel(db, tenantId)!
  })
}

export function ensureDisconnectedChannel(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): WhatsappChannelRow {
  const existing = getWhatsappChannel(db, tenantId)
  if (existing) return existing
  return syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'disconnected',
      action: 'initialized',
    },
    clock,
  )
}
