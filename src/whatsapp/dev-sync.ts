/**
 * STAGING-ONLY: re-sincroniza o estado do canal WhatsApp no Durable Object da
 * clínica a partir de um vínculo activo já existente em D1 (sem Embedded Signup).
 *
 * Motivo: em staging o app Meta não é Tech Provider (sem META_CONFIG_ID), então o
 * vínculo de teste foi criado directamente em D1 e o DO nunca recebeu o
 * `syncWhatsappChannel('connected')` que `completeSignup` faz.
 *
 * Gate duplo: `ENVIRONMENT === 'staging'` E `WHATSAPP_DEV_SYNC_ENABLED === 'true'`
 * (var definida apenas em `env.staging.vars`). Fora disso a rota responde 404.
 * Nunca devolve nem regista o token; só testa que decifra com TOKEN_ENCRYPTION_KEY.
 */
import { newId } from '../db/admin/ids'
import { redactSecrets } from '../db/tokens'
import { openAccessToken, type SealKeys } from './crypto'
import type { ClinicChannelSync } from './service'

export const DEV_SYNC_ACTION = 'dev_synced_existing_binding'
export const DEV_SYNC_AUDIT_ACTION = 'whatsapp.dev_synced_existing_binding'

export function isWhatsappDevSyncEnabled(
  env: { ENVIRONMENT?: string; WHATSAPP_DEV_SYNC_ENABLED?: string } | undefined,
): boolean {
  if (!env) return false
  const envName = (env.ENVIRONMENT ?? '').trim().toLowerCase()
  const flag = (env.WHATSAPP_DEV_SYNC_ENABLED ?? '').trim().toLowerCase()
  return envName === 'staging' && flag === 'true'
}

export type DevSyncBinding = {
  id: string
  tenantId: string
  phoneNumberId: string
  wabaId: string
  displayPhone: string
  displayName: string | null
  status: 'active' | 'interrupted'
  connectedAt: number
  connectedByClerkUserId: string
  interruptedAt: number | null
  interruptReason: string | null
}

export type DevSyncStore = {
  getActiveBindingWithCipher(
    tenantId: string,
  ): Promise<{ binding: DevSyncBinding; cipher: string | null } | null>
  recordEvents(input: {
    tenantId: string
    bindingId: string
    phoneNumberId: string
    actorClerkUserId: string
    detail: Record<string, unknown>
    occurredAt: number
  }): Promise<void>
}

export type DevSyncResult =
  | {
      ok: true
      status: 'connected' | 'interrupted'
      bindingId: string
      phoneNumberId: string
      wabaId: string
      displayPhone: string
      credential: 'decrypt_ok'
      channelSynced: true
    }
  | {
      ok: false
      error: 'no_active_binding' | 'credential_missing' | 'token_key_mismatch'
      message: string
      bindingId?: string
      phoneNumberId?: string
      sealCode?: string
    }

export async function syncExistingBinding(input: {
  store: DevSyncStore
  sealKeys: SealKeys
  channelSync: ClinicChannelSync
  tenantId: string
  actorClerkUserId: string
  nowMs: number
}): Promise<DevSyncResult> {
  const found = await input.store.getActiveBindingWithCipher(input.tenantId)
  if (!found) {
    return {
      ok: false,
      error: 'no_active_binding',
      message: 'Não há vínculo WhatsApp activo em D1 para esta clínica.',
    }
  }
  const { binding, cipher } = found
  if (!cipher) {
    return {
      ok: false,
      error: 'credential_missing',
      message: 'O vínculo existe mas não há credencial selada em whatsapp_credentials.',
      bindingId: binding.id,
      phoneNumberId: binding.phoneNumberId,
    }
  }
  try {
    const plain = await openAccessToken(cipher, input.sealKeys)
    if (!plain) throw new Error('empty')
  } catch (err) {
    const sealCode =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : 'decrypt_failed'
    return {
      ok: false,
      error: 'token_key_mismatch',
      message:
        'A credencial em D1 não decifra com a TOKEN_ENCRYPTION_KEY deste Worker. '
        + 'Nada foi alterado; é preciso re-selar o token com a chave do Worker.',
      bindingId: binding.id,
      phoneNumberId: binding.phoneNumberId,
      sealCode,
    }
  }

  const status = binding.status === 'interrupted' ? 'interrupted' : 'connected'
  await input.channelSync.syncChannel(input.tenantId, {
    status,
    bindingId: binding.id,
    phoneNumberId: binding.phoneNumberId,
    wabaId: binding.wabaId,
    displayPhone: binding.displayPhone,
    displayName: binding.displayName,
    connectedBy: binding.connectedByClerkUserId,
    connectedAt: binding.connectedAt,
    interruptedAt: binding.interruptedAt,
    interruptReason: binding.interruptReason,
    actor: input.actorClerkUserId,
    action: 'channel_connected',
  })
  await input.store.recordEvents({
    tenantId: input.tenantId,
    bindingId: binding.id,
    phoneNumberId: binding.phoneNumberId,
    actorClerkUserId: input.actorClerkUserId,
    detail: { wabaId: binding.wabaId, displayPhone: binding.displayPhone, status, source: 'staging_dev_sync' },
    occurredAt: input.nowMs,
  })
  return {
    ok: true,
    status,
    bindingId: binding.id,
    phoneNumberId: binding.phoneNumberId,
    wabaId: binding.wabaId,
    displayPhone: binding.displayPhone,
    credential: 'decrypt_ok',
    channelSynced: true,
  }
}

type BindingJoinSql = {
  id: string
  tenant_id: string
  phone_number_id: string
  waba_id: string
  display_phone: string
  display_name: string | null
  status: 'active' | 'interrupted'
  connected_at: number
  connected_by_clerk_user_id: string
  interrupted_at: number | null
  interrupt_reason: string | null
  access_token_cipher: string | null
}

export function createD1DevSyncStore(db: D1Database): DevSyncStore {
  return {
    async getActiveBindingWithCipher(tenantId) {
      const row = await db
        .prepare(
          `SELECT b.id, b.tenant_id, b.phone_number_id, b.waba_id, b.display_phone,
                  b.display_name, b.status, b.connected_at, b.connected_by_clerk_user_id,
                  b.interrupted_at, b.interrupt_reason, c.access_token_cipher
           FROM whatsapp_phone_bindings b
           LEFT JOIN whatsapp_credentials c ON c.binding_id = b.id
           WHERE b.tenant_id = ? AND b.status IN ('active', 'interrupted')
           LIMIT 1`,
        )
        .bind(tenantId)
        .first<BindingJoinSql>()
      if (!row) return null
      return {
        binding: {
          id: row.id,
          tenantId: row.tenant_id,
          phoneNumberId: row.phone_number_id,
          wabaId: row.waba_id,
          displayPhone: row.display_phone,
          displayName: row.display_name,
          status: row.status,
          connectedAt: row.connected_at,
          connectedByClerkUserId: row.connected_by_clerk_user_id,
          interruptedAt: row.interrupted_at,
          interruptReason: row.interrupt_reason,
        },
        cipher: row.access_token_cipher,
      }
    },
    async recordEvents(input) {
      await db.batch([
        db
          .prepare(
            `INSERT INTO whatsapp_binding_events (
              id, tenant_id, binding_id, phone_number_id, action,
              actor_clerk_user_id, detail_json, occurred_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            newId('waev'),
            input.tenantId,
            input.bindingId,
            input.phoneNumberId,
            DEV_SYNC_ACTION,
            input.actorClerkUserId,
            JSON.stringify(input.detail),
            input.occurredAt,
          ),
        db
          .prepare(
            `INSERT INTO central_audit_events (
              id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
              action, object_type, object_id, outcome, support_session_id, metadata_json
            ) VALUES (?, ?, ?, NULL, ?, ?, 'whatsapp_binding', ?, 'success', NULL, ?)`,
          )
          .bind(
            newId('aud'),
            input.occurredAt,
            input.actorClerkUserId,
            input.tenantId,
            DEV_SYNC_AUDIT_ACTION,
            input.bindingId,
            JSON.stringify(redactSecrets({ phoneNumberId: input.phoneNumberId, source: 'staging_dev_sync' })),
          ),
      ])
    },
  }
}
