import type { Clock } from '../db/clock'
import type { InboundState } from './constants'
import { assertClinicSchemaReady } from './migrations'
import type { ClinicDb } from './store'
import { newId } from './ids'

export type InboundRow = {
  id: string
  tenantId: string
  providerEventKey: string
  processingState: InboundState
  payloadJson: string
  receivedAt: number
}

function mapRow(row: {
  id: string
  tenant_id: string
  provider_event_key: string
  processing_state: string
  payload_json: string
  received_at: number
}): InboundRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    providerEventKey: row.provider_event_key,
    processingState: row.processing_state as InboundState,
    payloadJson: row.payload_json,
    receivedAt: row.received_at,
  }
}

export function findInboundByKey(
  db: ClinicDb,
  tenantId: string,
  providerEventKey: string,
): InboundRow | undefined {
  assertClinicSchemaReady(db)
  const row = db.get<{
    id: string
    tenant_id: string
    provider_event_key: string
    processing_state: string
    payload_json: string
    received_at: number
  }>(
    `SELECT * FROM inbound_events WHERE tenant_id = ? AND provider_event_key = ?`,
    tenantId,
    providerEventKey,
  )
  return row ? mapRow(row) : undefined
}

/**
 * Regista inbound com deduplicação por (tenant_id, provider_event_key).
 * Deve correr dentro de transactionSync junto com efeitos de domínio/outbox.
 */
export function recordInboundEvent(
  db: ClinicDb,
  input: {
    tenantId: string
    providerEventKey: string
    payload: Record<string, unknown>
    id?: string
  },
  clock: Clock,
): { row: InboundRow; duplicate: boolean } {
  assertClinicSchemaReady(db)
  const existing = findInboundByKey(db, input.tenantId, input.providerEventKey)
  if (existing) {
    return { row: existing, duplicate: true }
  }

  const id = input.id ?? newId('inb')
  const receivedAt = clock.nowMs()
  const payloadJson = JSON.stringify(input.payload)
  db.run(
    `INSERT INTO inbound_events (
      id, tenant_id, provider_event_key, processing_state, payload_json, received_at
    ) VALUES (?, ?, ?, 'processed', ?, ?)`,
    id,
    input.tenantId,
    input.providerEventKey,
    payloadJson,
    receivedAt,
  )
  return {
    row: {
      id,
      tenantId: input.tenantId,
      providerEventKey: input.providerEventKey,
      processingState: 'processed',
      payloadJson,
      receivedAt,
    },
    duplicate: false,
  }
}
