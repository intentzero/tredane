/**
 * Regressão da revisão de segurança (C1, C2, C3, C4, A1, A3, B3).
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSyntheticAuthorityReader, createSyntheticSessionAuthenticator, synthAuthHeader } from '../auth'
import { asyncFromSync } from '../db/admin/async-store'
import { bootAdminDb } from '../db/test-db'
import { createApp } from '../worker/app'
import type { WorkerBindings } from '../worker/bindings'
import { assertClinicTenantId, isRealTenantId, workerCaller } from '../clinic/envelopes'
import { bindOrAssertTenant } from '../clinic/tenant'
import { bootClinicDb } from '../clinic/test-db'
import { newId } from '../db/admin/ids'
import { stripInternalHeaders, WS_INTERNAL_HEADERS } from '../realtime/protocol'
import {
  isMetaWebhookDisabled,
  resolveAppSecret,
  resolveVerifyToken,
  SYNTHETIC_APP_SECRET,
} from '../whatsapp/webhook-verify'
import { ingestPixWebhook } from '../pix/webhook-ingest'
import { AttachmentTokenSecretMissingError, resolveAttachmentTokenSecret } from '../attachments/tokens'
import { isDeployedEnv, isDevelopmentEnv, isHarnessPath } from './env-gate'

const STRONG_SECRET = 'x'.repeat(48)

function makeApp() {
  const boot = bootAdminDb()
  const app = createApp({
    authServicesFactory: () => ({
      sessions: createSyntheticSessionAuthenticator({ authorizedParties: ['http://localhost:5173'] }),
      authority: createSyntheticAuthorityReader(),
      adminDb: asyncFromSync(boot.db),
    }),
    syncAdminDbFactory: () => boot.db,
  })
  return { app, close: boot.close }
}

/** Stub do namespace CLINIC que captura o Request encaminhado ao DO. */
function capturingClinic() {
  const captured: Request[] = []
  const stub = {
    fetch: async (req: Request) => {
      captured.push(req)
      return new Response('captured', { status: 200 })
    },
  }
  const ns = {
    idFromName: (name: string) => ({ name }),
    get: () => stub,
  }
  return { ns: ns as unknown as WorkerBindings['CLINIC'], captured }
}

describe('env-gate', () => {
  it('classifica ambientes; desconhecido conta como deployed (fail closed)', () => {
    expect(isDevelopmentEnv(undefined)).toBe(true)
    expect(isDevelopmentEnv({ ENVIRONMENT: 'development' })).toBe(true)
    expect(isDevelopmentEnv({ ENVIRONMENT: 'test' })).toBe(true)
    expect(isDeployedEnv({ ENVIRONMENT: 'staging' })).toBe(true)
    expect(isDeployedEnv({ ENVIRONMENT: 'production' })).toBe(true)
    expect(isDeployedEnv({ ENVIRONMENT: 'prod-typo' })).toBe(true)
  })

  it('reconhece rotas de harness', () => {
    for (const p of [
      '/api/f0/clinic/clinic-demo-a/ws',
      '/api/f1/clinic/clinic-demo-a/authority-override',
      '/api/f5/push/notify-new-conversation',
      '/api/f6/ops/load',
      '/api/f6/retention/purge-run',
      '/api/webhooks/whatsapp/dev/inject',
      '/api/tenants/tenant_abc/pix/dev/revoke',
      '/api/tenants/tenant_abc/inbox/seed-demo',
      '/api/tenants/tenant_abc/pipeline/seed-demo',
      '/api/tenants/tenant_abc/config/test-appointments',
    ]) {
      expect(isHarnessPath(p), p).toBe(true)
    }
    for (const p of ['/api/health', '/api/tenants/tenant_abc/ws', '/api/webhooks/whatsapp', '/api/webhooks/pix', '/api/f10']) {
      expect(isHarnessPath(p), p).toBe(false)
    }
  })
})

describe('C2/A3/B3 — rotas harness inexistentes fora de development', () => {
  const routes: Array<[string, string]> = [
    ['GET', '/api/f0/clinic/clinic-demo-a/ping'],
    ['GET', '/api/f0/clinic/clinic-demo-a/ws'],
    ['POST', '/api/f1/clinic/clinic-demo-a/ingest'],
    ['GET', '/api/f1/clinic/clinic-demo-a/status'],
    ['POST', '/api/f1/clinic/clinic-demo-a/authority-override'],
    ['POST', '/api/f5/push/notify-new-conversation'],
    ['GET', '/api/f6/ops/catalog'],
    ['POST', '/api/f6/retention/purge-run'],
    ['POST', '/api/webhooks/whatsapp/dev/inject'],
    ['POST', '/api/tenants/clinic-demo-a/pix/dev/revoke'],
    ['POST', '/api/tenants/clinic-demo-a/inbox/seed-demo'],
    ['POST', '/api/tenants/clinic-demo-a/pipeline/seed-demo'],
    ['POST', '/api/tenants/clinic-demo-a/config/test-appointments'],
  ]
  for (const environment of ['staging', 'production']) {
    it(`${environment}: 404 mesmo autenticado`, async () => {
      const { app, close } = makeApp()
      try {
        for (const [method, path] of routes) {
          const res = await app.request(
            `http://localhost${path}`,
            {
              method,
              headers: { Authorization: synthAuthHeader('user_synth_owner_a'), 'Content-Type': 'application/json' },
              body: method === 'POST' ? '{}' : undefined,
            },
            { ENVIRONMENT: environment } as WorkerBindings,
          )
          expect(res.status, `${method} ${path}`).toBe(404)
        }
      } finally {
        close()
      }
    })
  }

  it('development: harness continua disponível', async () => {
    const { app, close } = makeApp()
    try {
      const res = await app.request('http://localhost/api/f6/ops/catalog')
      expect(res.status).toBe(200)
    } finally {
      close()
    }
  })
})

describe('C2 — headers internos x-tredane-* nunca vêm do cliente', () => {
  it('stripInternalHeaders remove qualquer x-tredane-* (case-insensitive)', () => {
    const h = new Headers({
      'X-Tredane-Role': 'owner',
      'x-tredane-assertion': 'tredane-worker-ws-v1',
      'x-tredane-anything': '1',
      Upgrade: 'websocket',
    })
    const out = stripInternalHeaders(h)
    expect([...out.keys()].filter((k) => k.startsWith('x-tredane-'))).toEqual([])
    expect(out.get('upgrade')).toBe('websocket')
  })

  it('rota de produto WS sobrescreve identidade forjada pelo cliente', async () => {
    const { app, close } = makeApp()
    const { ns, captured } = capturingClinic()
    try {
      const res = await app.request(
        'http://localhost/api/tenants/clinic-demo-a/ws',
        {
          headers: {
            Authorization: synthAuthHeader('user_synth_attendant_a'),
            Upgrade: 'websocket',
            [WS_INTERNAL_HEADERS.clerkUserId]: 'user_synth_owner_a',
            [WS_INTERNAL_HEADERS.role]: 'owner',
            [WS_INTERNAL_HEADERS.tenantId]: 'clinic-demo-b',
            'x-tredane-extra': 'evil',
          },
        },
        { CLINIC: ns } as WorkerBindings,
      )
      expect(res.status).toBe(200)
      expect(captured).toHaveLength(1)
      const fwd = captured[0]!.headers
      expect(fwd.get(WS_INTERNAL_HEADERS.clerkUserId)).toBe('user_synth_attendant_a')
      expect(fwd.get(WS_INTERNAL_HEADERS.role)).toBe('attendant')
      expect(fwd.get(WS_INTERNAL_HEADERS.tenantId)).toBe('clinic-demo-a')
      expect(fwd.get('x-tredane-extra')).toBeNull()
    } finally {
      close()
    }
  })

  it('harness F0 WS (development) não repassa headers internos', async () => {
    const { app, close } = makeApp()
    const { ns, captured } = capturingClinic()
    try {
      await app.request(
        'http://localhost/api/f0/clinic/clinic-demo-a/ws',
        {
          headers: {
            Upgrade: 'websocket',
            [WS_INTERNAL_HEADERS.assertion]: 'tredane-worker-ws-v1',
            [WS_INTERNAL_HEADERS.clerkUserId]: 'user_evil',
            [WS_INTERNAL_HEADERS.role]: 'owner',
          },
        },
        { CLINIC: ns } as WorkerBindings,
      )
      expect(captured).toHaveLength(1)
      const keys = [...captured[0]!.headers.keys()]
      expect(keys.filter((k) => k.startsWith('x-tredane-'))).toEqual([])
    } finally {
      close()
    }
  })
})

describe('C1 — tenants reais no Clinic DO', () => {
  it('aceita tenant_<24hex>; demo só quando permitido', () => {
    const real = newId('tenant')
    expect(isRealTenantId(real)).toBe(true)
    expect(() => assertClinicTenantId(real, { allowSynthetic: false })).not.toThrow()
    expect(() => assertClinicTenantId('clinic-demo-a', { allowSynthetic: true })).not.toThrow()
    expect(() => assertClinicTenantId('clinic-demo-a', { allowSynthetic: false })).toThrow()
    for (const bad of ['tenant_xyz', 'tenant_ABCDEF0123456789abcdef01', 'gistaine', '', '../tenant_00']) {
      expect(() => assertClinicTenantId(bad, { allowSynthetic: true }), bad).toThrow()
    }
  })

  it('bindOrAssertTenant vincula tenant real e recusa outro tenant depois', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const real = newId('tenant')
      expect(bindOrAssertTenant(db, workerCaller(real), clock).tenantId).toBe(real)
      expect(() => bindOrAssertTenant(db, workerCaller(newId('tenant')), clock)).toThrow()
      expect(() => bindOrAssertTenant(db, workerCaller('not-a-tenant'), clock)).toThrow()
    } finally {
      close()
    }
  })
})

describe('C3 — webhook Meta fail closed em staging/production', () => {
  it('sem fallback sintético fora de development', () => {
    expect(resolveAppSecret({ META_MODE: 'synthetic' })).toBe(SYNTHETIC_APP_SECRET)
    for (const ENVIRONMENT of ['staging', 'production']) {
      expect(isMetaWebhookDisabled({ ENVIRONMENT })).toBe(true)
      expect(resolveAppSecret({ ENVIRONMENT })).toBeNull()
      expect(resolveVerifyToken({ ENVIRONMENT })).toBeNull()
      // segredo real presente mas META_MODE≠live → ainda recusa
      expect(resolveAppSecret({ ENVIRONMENT, META_APP_SECRET: STRONG_SECRET })).toBeNull()
      expect(resolveAppSecret({ ENVIRONMENT, META_MODE: 'live' })).toBeNull()
      expect(resolveAppSecret({ ENVIRONMENT, META_MODE: 'live', META_APP_SECRET: STRONG_SECRET })).toBe(STRONG_SECRET)
    }
  })

  it('POST/GET /api/webhooks/whatsapp em staging sem live → 503/403', async () => {
    const { app, close } = makeApp()
    try {
      const env = { ENVIRONMENT: 'staging', META_APP_SECRET: STRONG_SECRET } as WorkerBindings
      const post = await app.request('http://localhost/api/webhooks/whatsapp', { method: 'POST', body: '{}' }, env)
      expect(post.status).toBe(503)
      const get = await app.request(
        'http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=tredane-synth-verify&hub.challenge=1',
        {},
        env,
      )
      expect(get.status).toBe(403)
    } finally {
      close()
    }
  })
})

describe('C4 — webhook Pix fail closed em staging/production', () => {
  const store = new Proxy({}, { get: () => () => { throw new Error('store não deve ser usado') } })
  const queue = { send: async () => { throw new Error('queue não deve ser usada') } }
  for (const PIX_MODE of [undefined, 'synthetic', 'sandbox']) {
    it(`staging com PIX_MODE=${PIX_MODE ?? '∅'} → 503`, async () => {
      const result = await ingestPixWebhook('{}', { 'x-tredane-pix-signature': 'sha256=00' }, {
        store: store as never,
        clock: { nowMs: () => 0 } as never,
        queue,
        env: { ENVIRONMENT: 'staging', PIX_MODE, PIX_TOKEN_SECRET: STRONG_SECRET } as WorkerBindings,
        log: () => {},
      })
      expect(result).toEqual({ ok: false, status: 503, error: 'webhook_unconfigured' })
    })
  }
})

describe('A1 — segredo dedicado do token de anexos', () => {
  it('staging/production exigem ATTACHMENT_TOKEN_SECRET forte; nunca reutilizam Meta', () => {
    for (const ENVIRONMENT of ['staging', 'production']) {
      expect(() => resolveAttachmentTokenSecret({ ENVIRONMENT })).toThrow(AttachmentTokenSecretMissingError)
      expect(() =>
        resolveAttachmentTokenSecret({ ENVIRONMENT, META_APP_SECRET: STRONG_SECRET } as never),
      ).toThrow(AttachmentTokenSecretMissingError)
      expect(() => resolveAttachmentTokenSecret({ ENVIRONMENT, ATTACHMENT_TOKEN_SECRET: 'short' })).toThrow()
      expect(resolveAttachmentTokenSecret({ ENVIRONMENT, ATTACHMENT_TOKEN_SECRET: STRONG_SECRET })).toBe(STRONG_SECRET)
    }
  })

  it('development mantém fallback local e ignora segredos Meta', () => {
    expect(resolveAttachmentTokenSecret({ ENVIRONMENT: 'development', META_APP_SECRET: 'm' } as never)).toBe(
      'synth-attachment-token:development',
    )
  })

  it('download em staging sem segredo → 503 (nunca aceita token previsível)', async () => {
    const { app, close } = makeApp()
    try {
      const res = await app.request(
        'http://localhost/api/tenants/tenant_0123456789abcdef01234567/attachments/att_x/content-token?token=a.b',
        {},
        { ENVIRONMENT: 'staging' } as WorkerBindings,
      )
      expect(res.status).toBe(503)
    } finally {
      close()
    }
  })
})

describe('check:env — staging/production', () => {
  const script = resolve(__dirname, '../../scripts/check-env-placeholders.mjs')
  const original = readFileSync(resolve(__dirname, '../../wrangler.jsonc'), 'utf8')

  function run(target: string, config: string, secrets: string) {
    const dir = mkdtempSync(join(tmpdir(), 'check-env-'))
    writeFileSync(join(dir, 'wrangler.jsonc'), config)
    return spawnSync(process.execPath, [script, target], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, CHECK_ENV_SECRET_NAMES: secrets },
    })
  }
  const provisioned = original.replace(
    /00000000-0000-4000-a000-0000000000(aa|ff)/g,
    '11111111-2222-4333-8444-5555555555$1',
  )

  it('staging provisionado com secrets obrigatórios passa', () => {
    const r = run('staging', provisioned, 'CLERK_SECRET_KEY,ATTACHMENT_TOKEN_SECRET,TOKEN_ENCRYPTION_KEY')
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
  })

  it('staging sem ATTACHMENT_TOKEN_SECRET falha nomeando o secret', () => {
    const r = run('staging', provisioned, 'CLERK_SECRET_KEY')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('ATTACHMENT_TOKEN_SECRET')
  })

  it('staging sem TOKEN_ENCRYPTION_KEY falha nomeando o secret (A2)', () => {
    const r = run('staging', provisioned, 'CLERK_SECRET_KEY,ATTACHMENT_TOKEN_SECRET')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('TOKEN_ENCRYPTION_KEY')
  })

  it('production sem vars Clerk falha', () => {
    const r = run('production', provisioned, 'CLERK_SECRET_KEY,ATTACHMENT_TOKEN_SECRET,TOKEN_ENCRYPTION_KEY')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('CLERK_PUBLISHABLE_KEY')
    expect(r.stderr).toContain('CLERK_AUTHORIZED_PARTIES')
  })

  it('META_MODE=live exige secrets Meta', () => {
    const live = provisioned.replace('"ENVIRONMENT": "staging",', '"ENVIRONMENT": "staging",\n        "META_MODE": "live",')
    const r = run('staging', live, 'CLERK_SECRET_KEY,ATTACHMENT_TOKEN_SECRET,TOKEN_ENCRYPTION_KEY')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('META_APP_SECRET')
  })

  it('placeholders atuais continuam bloqueados', () => {
    const r = run('production', original, 'CLERK_SECRET_KEY,ATTACHMENT_TOKEN_SECRET,TOKEN_ENCRYPTION_KEY')
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/placeholders fictícios/)
  })
})
