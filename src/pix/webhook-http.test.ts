/**
 * HTTP webhook Pix + fixture Woovi (#39).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { bootAdminDb } from '../db/test-db'
import { createApp } from '../worker/app'
import {
  createWooviSandboxFixture,
  sandboxAdditional,
  WooviPixAdapter,
} from './index'
import { findPixWebhookReceiptByKey } from './webhook-receipts'
import { signWooviWebhookBody } from './woovi/webhook'
import type { PixWebhookQueueMessage } from './queue-types'

describe('HTTP — webhooks Pix (#39)', () => {
  it('assinatura inválida → 401; válida charge.paid → enfileira; duplicata ok', async () => {
    const clock = createControllableClock(1_700_000_000_000)
    const { db, close } = bootAdminDb({ seed: true })
    const queued: PixWebhookQueueMessage[] = []
    const sandbox = await createWooviSandboxFixture({
      validAppIds: new Set(['synth_http_woovi_app']),
      now: () => new Date(clock.nowMs()),
    })
    sandbox.addValidAppId('synth_http_woovi_app')

    const adapter = new WooviPixAdapter({
      appId: 'synth_http_woovi_app',
      tenantId: 'clinic-demo-a',
      accountId: 'pixacct_a',
      baseUrl: sandbox.baseUrl,
      fetchImpl: sandbox.fetchImpl,
      webhookPublicKeys: [sandbox.publicPem],
    })

    const created = await adapter.createCharge({
      tenantId: 'clinic-demo-a',
      accountId: 'pixacct_a',
      amountCents: 5400,
      expiresInSeconds: 7200,
      idempotencyKey: 'http-wh-1',
      externalReference: 'tredane_chg_http_1',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const stored = sandbox.getCharge(created.value.providerChargeId)
    expect(stored?.additionalInfo).toEqual(
      sandboxAdditional('clinic-demo-a', 'pixacct_a'),
    )

    const app = createApp({
      syncAdminDbFactory: () => db,
      clockFactory: () => clock,
      pixWebhook: {
        syncAdminDbFactory: () => db,
        clockFactory: () => clock,
        publicKeyPemsFactory: () => [sandbox.publicPem],
        queueFactory: () => ({
          send: async (msg) => {
            queued.push(msg)
          },
        }),
      },
    })

    const unsigned = await app.request('http://localhost/api/webhooks/pix', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'OPENPIX:CHARGE_COMPLETED' }),
    })
    expect(unsigned.status).toBe(401)

    const paid = await sandbox.simulatePayment(created.value.providerChargeId)
    const ok = await app.request('http://localhost/api/webhooks/pix', {
      method: 'POST',
      headers: paid.headers,
      body: paid.body,
    })
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { ok: boolean; receiptId: string }
    expect(body.ok).toBe(true)
    expect(queued).toHaveLength(1)
    expect(queued[0]?.tenantId).toBe('clinic-demo-a')
    expect(queued[0]?.eventType).toBe('charge.paid')
    expect(queued[0]?.amountCents).toBe(5400)

    const receipt = findPixWebhookReceiptByKey(db, queued[0]!.providerEventKey)
    expect(receipt?.processingState).toBe('enqueued')

    const again = await app.request('http://localhost/api/webhooks/pix', {
      method: 'POST',
      headers: paid.headers,
      body: paid.body,
    })
    expect(again.status).toBe(200)
    expect(queued).toHaveLength(1)

    // Expiração (#40): ack 200 e enfileira charge.expired (não charge.paid).
    const created2 = await adapter.createCharge({
      tenantId: 'clinic-demo-a',
      accountId: 'pixacct_a',
      amountCents: 1000,
      expiresInSeconds: 60,
      idempotencyKey: 'http-wh-exp',
      externalReference: 'tredane_chg_exp',
    })
    expect(created2.ok).toBe(true)
    if (!created2.ok) return
    const expired = await sandbox.simulateExpiration(created2.value.providerChargeId)
    const expRes = await app.request('http://localhost/api/webhooks/pix', {
      method: 'POST',
      headers: expired.headers,
      body: expired.body,
    })
    expect(expRes.status).toBe(200)
    expect(queued).toHaveLength(2)
    expect(queued[1]?.eventType).toBe('charge.expired')

    close()
  })

  it('tenant/conta ausentes no additionalInfo → 400', async () => {
    const clock = createControllableClock(1_700_000_000_000)
    const { db, close } = bootAdminDb({ seed: true })
    const sandbox = await createWooviSandboxFixture()

    const body = JSON.stringify({
      event: 'OPENPIX:CHARGE_COMPLETED',
      charge: {
        correlationID: 'orphan',
        value: 1000,
        status: 'COMPLETED',
        paidAt: new Date().toISOString(),
        additionalInfo: [],
      },
    })
    const sig = await signWooviWebhookBody(body, sandbox.privateKey)

    const app = createApp({
      syncAdminDbFactory: () => db,
      clockFactory: () => clock,
      pixWebhook: {
        syncAdminDbFactory: () => db,
        clockFactory: () => clock,
        publicKeyPemsFactory: () => [sandbox.publicPem],
        queueFactory: () => ({ send: async () => {} }),
      },
    })

    const res = await app.request('http://localhost/api/webhooks/pix', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': sig,
      },
      body,
    })
    expect(res.status).toBe(400)
    close()
  })
})
