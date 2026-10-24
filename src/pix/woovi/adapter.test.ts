import { describe, expect, it } from 'vitest'
import { WooviPixAdapter } from './adapter'
import { createWooviSandboxFixture } from './sandbox'
import { computeSignalAmountCents } from '../money'

describe('WooviPixAdapter + sandbox fixture (#37)', () => {
  it('conecta (verifyCredentials), cria, consulta e cancela cobrança', async () => {
    const sandbox = await createWooviSandboxFixture()
    const appId = 'synth_woovi_app_valid'
    const adapter = new WooviPixAdapter({
      appId,
      tenantId: 'clinic-demo-a',
      accountId: 'pix_acct_a',
      baseUrl: sandbox.baseUrl,
      fetchImpl: sandbox.fetchImpl,
      webhookPublicKeys: [sandbox.publicPem],
    })

    const verify = await adapter.verifyCredentials()
    expect(verify.ok).toBe(true)

    const created = await adapter.createCharge({
      tenantId: 'clinic-demo-a',
      accountId: 'pix_acct_a',
      amountCents: 5400,
      expiresInSeconds: 7200,
      idempotencyKey: 'idem_1',
      externalReference: 'tredane_chg_woovi_1',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.amountCents).toBe(5400)
    expect(created.value.pixCopyPaste).toContain('SANDBOX')
    expect(created.value.status).toBe('awaiting_payment')

    const got = await adapter.getCharge(created.value.providerChargeId)
    expect(got.ok).toBe(true)

    const cancelled = await adapter.cancelCharge(created.value.providerChargeId)
    expect(cancelled.ok).toBe(true)
    if (!cancelled.ok) return
    expect(cancelled.value.status).toBe('cancelled')
  })

  it('rejeita App ID inválido / revogado', async () => {
    const sandbox = await createWooviSandboxFixture()
    const bad = new WooviPixAdapter({
      appId: 'unknown_app',
      tenantId: 'clinic-demo-a',
      accountId: 'pix_acct_a',
      baseUrl: sandbox.baseUrl,
      fetchImpl: sandbox.fetchImpl,
    })
    const verify = await bad.verifyCredentials()
    expect(verify.ok).toBe(false)
    if (verify.ok) return
    expect(verify.code).toBe('invalid_signature')

    sandbox.addValidAppId('to_revoke')
    const okAdapter = new WooviPixAdapter({
      appId: 'to_revoke',
      tenantId: 'clinic-demo-a',
      accountId: 'pix_acct_a',
      baseUrl: sandbox.baseUrl,
      fetchImpl: sandbox.fetchImpl,
    })
    expect((await okAdapter.verifyCredentials()).ok).toBe(true)
    sandbox.revokeAppId('to_revoke')
    const after = await okAdapter.verifyCredentials()
    expect(after.ok).toBe(false)
  })

  it('valida webhook assinado e rejeita assinatura inválida', async () => {
    const sandbox = await createWooviSandboxFixture()
    const adapter = new WooviPixAdapter({
      appId: 'synth_woovi_app_valid',
      tenantId: 'clinic-demo-a',
      accountId: 'pix_acct_a',
      baseUrl: sandbox.baseUrl,
      fetchImpl: sandbox.fetchImpl,
      webhookPublicKeys: [sandbox.publicPem],
    })

    const created = await adapter.createCharge({
      tenantId: 'clinic-demo-a',
      accountId: 'pix_acct_a',
      amountCents: 3000,
      expiresInSeconds: 7200,
      idempotencyKey: 'idem_pay',
      externalReference: 'tredane_chg_pay',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const paid = await sandbox.simulatePayment(created.value.providerChargeId)
    const event = await adapter.validateWebhookEvent({
      headers: paid.headers,
      body: paid.body,
    })
    expect(event.ok).toBe(true)
    if (!event.ok) return
    expect(event.value.type).toBe('charge.paid')
    expect(event.value.tenantId).toBe('clinic-demo-a')
    expect(event.value.accountId).toBe('pix_acct_a')

    const bad = await adapter.validateWebhookEvent({
      headers: { 'x-webhook-signature': 'AAAA' },
      body: paid.body,
    })
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.code).toBe('invalid_signature')
  })

  it('consulta cobranças por conta (App ID) no sandbox', async () => {
    const sandbox = await createWooviSandboxFixture()
    sandbox.addValidAppId('acct_b_app')
    const a = new WooviPixAdapter({
      appId: 'synth_woovi_app_valid',
      tenantId: 'clinic-demo-a',
      accountId: 'pix_acct_a',
      baseUrl: sandbox.baseUrl,
      fetchImpl: sandbox.fetchImpl,
    })
    const b = new WooviPixAdapter({
      appId: 'acct_b_app',
      tenantId: 'clinic-demo-b',
      accountId: 'pix_acct_b',
      baseUrl: sandbox.baseUrl,
      fetchImpl: sandbox.fetchImpl,
    })

    await a.createCharge({
      tenantId: 'clinic-demo-a',
      accountId: 'pix_acct_a',
      amountCents: 1000,
      expiresInSeconds: 7200,
      idempotencyKey: 'a1',
      externalReference: 'chg_a1',
    })
    await b.createCharge({
      tenantId: 'clinic-demo-b',
      accountId: 'pix_acct_b',
      amountCents: 2000,
      expiresInSeconds: 7200,
      idempotencyKey: 'b1',
      externalReference: 'chg_b1',
    })

    expect(sandbox.listChargesForApp('synth_woovi_app_valid')).toHaveLength(1)
    expect(sandbox.listChargesForApp('acct_b_app')).toHaveLength(1)
    expect(sandbox.listChargesForApp('synth_woovi_app_valid')[0]?.value).toBe(1000)
  })

  it('credencial A não opera na clínica B (tenant/account mismatch)', async () => {
    const sandbox = await createWooviSandboxFixture()
    const adapterA = new WooviPixAdapter({
      appId: 'synth_woovi_app_valid',
      tenantId: 'clinic-demo-a',
      accountId: 'pix_acct_a',
      baseUrl: sandbox.baseUrl,
      fetchImpl: sandbox.fetchImpl,
    })
    const mismatch = await adapterA.createCharge({
      tenantId: 'clinic-demo-b',
      accountId: 'pix_acct_a',
      amountCents: 1000,
      expiresInSeconds: 7200,
      idempotencyKey: 'x',
      externalReference: 'x',
    })
    expect(mismatch.ok).toBe(false)
    if (mismatch.ok) return
    expect(mismatch.code).toBe('tenant_mismatch')
  })
})

describe('computeSignalAmountCents', () => {
  it('calcula percentual com aritmética inteira', () => {
    const r = computeSignalAmountCents(
      { requiresSignal: true, kind: 'percent', fixedCents: null, percent: 30 },
      18000,
    )
    expect(r).toEqual({ ok: true, amountCents: 5400 })
  })

  it('bloqueia percentual sem preço', () => {
    const r = computeSignalAmountCents(
      { requiresSignal: true, kind: 'percent', fixedCents: null, percent: 30 },
      null,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('percent_requires_price')
  })

  it('aceita valor fixo em centavos', () => {
    const r = computeSignalAmountCents(
      { requiresSignal: true, kind: 'fixed', fixedCents: 5000, percent: null },
      null,
    )
    expect(r).toEqual({ ok: true, amountCents: 5000 })
  })
})
