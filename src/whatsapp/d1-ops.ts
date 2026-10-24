/**
 * Operações WhatsApp no D1 assíncrono (Worker produção).
 * Espelha a lógica sync de `bindings.ts` + `service.ts` com batch atómico.
 */
import { newId } from '../db/admin/ids'
import { generateOpaqueToken, redactSecrets } from '../db/tokens'
import { ADMIN_SCHEMA_VERSION } from '../db/admin/constants'
import type {
  BindingRow,
  CompleteSignupInput,
  WhatsappBindingStatus,
  WhatsappConnectionView,
  WhatsappHistoryItem,
  WhatsappSignupPurpose,
  WhatsappSignupSessionView,
  MetaMode,
} from './types'
import type { MetaAdapter } from './meta'
import { MetaExchangeError } from './meta'
import { sealAccessToken } from './crypto'
import type { ClinicChannelSync } from './service'
import { WhatsappServiceError } from './service'

const SIGNUP_TTL_MS = 10 * 60 * 1000

async function assertSchema(db: D1Database): Promise<void> {
  const row = await db
    .prepare('SELECT version FROM admin_schema_state WHERE id = 1')
    .first<{ version: number }>()
  if (!row || row.version !== ADMIN_SCHEMA_VERSION) {
    throw new WhatsappServiceError(
      'schema_not_ready',
      `admin schema ${row?.version ?? 'ausente'}; esperada ${ADMIN_SCHEMA_VERSION}`,
      503,
    )
  }
}

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

async function getActiveForTenant(
  db: D1Database,
  tenantId: string,
): Promise<BindingRow | undefined> {
  const row = await db
    .prepare(
      `SELECT * FROM whatsapp_phone_bindings
       WHERE tenant_id = ? AND status IN ('active', 'interrupted') LIMIT 1`,
    )
    .bind(tenantId)
    .first<BindingSql>()
  return row ? mapBinding(row) : undefined
}

async function getActiveByPhone(
  db: D1Database,
  phoneNumberId: string,
): Promise<BindingRow | undefined> {
  const row = await db
    .prepare(
      `SELECT * FROM whatsapp_phone_bindings
       WHERE phone_number_id = ? AND status IN ('active', 'interrupted') LIMIT 1`,
    )
    .bind(phoneNumberId)
    .first<BindingSql>()
  return row ? mapBinding(row) : undefined
}

async function listHistory(
  db: D1Database,
  tenantId: string,
): Promise<WhatsappHistoryItem[]> {
  const result = await db
    .prepare(
      `SELECT id, action, actor_clerk_user_id, phone_number_id, detail_json, occurred_at
       FROM whatsapp_binding_events WHERE tenant_id = ?
       ORDER BY occurred_at DESC LIMIT 20`,
    )
    .bind(tenantId)
    .all<{
      id: string
      action: string
      actor_clerk_user_id: string | null
      phone_number_id: string | null
      detail_json: string | null
      occurred_at: number
    }>()
  return (result.results ?? []).map((row) => ({
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

function toView(
  binding: BindingRow | undefined,
  history: WhatsappHistoryItem[],
  metaMode: MetaMode,
): WhatsappConnectionView {
  if (!binding) {
    return {
      status: 'disconnected',
      phoneNumberId: null,
      wabaId: null,
      displayPhone: null,
      displayName: null,
      connectedAt: null,
      connectedByClerkUserId: null,
      interruptedAt: null,
      interruptReason: null,
      lastInboundAt: null,
      messageTemplates: [],
      history,
      metaMode,
    }
  }
  return {
    status: binding.status === 'interrupted' ? 'interrupted' : 'connected',
    phoneNumberId: binding.phoneNumberId,
    wabaId: binding.wabaId,
    displayPhone: binding.displayPhone,
    displayName: binding.displayName,
    connectedAt: binding.connectedAt,
    connectedByClerkUserId: binding.connectedByClerkUserId,
    interruptedAt: binding.interruptedAt,
    interruptReason: binding.interruptReason,
    lastInboundAt: null,
    messageTemplates: [],
    history,
    metaMode,
  }
}

export type D1WhatsappDeps = {
  db: D1Database
  meta: MetaAdapter
  metaMode: MetaMode
  metaEnv: {
    META_APP_ID?: string
    META_CONFIG_ID?: string
    META_GRAPH_API_VERSION?: string
    META_APP_SECRET?: string
    META_TOKEN_SECRET?: string
  }
  channelSync?: ClinicChannelSync
  nowMs?: () => number
}

export function createD1WhatsappOps(deps: D1WhatsappDeps) {
  const now = () => deps.nowMs?.() ?? Date.now()

  async function syncMirror(
    tenantId: string,
    view: WhatsappConnectionView,
    bindingId: string | null,
    actor: string | null,
    action: string,
  ) {
    if (!deps.channelSync) return
    await deps.channelSync.syncChannel(tenantId, {
      status: view.status,
      bindingId,
      phoneNumberId: view.phoneNumberId,
      wabaId: view.wabaId,
      displayPhone: view.displayPhone,
      displayName: view.displayName,
      connectedBy: view.connectedByClerkUserId,
      connectedAt: view.connectedAt,
      interruptedAt: view.interruptedAt,
      interruptReason: view.interruptReason,
      actor,
      action,
    })
  }

  return {
    async getConnection(tenantId: string): Promise<WhatsappConnectionView> {
      await assertSchema(deps.db)
      const binding = await getActiveForTenant(deps.db, tenantId)
      const history = await listHistory(deps.db, tenantId)
      return toView(binding, history, deps.metaMode)
    },

    async startSignupSession(input: {
      tenantId: string
      actorClerkUserId: string
      purpose: WhatsappSignupPurpose
    }): Promise<WhatsappSignupSessionView> {
      await assertSchema(deps.db)
      const binding = await getActiveForTenant(deps.db, input.tenantId)
      if (input.purpose === 'connect' && binding) {
        throw new WhatsappServiceError(
          'already_connected',
          'A clínica já tem WhatsApp conectado',
          409,
        )
      }
      if (
        (input.purpose === 'reconnect' || input.purpose === 'replace')
        && !binding
      ) {
        throw new WhatsappServiceError(
          'not_connected',
          'Não há conexão WhatsApp para reconectar ou trocar',
          409,
        )
      }
      if (input.purpose === 'reconnect' && binding?.status !== 'interrupted') {
        throw new WhatsappServiceError(
          'not_interrupted',
          'Reconectar só se aplica a conexão interrompida',
          409,
        )
      }

      const id = newId('wass')
      const state = generateOpaqueToken(24)
      const createdAt = now()
      const expiresAt = createdAt + SIGNUP_TTL_MS
      await deps.db
        .prepare(
          `INSERT INTO whatsapp_signup_sessions (
            id, tenant_id, state, purpose, created_by_clerk_user_id,
            created_at, expires_at, consumed_at, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'pending')`,
        )
        .bind(
          id,
          input.tenantId,
          state,
          input.purpose,
          input.actorClerkUserId,
          createdAt,
          expiresAt,
        )
        .run()

      const live = deps.metaMode === 'live'
      return {
        sessionId: id,
        state,
        purpose: input.purpose,
        expiresAt,
        metaMode: deps.metaMode,
        metaAppId: live ? (deps.metaEnv.META_APP_ID ?? null) : null,
        metaConfigId: live ? (deps.metaEnv.META_CONFIG_ID ?? null) : null,
        graphApiVersion: deps.metaEnv.META_GRAPH_API_VERSION ?? 'v25.0',
      }
    },

    async completeSignup(input: {
      tenantId: string
      actorClerkUserId: string
      payload: CompleteSignupInput
    }): Promise<WhatsappConnectionView> {
      await assertSchema(deps.db)
      const session = await deps.db
        .prepare(
          `SELECT * FROM whatsapp_signup_sessions WHERE state = ? AND tenant_id = ?`,
        )
        .bind(input.payload.state, input.tenantId)
        .first<{
          id: string
          purpose: WhatsappSignupPurpose
          status: string
          expires_at: number
        }>()
      if (!session || session.status !== 'pending' || session.expires_at <= now()) {
        throw new WhatsappServiceError(
          'invalid_state',
          'Sessão Embedded Signup inválida, expirada ou já usada',
          400,
        )
      }

      let exchanged
      try {
        exchanged = await deps.meta.exchangeSignupCode({
          code: input.payload.code,
          phoneNumberId: input.payload.phoneNumberId,
          wabaId: input.payload.wabaId,
          displayPhone: input.payload.displayPhone,
          displayName: input.payload.displayName,
        })
      } catch (err) {
        if (err instanceof MetaExchangeError) {
          throw new WhatsappServiceError(err.code, err.message, 400)
        }
        throw err
      }

      const consume = await deps.db
        .prepare(
          `UPDATE whatsapp_signup_sessions
           SET status = 'consumed', consumed_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .bind(now(), session.id)
        .run()
      if ((consume.meta.changes ?? 0) !== 1) {
        throw new WhatsappServiceError(
          'invalid_state',
          'Sessão Embedded Signup já consumida',
          400,
        )
      }

      const existingPhone = await getActiveByPhone(deps.db, exchanged.phoneNumberId)
      if (existingPhone && existingPhone.tenantId !== input.tenantId) {
        throw new WhatsappServiceError(
          'phone_in_use',
          'Este número já está ligado a outra clínica',
          409,
        )
      }

      const existingTenant = await getActiveForTenant(deps.db, input.tenantId)
      if (existingTenant && session.purpose === 'connect') {
        throw new WhatsappServiceError(
          'tenant_already_connected',
          'A clínica já tem um número conectado',
          409,
        )
      }

      const cipher = await sealAccessToken(
        exchanged.accessToken,
        deps.metaEnv.META_TOKEN_SECRET ?? deps.metaEnv.META_APP_SECRET,
        deps.metaMode,
      )
      const ts = now()
      const stmts: D1PreparedStatement[] = []

      if (
        existingTenant
        && session.purpose === 'reconnect'
        && existingTenant.status === 'interrupted'
        && existingTenant.phoneNumberId === exchanged.phoneNumberId
      ) {
        stmts.push(
          deps.db
            .prepare(
              `UPDATE whatsapp_phone_bindings
               SET status = 'active', interrupted_at = NULL, interrupt_reason = NULL,
                   display_phone = ?, display_name = ?, waba_id = ?, updated_at = ?
               WHERE id = ? AND status = 'interrupted'`,
            )
            .bind(
              exchanged.displayPhone,
              exchanged.displayName,
              exchanged.wabaId,
              ts,
              existingTenant.id,
            ),
          deps.db
            .prepare(
              `INSERT INTO whatsapp_credentials (
                binding_id, tenant_id, phone_number_id, access_token_cipher,
                token_type, expires_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, NULL, ?)
              ON CONFLICT(binding_id) DO UPDATE SET
                access_token_cipher = excluded.access_token_cipher,
                token_type = excluded.token_type,
                phone_number_id = excluded.phone_number_id,
                updated_at = excluded.updated_at`,
            )
            .bind(
              existingTenant.id,
              input.tenantId,
              exchanged.phoneNumberId,
              cipher,
              exchanged.tokenType,
              ts,
            ),
          deps.db
            .prepare(
              `INSERT INTO whatsapp_binding_events (
                id, tenant_id, binding_id, phone_number_id, action,
                actor_clerk_user_id, detail_json, occurred_at
              ) VALUES (?, ?, ?, ?, 'reconnected', ?, NULL, ?)`,
            )
            .bind(
              newId('waev'),
              input.tenantId,
              existingTenant.id,
              exchanged.phoneNumberId,
              input.actorClerkUserId,
              ts,
            ),
          deps.db
            .prepare(
              `INSERT INTO central_audit_events (
                id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
                action, object_type, object_id, outcome, support_session_id, metadata_json
              ) VALUES (?, ?, ?, NULL, ?, 'whatsapp.reconnected', 'whatsapp_binding', ?, 'success', NULL, ?)`,
            )
            .bind(
              newId('aud'),
              ts,
              input.actorClerkUserId,
              input.tenantId,
              existingTenant.id,
              JSON.stringify(
                redactSecrets({ phoneNumberId: exchanged.phoneNumberId }),
              ),
            ),
        )
        await deps.db.batch(stmts)
        const view = toView(
          await getActiveForTenant(deps.db, input.tenantId),
          await listHistory(deps.db, input.tenantId),
          deps.metaMode,
        )
        await syncMirror(
          input.tenantId,
          view,
          existingTenant.id,
          input.actorClerkUserId,
          'channel_connected',
        )
        return view
      }

      if (existingTenant) {
        stmts.push(
          deps.db
            .prepare(
              `UPDATE whatsapp_phone_bindings
               SET status = 'released', released_at = ?, released_by_clerk_user_id = ?, updated_at = ?
               WHERE id = ? AND status IN ('active', 'interrupted')`,
            )
            .bind(ts, input.actorClerkUserId, ts, existingTenant.id),
          deps.db
            .prepare(`DELETE FROM whatsapp_credentials WHERE binding_id = ?`)
            .bind(existingTenant.id),
          deps.db
            .prepare(
              `INSERT INTO whatsapp_binding_events (
                id, tenant_id, binding_id, phone_number_id, action,
                actor_clerk_user_id, detail_json, occurred_at
              ) VALUES (?, ?, ?, ?, 'replaced_released', ?, ?, ?)`,
            )
            .bind(
              newId('waev'),
              input.tenantId,
              existingTenant.id,
              existingTenant.phoneNumberId,
              input.actorClerkUserId,
              JSON.stringify({ nextPhoneNumberId: exchanged.phoneNumberId }),
              ts,
            ),
        )
      }

      const phoneAgain = await getActiveByPhone(deps.db, exchanged.phoneNumberId)
      if (phoneAgain && phoneAgain.tenantId !== input.tenantId) {
        throw new WhatsappServiceError(
          'phone_in_use',
          'Este número já está ligado a outra clínica',
          409,
        )
      }

      const bindingId = newId('wab')
      const action =
        session.purpose === 'replace'
          ? 'connected_replace'
          : session.purpose === 'reconnect'
            ? 'reconnected_new_number'
            : 'connected'
      stmts.push(
        deps.db
          .prepare(
            `INSERT INTO whatsapp_phone_bindings (
              id, phone_number_id, tenant_id, waba_id, display_phone, display_name,
              status, connected_at, connected_by_clerk_user_id, interrupted_at,
              interrupt_reason, released_at, released_by_clerk_user_id, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, NULL, NULL, NULL, ?)`,
          )
          .bind(
            bindingId,
            exchanged.phoneNumberId,
            input.tenantId,
            exchanged.wabaId,
            exchanged.displayPhone,
            exchanged.displayName,
            ts,
            input.actorClerkUserId,
            ts,
          ),
        deps.db
          .prepare(
            `INSERT INTO whatsapp_credentials (
              binding_id, tenant_id, phone_number_id, access_token_cipher,
              token_type, expires_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
          )
          .bind(
            bindingId,
            input.tenantId,
            exchanged.phoneNumberId,
            cipher,
            exchanged.tokenType,
            ts,
          ),
        deps.db
          .prepare(
            `INSERT INTO whatsapp_binding_events (
              id, tenant_id, binding_id, phone_number_id, action,
              actor_clerk_user_id, detail_json, occurred_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            newId('waev'),
            input.tenantId,
            bindingId,
            exchanged.phoneNumberId,
            action,
            input.actorClerkUserId,
            JSON.stringify({
              wabaId: exchanged.wabaId,
              displayPhone: exchanged.displayPhone,
            }),
            ts,
          ),
        deps.db
          .prepare(
            `INSERT INTO central_audit_events (
              id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
              action, object_type, object_id, outcome, support_session_id, metadata_json
            ) VALUES (?, ?, ?, NULL, ?, 'whatsapp.connected', 'whatsapp_binding', ?, 'success', NULL, ?)`,
          )
          .bind(
            newId('aud'),
            ts,
            input.actorClerkUserId,
            input.tenantId,
            bindingId,
            JSON.stringify(
              redactSecrets({
                phoneNumberId: exchanged.phoneNumberId,
                purpose: session.purpose,
              }),
            ),
          ),
      )

      try {
        await deps.db.batch(stmts)
      } catch {
        throw new WhatsappServiceError(
          'conflict',
          'Não foi possível associar o número (conflito de unicidade)',
          409,
        )
      }

      const binding = await getActiveForTenant(deps.db, input.tenantId)
      const view = toView(
        binding,
        await listHistory(deps.db, input.tenantId),
        deps.metaMode,
      )
      await syncMirror(
        input.tenantId,
        view,
        binding?.id ?? null,
        input.actorClerkUserId,
        session.purpose === 'replace' ? 'channel_replaced' : 'channel_connected',
      )
      return view
    },

    async disconnect(input: {
      tenantId: string
      actorClerkUserId: string
      clinicNameConfirmation: string
      expectedClinicName: string
    }): Promise<WhatsappConnectionView> {
      await assertSchema(deps.db)
      if (input.clinicNameConfirmation.trim() !== input.expectedClinicName.trim()) {
        throw new WhatsappServiceError(
          'confirmation_mismatch',
          'Digite o nome exacto da clínica para desconectar',
          400,
        )
      }
      const current = await getActiveForTenant(deps.db, input.tenantId)
      if (!current) {
        throw new WhatsappServiceError(
          'not_connected',
          'Não há conexão WhatsApp activa',
          409,
        )
      }
      const ts = now()
      await deps.db.batch([
        deps.db
          .prepare(
            `UPDATE whatsapp_phone_bindings
             SET status = 'released', released_at = ?, released_by_clerk_user_id = ?, updated_at = ?
             WHERE id = ? AND status IN ('active', 'interrupted')`,
          )
          .bind(ts, input.actorClerkUserId, ts, current.id),
        deps.db
          .prepare(`DELETE FROM whatsapp_credentials WHERE binding_id = ?`)
          .bind(current.id),
        deps.db
          .prepare(
            `INSERT INTO whatsapp_binding_events (
              id, tenant_id, binding_id, phone_number_id, action,
              actor_clerk_user_id, detail_json, occurred_at
            ) VALUES (?, ?, ?, ?, 'disconnected', ?, ?, ?)`,
          )
          .bind(
            newId('waev'),
            input.tenantId,
            current.id,
            current.phoneNumberId,
            input.actorClerkUserId,
            JSON.stringify({
              note: 'Conversas mantidas; webhooks do número antigo não roteiam para esta clínica',
            }),
            ts,
          ),
        deps.db
          .prepare(
            `INSERT INTO central_audit_events (
              id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
              action, object_type, object_id, outcome, support_session_id, metadata_json
            ) VALUES (?, ?, ?, NULL, ?, 'whatsapp.disconnected', 'whatsapp_binding', ?, 'success', NULL, ?)`,
          )
          .bind(
            newId('aud'),
            ts,
            input.actorClerkUserId,
            input.tenantId,
            current.id,
            JSON.stringify(
              redactSecrets({ phoneNumberId: current.phoneNumberId }),
            ),
          ),
      ])
      const view = toView(
        undefined,
        await listHistory(deps.db, input.tenantId),
        deps.metaMode,
      )
      await syncMirror(
        input.tenantId,
        view,
        null,
        input.actorClerkUserId,
        'channel_disconnected',
      )
      return view
    },

    async markInterrupted(input: {
      tenantId: string
      reason: string
      actorClerkUserId?: string | null
    }): Promise<WhatsappConnectionView> {
      if (deps.metaMode !== 'synthetic') {
        throw new WhatsappServiceError(
          'synthetic_only',
          'Interrupção manual só em META_MODE=synthetic até webhooks (#32)',
          403,
        )
      }
      await assertSchema(deps.db)
      const current = await getActiveForTenant(deps.db, input.tenantId)
      if (!current || current.status !== 'active') {
        throw new WhatsappServiceError(
          'not_active',
          'Não há conexão activa para interromper',
          409,
        )
      }
      const ts = now()
      await deps.db.batch([
        deps.db
          .prepare(
            `UPDATE whatsapp_phone_bindings
             SET status = 'interrupted', interrupted_at = ?, interrupt_reason = ?, updated_at = ?
             WHERE id = ? AND status = 'active'`,
          )
          .bind(ts, input.reason, ts, current.id),
        deps.db
          .prepare(`DELETE FROM whatsapp_credentials WHERE binding_id = ?`)
          .bind(current.id),
        deps.db
          .prepare(
            `INSERT INTO whatsapp_binding_events (
              id, tenant_id, binding_id, phone_number_id, action,
              actor_clerk_user_id, detail_json, occurred_at
            ) VALUES (?, ?, ?, ?, 'interrupted', ?, ?, ?)`,
          )
          .bind(
            newId('waev'),
            input.tenantId,
            current.id,
            current.phoneNumberId,
            input.actorClerkUserId ?? null,
            JSON.stringify({ reason: input.reason }),
            ts,
          ),
      ])
      const binding = await getActiveForTenant(deps.db, input.tenantId)
      const view = toView(
        binding,
        await listHistory(deps.db, input.tenantId),
        deps.metaMode,
      )
      await syncMirror(
        input.tenantId,
        view,
        binding?.id ?? null,
        input.actorClerkUserId ?? 'system:meta',
        'channel_interrupted',
      )
      return view
    },
  }
}

export type D1WhatsappOps = ReturnType<typeof createD1WhatsappOps>
