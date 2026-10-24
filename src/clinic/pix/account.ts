import type { Clock } from '../../db/clock'
import { newId } from '../ids'
import type { ClinicDb } from '../store'
import type { PixEnvironment } from '../constants'
import type { PixAccountPublic, PixAccountRow } from './types'

type AccountSql = {
  tenant_id: string
  provider: string
  status: string
  account_id: string | null
  app_id_cipher: string | null
  app_id_hint: string | null
  environment: string
  credential_version: number
  connected_at: number | null
  connected_by_clerk_user_id: string | null
  disconnected_at: number | null
  revoked_at: number | null
  revoke_reason: string | null
  updated_at: number
}

function mapRow(row: AccountSql): PixAccountRow {
  return {
    tenantId: row.tenant_id,
    provider: 'woovi',
    status: row.status as PixAccountRow['status'],
    accountId: row.account_id,
    appIdCipher: row.app_id_cipher,
    appIdHint: row.app_id_hint,
    environment: row.environment as PixEnvironment,
    credentialVersion: row.credential_version,
    connectedAt: row.connected_at,
    connectedByClerkUserId: row.connected_by_clerk_user_id,
    disconnectedAt: row.disconnected_at,
    revokedAt: row.revoked_at,
    revokeReason: row.revoke_reason,
    updatedAt: row.updated_at,
  }
}

export function toPixAccountPublic(row: PixAccountRow): PixAccountPublic {
  return {
    provider: row.provider,
    status: row.status,
    accountId: row.accountId,
    appIdHint: row.appIdHint,
    environment: row.environment,
    credentialVersion: row.credentialVersion,
    connectedAt: row.connectedAt,
    connectedByClerkUserId: row.connectedByClerkUserId,
    disconnectedAt: row.disconnectedAt,
    revokedAt: row.revokedAt,
    revokeReason: row.revokeReason,
    updatedAt: row.updatedAt,
    canCreateCharge: row.status === 'connected' && !!row.appIdCipher && !!row.accountId,
  }
}

export function ensurePixAccount(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  environment: PixEnvironment = 'synthetic',
): PixAccountRow {
  const existing = db.get<AccountSql>(
    'SELECT * FROM pix_account WHERE id = 1',
  )
  if (existing) {
    if (existing.tenant_id !== tenantId) {
      throw new Error(`pix_account tenant mismatch: ${existing.tenant_id}`)
    }
    return mapRow(existing)
  }
  const now = clock.nowMs()
  db.run(
    `INSERT INTO pix_account (
      id, tenant_id, provider, status, account_id, app_id_cipher, app_id_hint,
      environment, credential_version, connected_at, connected_by_clerk_user_id,
      disconnected_at, revoked_at, revoke_reason, updated_at
    ) VALUES (1, ?, 'woovi', 'disconnected', NULL, NULL, NULL, ?, 0, NULL, NULL, NULL, NULL, NULL, ?)`,
    tenantId,
    environment,
    now,
  )
  return getPixAccount(db, tenantId)!
}

export function getPixAccount(
  db: ClinicDb,
  tenantId: string,
): PixAccountRow | null {
  const row = db.get<AccountSql>(
    'SELECT * FROM pix_account WHERE id = 1 AND tenant_id = ?',
    tenantId,
  )
  return row ? mapRow(row) : null
}

export function connectPixAccount(
  db: ClinicDb,
  tenantId: string,
  input: {
    appIdCipher: string
    appIdHint: string
    clerkUserId: string
    environment: PixEnvironment
  },
  clock: Clock,
): PixAccountRow {
  ensurePixAccount(db, tenantId, clock, input.environment)
  const existing = getPixAccount(db, tenantId)!
  const now = clock.nowMs()
  const accountId = existing.accountId ?? newId('pixacct')
  const version = existing.credentialVersion + 1
  db.run(
    `UPDATE pix_account SET
      status = 'connected',
      account_id = ?,
      app_id_cipher = ?,
      app_id_hint = ?,
      environment = ?,
      credential_version = ?,
      connected_at = ?,
      connected_by_clerk_user_id = ?,
      disconnected_at = NULL,
      revoked_at = NULL,
      revoke_reason = NULL,
      updated_at = ?
     WHERE id = 1 AND tenant_id = ?`,
    accountId,
    input.appIdCipher,
    input.appIdHint,
    input.environment,
    version,
    now,
    input.clerkUserId,
    now,
    tenantId,
  )
  return getPixAccount(db, tenantId)!
}

/**
 * Desconecta: remove cipher, preserva account_id e histórico de cobranças.
 */
export function disconnectPixAccount(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): PixAccountRow {
  ensurePixAccount(db, tenantId, clock)
  const now = clock.nowMs()
  db.run(
    `UPDATE pix_account SET
      status = 'disconnected',
      app_id_cipher = NULL,
      app_id_hint = NULL,
      disconnected_at = ?,
      updated_at = ?
     WHERE id = 1 AND tenant_id = ?`,
    now,
    now,
    tenantId,
  )
  return getPixAccount(db, tenantId)!
}

/** Marca credencial como revogada (provedor rejeitou / rotate forçada). */
export function revokePixAccountCredential(
  db: ClinicDb,
  tenantId: string,
  reason: string,
  clock: Clock,
): PixAccountRow {
  ensurePixAccount(db, tenantId, clock)
  const now = clock.nowMs()
  db.run(
    `UPDATE pix_account SET
      status = 'revoked',
      app_id_cipher = NULL,
      revoked_at = ?,
      revoke_reason = ?,
      updated_at = ?
     WHERE id = 1 AND tenant_id = ?`,
    now,
    reason.slice(0, 500),
    now,
    tenantId,
  )
  return getPixAccount(db, tenantId)!
}
