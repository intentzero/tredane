import type { Clock } from '../../db/clock'
import { newId } from '../ids'
import type { ClinicDb } from '../store'
import type { PixChargeStatus } from '../constants'
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
      service_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
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
