/**
 * Índice global phone_number_id → tenant (D1 central / ADR-0012 / #31).
 */
import type { Clock } from '../db/clock'
import { writeAudit } from '../db/admin/audit'
import { assertAdminSchemaReady } from '../db/admin/gate'
import { newId } from '../db/admin/ids'
import type { AdminDb } from '../db/admin/store'
import { generateOpaqueToken } from '../db/tokens'
import type {
  BindingRow,
  WhatsappBindingStatus,
  WhatsappHistoryItem,
  WhatsappSignupPurpose,
  WhatsappSignupStatus,
} from './types'

const SIGNUP_TTL_MS = 10 * 60 * 1000

type BindingSql = {
  id: string
  phone_number_id: string
  tenant_id: string
  waba_id: string
  display_phone: string
  display_name: string | null
  status: WhatsappBindingStatus
  connected_at: number
  connected_by_clerk_user_id: string
  interrupted_at: number | null
  interrupt_reason: string | null
  released_at: number | null
  released_by_clerk_user_id: string | null
  updated_at: number
}

function mapBinding(row: BindingSql): BindingRow {
  return {
    id: row.id,
    phoneNumberId: row.phone_number_id,
    tenantId: row.tenant_id,
    wabaId: row.waba_id,
    displayPhone: row.display_phone,
    displayName: row.display_name,
    status: row.status,
    connectedAt: row.connected_at,
    connectedByClerkUserId: row.connected_by_clerk_user_id,
    interruptedAt: row.interrupted_at,
    interruptReason: row.interrupt_reason,
    releasedAt: row.released_at,
    releasedByClerkUserId: row.released_by_clerk_user_id,
    updatedAt: row.updated_at,
  }
}

export function getActiveBindingForTenant(
  db: AdminDb,
  tenantId: string,
): BindingRow | undefined {
  assertAdminSchemaReady(db)
  const row = db.get<BindingSql>(
    `SELECT * FROM whatsapp_phone_bindings
     WHERE tenant_id = ? AND status IN ('active', 'interrupted')
     LIMIT 1`,
    tenantId,
  )
  return row ? mapBinding(row) : undefined
}

export function getActiveBindingByPhone(
  db: AdminDb,
  phoneNumberId: string,
): BindingRow | undefined {
  assertAdminSchemaReady(db)
  const row = db.get<BindingSql>(
    `SELECT * FROM whatsapp_phone_bindings
     WHERE phone_number_id = ? AND status IN ('active', 'interrupted')
     LIMIT 1`,
    phoneNumberId,
  )
  return row ? mapBinding(row) : undefined
}

/** Resolução para webhooks futuros (#32): só active/interrupted. */
export function resolveTenantByPhoneNumberId(
  db: AdminDb,
  phoneNumberId: string,
): { tenantId: string; bindingId: string; status: WhatsappBindingStatus } | null {
  const binding = getActiveBindingByPhone(db, phoneNumberId)
  if (!binding) return null
  return {
    tenantId: binding.tenantId,
    bindingId: binding.id,
    status: binding.status,
  }
}

export type SignupSessionRow = {
  id: string
  tenantId: string
  state: string
  purpose: WhatsappSignupPurpose
  createdByClerkUserId: string
  createdAt: number
  expiresAt: number
  consumedAt: number | null
  status: WhatsappSignupStatus
}

export function createSignupSession(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    purpose: WhatsappSignupPurpose
    actorClerkUserId: string
  },
): SignupSessionRow {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  const id = newId('wass')
  const state = generateOpaqueToken(24)
  db.run(
    `INSERT INTO whatsapp_signup_sessions (
      id, tenant_id, state, purpose, created_by_clerk_user_id,
      created_at, expires_at, consumed_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'pending')`,
    id,
    input.tenantId,
    state,
    input.purpose,
    input.actorClerkUserId,
    now,
    now + SIGNUP_TTL_MS,
  )
  return {
    id,
    tenantId: input.tenantId,
    state,
    purpose: input.purpose,
    createdByClerkUserId: input.actorClerkUserId,
    createdAt: now,
    expiresAt: now + SIGNUP_TTL_MS,
    consumedAt: null,
    status: 'pending',
  }
}

export function getPendingSignupSession(
  db: AdminDb,
  clock: Clock,
  state: string,
  tenantId: string,
): SignupSessionRow | null {
  assertAdminSchemaReady(db)
  const row = db.get<{
    id: string
    tenant_id: string
    state: string
    purpose: WhatsappSignupPurpose
    created_by_clerk_user_id: string
    created_at: number
    expires_at: number
    consumed_at: number | null
    status: WhatsappSignupStatus
  }>(
    `SELECT * FROM whatsapp_signup_sessions WHERE state = ? AND tenant_id = ?`,
    state,
    tenantId,
  )
  if (!row) return null
  if (row.status !== 'pending') return null
  if (row.expires_at <= clock.nowMs()) {
    db.run(
      `UPDATE whatsapp_signup_sessions SET status = 'expired' WHERE id = ? AND status = 'pending'`,
      row.id,
    )
    return null
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    state: row.state,
    purpose: row.purpose,
    createdByClerkUserId: row.created_by_clerk_user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    status: row.status,
  }
}

export function consumeSignupSession(db: AdminDb, clock: Clock, sessionId: string): boolean {
  assertAdminSchemaReady(db)
  const result = db.run(
    `UPDATE whatsapp_signup_sessions
     SET status = 'consumed', consumed_at = ?
     WHERE id = ? AND status = 'pending'`,
    clock.nowMs(),
    sessionId,
  )
  return result.changes === 1
}

function insertEvent(
  db: AdminDb,
  input: {
    tenantId: string
    bindingId?: string | null
    phoneNumberId?: string | null
    action: string
    actorClerkUserId?: string | null
    detail?: Record<string, unknown> | null
  },
  clock: Clock,
): void {
  db.run(
    `INSERT INTO whatsapp_binding_events (
      id, tenant_id, binding_id, phone_number_id, action,
      actor_clerk_user_id, detail_json, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    newId('waev'),
    input.tenantId,
    input.bindingId ?? null,
    input.phoneNumberId ?? null,
    input.action,
    input.actorClerkUserId ?? null,
    input.detail ? JSON.stringify(input.detail) : null,
    clock.nowMs(),
  )
}

export function listBindingHistory(
  db: AdminDb,
  tenantId: string,
  limit = 20,
): WhatsappHistoryItem[] {
  assertAdminSchemaReady(db)
  return db
    .all<{
      id: string
      action: string
      actor_clerk_user_id: string | null
      phone_number_id: string | null
      detail_json: string | null
      occurred_at: number
    }>(
      `SELECT id, action, actor_clerk_user_id, phone_number_id, detail_json, occurred_at
       FROM whatsapp_binding_events
       WHERE tenant_id = ?
       ORDER BY occurred_at DESC
       LIMIT ?`,
      tenantId,
      limit,
    )
    .map((row) => ({
      id: row.id,
      action: row.action,
      actorClerkUserId: row.actor_clerk_user_id,
      phoneNumberId: row.phone_number_id,
      occurredAt: row.occurred_at,
      detail: row.detail_json
        ? (JSON.parse(row.detail_json) as Record<string, unknown>)
        : null,
    }))
}

export type ActivateBindingInput = {
  tenantId: string
  actorClerkUserId: string
  phoneNumberId: string
  wabaId: string
  displayPhone: string
  displayName: string | null
  accessTokenCipher: string
  tokenType: string | null
  expiresAt: number | null
  purpose: WhatsappSignupPurpose
  /** Binding anterior a libertar (replace). */
  previousBindingId?: string | null
}

export type ActivateBindingResult =
  | { ok: true; binding: BindingRow }
  | {
      ok: false
      code: 'phone_in_use' | 'tenant_already_connected' | 'conflict'
      message: string
      otherTenantId?: string
    }

/**
 * Activa binding com unicidade atómica (índices parciais UNIQUE).
 * Liberta binding anterior no mesmo tenant quando purpose=replace.
 */
export function activateBinding(
  db: AdminDb,
  clock: Clock,
  input: ActivateBindingInput,
): ActivateBindingResult {
  assertAdminSchemaReady(db)

  return db.immediate(() => {
    const existingPhone = getActiveBindingByPhone(db, input.phoneNumberId)
    if (existingPhone && existingPhone.tenantId !== input.tenantId) {
      insertEvent(
        db,
        {
          tenantId: input.tenantId,
          phoneNumberId: input.phoneNumberId,
          action: 'connect_rejected_phone_in_use',
          actorClerkUserId: input.actorClerkUserId,
          detail: { otherTenantId: existingPhone.tenantId },
        },
        clock,
      )
      writeAudit(db, clock, {
        actorClerkUserId: input.actorClerkUserId,
        tenantId: input.tenantId,
        action: 'whatsapp.connect_rejected',
        objectType: 'whatsapp_binding',
        objectId: input.phoneNumberId,
        outcome: 'denied',
        metadata: { reason: 'phone_in_use' },
      })
      return {
        ok: false as const,
        code: 'phone_in_use' as const,
        message: 'Este número já está ligado a outra clínica',
        otherTenantId: existingPhone.tenantId,
      }
    }

    const existingTenant = getActiveBindingForTenant(db, input.tenantId)
    if (existingTenant && input.purpose === 'connect') {
      return {
        ok: false as const,
        code: 'tenant_already_connected' as const,
        message: 'A clínica já tem um número conectado',
      }
    }

    const now = clock.nowMs()

    if (existingTenant && (input.purpose === 'replace' || input.purpose === 'reconnect')) {
      if (input.purpose === 'reconnect') {
        // Reconnect: mesmo número ou novo via fluxo; se interrupted no mesmo phone, reactivate.
        if (
          existingTenant.status === 'interrupted'
          && existingTenant.phoneNumberId === input.phoneNumberId
        ) {
          db.run(
            `UPDATE whatsapp_phone_bindings
             SET status = 'active', interrupted_at = NULL, interrupt_reason = NULL,
                 display_phone = ?, display_name = ?, waba_id = ?, updated_at = ?
             WHERE id = ? AND status = 'interrupted'`,
            input.displayPhone,
            input.displayName,
            input.wabaId,
            now,
            existingTenant.id,
          )
          db.run(
            `UPDATE whatsapp_credentials
             SET access_token_cipher = ?, token_type = ?, expires_at = ?,
                 phone_number_id = ?, updated_at = ?
             WHERE binding_id = ?`,
            input.accessTokenCipher,
            input.tokenType,
            input.expiresAt,
            input.phoneNumberId,
            now,
            existingTenant.id,
          )
          insertEvent(
            db,
            {
              tenantId: input.tenantId,
              bindingId: existingTenant.id,
              phoneNumberId: input.phoneNumberId,
              action: 'reconnected',
              actorClerkUserId: input.actorClerkUserId,
            },
            clock,
          )
          writeAudit(db, clock, {
            actorClerkUserId: input.actorClerkUserId,
            tenantId: input.tenantId,
            action: 'whatsapp.reconnected',
            objectType: 'whatsapp_binding',
            objectId: existingTenant.id,
            outcome: 'success',
            metadata: { phoneNumberId: input.phoneNumberId },
          })
          const updated = getActiveBindingForTenant(db, input.tenantId)!
          return { ok: true as const, binding: updated }
        }
      }

      // Replace (ou reconnect com número diferente): libertar actual.
      db.run(
        `UPDATE whatsapp_phone_bindings
         SET status = 'released', released_at = ?, released_by_clerk_user_id = ?, updated_at = ?
         WHERE id = ? AND status IN ('active', 'interrupted')`,
        now,
        input.actorClerkUserId,
        now,
        existingTenant.id,
      )
      db.run(`DELETE FROM whatsapp_credentials WHERE binding_id = ?`, existingTenant.id)
      insertEvent(
        db,
        {
          tenantId: input.tenantId,
          bindingId: existingTenant.id,
          phoneNumberId: existingTenant.phoneNumberId,
          action: input.purpose === 'replace' ? 'replaced_released' : 'released_for_reconnect',
          actorClerkUserId: input.actorClerkUserId,
          detail: { nextPhoneNumberId: input.phoneNumberId },
        },
        clock,
      )
    }

    // Re-check phone after release (mesmo número noutra clínica).
    const phoneAgain = getActiveBindingByPhone(db, input.phoneNumberId)
    if (phoneAgain) {
      return {
        ok: false as const,
        code: 'phone_in_use' as const,
        message: 'Este número já está ligado a outra clínica',
        otherTenantId: phoneAgain.tenantId,
      }
    }

    const bindingId = newId('wab')
    try {
      db.run(
        `INSERT INTO whatsapp_phone_bindings (
          id, phone_number_id, tenant_id, waba_id, display_phone, display_name,
          status, connected_at, connected_by_clerk_user_id, interrupted_at,
          interrupt_reason, released_at, released_by_clerk_user_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, NULL, NULL, NULL, ?)`,
        bindingId,
        input.phoneNumberId,
        input.tenantId,
        input.wabaId,
        input.displayPhone,
        input.displayName,
        now,
        input.actorClerkUserId,
        now,
      )
    } catch {
      return {
        ok: false as const,
        code: 'conflict' as const,
        message: 'Não foi possível associar o número (conflito de unicidade)',
      }
    }

    db.run(
      `INSERT INTO whatsapp_credentials (
        binding_id, tenant_id, phone_number_id, access_token_cipher,
        token_type, expires_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      bindingId,
      input.tenantId,
      input.phoneNumberId,
      input.accessTokenCipher,
      input.tokenType,
      input.expiresAt,
      now,
    )

    const action =
      input.purpose === 'replace'
        ? 'connected_replace'
        : input.purpose === 'reconnect'
          ? 'reconnected_new_number'
          : 'connected'
    insertEvent(
      db,
      {
        tenantId: input.tenantId,
        bindingId,
        phoneNumberId: input.phoneNumberId,
        action,
        actorClerkUserId: input.actorClerkUserId,
        detail: { wabaId: input.wabaId, displayPhone: input.displayPhone },
      },
      clock,
    )
    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      tenantId: input.tenantId,
      action: 'whatsapp.connected',
      objectType: 'whatsapp_binding',
      objectId: bindingId,
      outcome: 'success',
      metadata: {
        phoneNumberId: input.phoneNumberId,
        purpose: input.purpose,
      },
    })

    return { ok: true as const, binding: getActiveBindingForTenant(db, input.tenantId)! }
  })
}

export function releaseBinding(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    actorClerkUserId: string
  },
): BindingRow | null {
  assertAdminSchemaReady(db)
  return db.immediate(() => {
    const current = getActiveBindingForTenant(db, input.tenantId)
    if (!current) return null
    const now = clock.nowMs()
    db.run(
      `UPDATE whatsapp_phone_bindings
       SET status = 'released', released_at = ?, released_by_clerk_user_id = ?, updated_at = ?
       WHERE id = ? AND status IN ('active', 'interrupted')`,
      now,
      input.actorClerkUserId,
      now,
      current.id,
    )
    db.run(`DELETE FROM whatsapp_credentials WHERE binding_id = ?`, current.id)
    insertEvent(
      db,
      {
        tenantId: input.tenantId,
        bindingId: current.id,
        phoneNumberId: current.phoneNumberId,
        action: 'disconnected',
        actorClerkUserId: input.actorClerkUserId,
        detail: {
          note: 'Conversas e contactos mantidos; webhooks do número antigo deixam de rotear para esta clínica',
        },
      },
      clock,
    )
    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      tenantId: input.tenantId,
      action: 'whatsapp.disconnected',
      objectType: 'whatsapp_binding',
      objectId: current.id,
      outcome: 'success',
      metadata: { phoneNumberId: current.phoneNumberId },
    })
    return { ...current, status: 'released', releasedAt: now, updatedAt: now }
  })
}

export function markBindingInterrupted(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    reason: string
    actorClerkUserId?: string | null
  },
): BindingRow | null {
  assertAdminSchemaReady(db)
  return db.immediate(() => {
    const current = getActiveBindingForTenant(db, input.tenantId)
    if (!current || current.status !== 'active') return null
    const now = clock.nowMs()
    db.run(
      `UPDATE whatsapp_phone_bindings
       SET status = 'interrupted', interrupted_at = ?, interrupt_reason = ?, updated_at = ?
       WHERE id = ? AND status = 'active'`,
      now,
      input.reason,
      now,
      current.id,
    )
    // Credenciais revogadas: remover token (não reenviar com segredo inválido).
    db.run(`DELETE FROM whatsapp_credentials WHERE binding_id = ?`, current.id)
    insertEvent(
      db,
      {
        tenantId: input.tenantId,
        bindingId: current.id,
        phoneNumberId: current.phoneNumberId,
        action: 'interrupted',
        actorClerkUserId: input.actorClerkUserId ?? null,
        detail: {
          reason: input.reason,
          note: 'Envios passam a «Não enviada»; histórico preservado; sem reenvio automático',
        },
      },
      clock,
    )
    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId ?? 'system:meta',
      tenantId: input.tenantId,
      action: 'whatsapp.interrupted',
      objectType: 'whatsapp_binding',
      objectId: current.id,
      outcome: 'success',
      metadata: { reason: input.reason, phoneNumberId: current.phoneNumberId },
    })
    return getActiveBindingForTenant(db, input.tenantId) ?? null
  })
}

/** Backend-only: recupera cipher (nunca expor). */
export function getCredentialCipher(
  db: AdminDb,
  bindingId: string,
): string | null {
  assertAdminSchemaReady(db)
  const row = db.get<{ access_token_cipher: string }>(
    `SELECT access_token_cipher FROM whatsapp_credentials WHERE binding_id = ?`,
    bindingId,
  )
  return row?.access_token_cipher ?? null
}
