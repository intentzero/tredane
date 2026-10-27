import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../worker/app'
import { bootAdminDb } from '../db/test-db'
import { asyncFromSync } from '../db/admin/async-store'
import {
  createSyntheticAuthorityReader,
  createSyntheticSessionAuthenticator,
  synthAuthHeader,
  type AuthServices,
} from '../auth'
import { sealAccessToken } from './crypto'
import {
  DEV_SYNC_ACTION,
  isWhatsappDevSyncEnabled,
  type DevSyncBinding,
  type DevSyncStore,
} from './dev-sync'

const KEY = 'k'.repeat(48)
const OTHER_KEY = 'z'.repeat(48)
const PATH = 'http://localhost/api/tenants/clinic-demo-a/whatsapp/dev/sync-existing-binding'
const STAGING_ENV = {
  ENVIRONMENT: 'staging',
  WHATSAPP_DEV_SYNC_ENABLED: 'true',
  TOKEN_ENCRYPTION_KEY: KEY,
}

const binding: DevSyncBinding = {
  id: 'wab_test_1',
  tenantId: 'clinic-demo-a',
  phoneNumberId: '1457274720794019',
  wabaId: '1387322233420162',
  displayPhone: '+15550000000',
  displayName: 'Teste',
  status: 'active',
  connectedAt: 1_700_000_000_000,
  connectedByClerkUserId: 'user_synth_owner_a',
  interruptedAt: null,
  interruptReason: null,
}

async function harness(opts: { cipher?: string | null; noBinding?: boolean } = {}) {
  const admin = bootAdminDb()
  const cipher =
    opts.cipher === undefined
      ? await sealAccessToken('EAAG-test-token-value', { key: KEY, strict: true }, 'live')
      : opts.cipher
  const events: Array<Parameters<DevSyncStore['recordEvents']>[0]> = []
  const syncs: Array<{ tenantId: string; input: Record<string, unknown> }> = []
  const store: DevSyncStore = {
    async getActiveBindingWithCipher(tenantId) {
      if (opts.noBinding || tenantId !== binding.tenantId) return null
      return { binding, cipher }
    },
    async recordEvents(input) {
      events.push(input)
    },
  }
  const services: AuthServices = {
    sessions: createSyntheticSessionAuthenticator({
      authorizedParties: ['http://localhost:5173'],
    }),
    authority: createSyntheticAuthorityReader(),
    adminDb: asyncFromSync(admin.db),
  }
  const app = createApp({
    authServicesFactory: () => services,
    syncAdminDbFactory: () => admin.db,
    whatsappDevSync: {
      devSyncStoreFactory: () => store,
      devSyncChannelSyncFactory: () => ({
        async syncChannel(tenantId, input) {
          syncs.push({ tenantId, input: input as unknown as Record<string, unknown> })
        },
      }),
    },
  })
  const post = (userId: string | null, env: Record<string, string> | undefined) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    if (userId) headers.set('Authorization', synthAuthHeader(userId))
    return app.request(PATH, { method: 'POST', headers, body: '{}' }, env)
  }
  return { post, events, syncs, close: () => admin.close() }
}

describe('isWhatsappDevSyncEnabled', () => {
  it('só com ENVIRONMENT=staging e flag true', () => {
    expect(isWhatsappDevSyncEnabled(STAGING_ENV)).toBe(true)
    expect(isWhatsappDevSyncEnabled(undefined)).toBe(false)
    expect(isWhatsappDevSyncEnabled({ ENVIRONMENT: 'staging' })).toBe(false)
    expect(
      isWhatsappDevSyncEnabled({ ENVIRONMENT: 'production', WHATSAPP_DEV_SYNC_ENABLED: 'true' }),
    ).toBe(false)
    expect(
      isWhatsappDevSyncEnabled({ ENVIRONMENT: 'development', WHATSAPP_DEV_SYNC_ENABLED: 'true' }),
    ).toBe(false)
    expect(
      isWhatsappDevSyncEnabled({ ENVIRONMENT: 'staging', WHATSAPP_DEV_SYNC_ENABLED: 'false' }),
    ).toBe(false)
  })
})

describe('POST /whatsapp/dev/sync-existing-binding (staging-only)', () => {
  it('404 quando não habilitado (production, sem flag, sem env), mesmo autenticado', async () => {
    const h = await harness()
    try {
      const envs: Array<Record<string, string> | undefined> = [
        undefined,
        { ENVIRONMENT: 'production', WHATSAPP_DEV_SYNC_ENABLED: 'true', TOKEN_ENCRYPTION_KEY: KEY },
        { ENVIRONMENT: 'staging', TOKEN_ENCRYPTION_KEY: KEY },
        { ENVIRONMENT: 'development', WHATSAPP_DEV_SYNC_ENABLED: 'true' },
      ]
      for (const env of envs) {
        const res = await h.post('user_synth_owner_a', env)
        expect(res.status).toBe(404)
      }
      expect(h.syncs).toHaveLength(0)
      expect(h.events).toHaveLength(0)
    } finally {
      h.close()
    }
  })

  it('401 sem sessão e 403 para attendant ou dono de outra clínica', async () => {
    const h = await harness()
    try {
      expect((await h.post(null, STAGING_ENV)).status).toBe(401)
      expect((await h.post('user_synth_attendant_a', STAGING_ENV)).status).toBe(403)
      expect((await h.post('user_synth_owner_b', STAGING_ENV)).status).toBe(403)
      expect(h.syncs).toHaveLength(0)
    } finally {
      h.close()
    }
  })

  it('owner: decifra, sincroniza DO como connected e regista evento + auditoria sem vazar token', async () => {
    const h = await harness()
    try {
      const res = await h.post('user_synth_owner_a', STAGING_ENV)
      expect(res.status).toBe(200)
      const text = await res.text()
      expect(text).not.toMatch(/EAAG|v2:|cipher/)
      const body = JSON.parse(text) as Record<string, unknown>
      expect(body).toMatchObject({
        ok: true,
        status: 'connected',
        bindingId: 'wab_test_1',
        phoneNumberId: '1457274720794019',
        credential: 'decrypt_ok',
        channelSynced: true,
      })
      expect(h.syncs).toHaveLength(1)
      expect(h.syncs[0]!.tenantId).toBe('clinic-demo-a')
      expect(h.syncs[0]!.input).toMatchObject({
        status: 'connected',
        bindingId: 'wab_test_1',
        phoneNumberId: '1457274720794019',
        wabaId: '1387322233420162',
        actor: 'user_synth_owner_a',
        action: 'channel_connected',
      })
      expect(h.events).toHaveLength(1)
      expect(h.events[0]).toMatchObject({
        tenantId: 'clinic-demo-a',
        bindingId: 'wab_test_1',
        actorClerkUserId: 'user_synth_owner_a',
      })
      expect(DEV_SYNC_ACTION).toBe('dev_synced_existing_binding')
    } finally {
      h.close()
    }
  })

  it('409 token_key_mismatch quando a credencial não decifra; nada é alterado', async () => {
    const otherCipher = await sealAccessToken(
      'EAAG-test-token-value',
      { key: OTHER_KEY, strict: true },
      'live',
    )
    const h = await harness({ cipher: otherCipher })
    try {
      const res = await h.post('user_synth_owner_a', STAGING_ENV)
      expect(res.status).toBe(409)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.error).toBe('token_key_mismatch')
      expect(body.sealCode).toBe('token_seal_invalid')
      expect(h.syncs).toHaveLength(0)
      expect(h.events).toHaveLength(0)
    } finally {
      h.close()
    }
  })

  it('404 no_active_binding quando não há vínculo activo', async () => {
    const h = await harness({ noBinding: true })
    try {
      const res = await h.post('user_synth_owner_a', STAGING_ENV)
      expect(res.status).toBe(404)
      expect(((await res.json()) as { error: string }).error).toBe('no_active_binding')
    } finally {
      h.close()
    }
  })
})

describe('wrangler.jsonc — WHATSAPP_DEV_SYNC_ENABLED só em staging', () => {
  it('a flag aparece uma única vez, dentro de env.staging, e nunca em production', () => {
    const raw = readFileSync(resolve(__dirname, '../../wrangler.jsonc'), 'utf8')
    const code = raw
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n')
    const matches = code.match(/"WHATSAPP_DEV_SYNC_ENABLED"/g) ?? []
    expect(matches).toHaveLength(1)
    const stagingAt = code.indexOf('"staging": {')
    const productionAt = code.indexOf('"production": {')
    const flagAt = code.indexOf('"WHATSAPP_DEV_SYNC_ENABLED"')
    expect(stagingAt).toBeGreaterThan(0)
    expect(productionAt).toBeGreaterThan(stagingAt)
    expect(flagAt).toBeGreaterThan(stagingAt)
    expect(flagAt).toBeLessThan(productionAt)
  })
})
