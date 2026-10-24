import { describe, expect, it } from 'vitest'
import { SimulatedPixAdapter } from './adapter'

class FakeClock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current.getTime())
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms)
  }
}

const baseInput = {
  tenantId: 'tenant_clinica_a',
  accountId: 'acct_clinica_a_pix',
  amountCents: 5400,
  expiresInSeconds: 7200,
  idempotencyKey: 'idem_create_1',
  externalReference: 'tredane_chg_001',
}

describe('SimulatedPixAdapter', () => {
  it('cria cobrança preservando valor, conta e tenant (sem WhatsApp)', async () => {
    const adapter = new SimulatedPixAdapter()
    const result = await adapter.createCharge(baseInput)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.tenantId).toBe(baseInput.tenantId)
    expect(result.value.accountId).toBe(baseInput.accountId)
    expect(result.value.amountCents).toBe(5400)
    expect(result.value.status).toBe('awaiting_payment')
    expect(result.value.pixCopyPaste).toContain('SIMULADO')
    expect(result.value).not.toHaveProperty('whatsapp')
    expect(result.value).not.toHaveProperty('conversationId')
  })

  it('é idempotente na criação com a mesma chave', async () => {
    const adapter = new SimulatedPixAdapter()
    const first = await adapter.createCharge(baseInput)
    const second = await adapter.createCharge(baseInput)
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.value.providerChargeId).toBe(first.value.providerChargeId)
  })

  it('reproduz cobrança paga via webhook assinado', async () => {
    const adapter = new SimulatedPixAdapter()
    const created = await adapter.createCharge(baseInput)
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const paid = await adapter.simulatePayment(created.value.providerChargeId)
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    expect(paid.value.charge.status).toBe('paid')

    const event = await adapter.validateWebhookEvent(paid.value.envelope)
    expect(event.ok).toBe(true)
    if (!event.ok) return
    expect(event.value.type).toBe('charge.paid')
    expect(event.value.tenantId).toBe(baseInput.tenantId)
    expect(event.value.amountCents).toBe(5400)
  })

  it('reproduz cobrança expirada pelo relógio', async () => {
    const clock = new FakeClock(new Date('2026-10-24T12:00:00.000Z'))
    const adapter = new SimulatedPixAdapter({ clock })
    const created = await adapter.createCharge({
      ...baseInput,
      expiresInSeconds: 60,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    clock.advance(61_000)
    const got = await adapter.getCharge(created.value.providerChargeId)
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.value.status).toBe('expired')
  })

  it('reproduz cancelamento antes do pagamento', async () => {
    const adapter = new SimulatedPixAdapter()
    const created = await adapter.createCharge(baseInput)
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const cancelled = await adapter.cancelCharge(created.value.providerChargeId)
    expect(cancelled.ok).toBe(true)
    if (!cancelled.ok) return
    expect(cancelled.value.status).toBe('cancelled')
  })

  it('rejeita aviso duplicado (idempotência de evento)', async () => {
    const adapter = new SimulatedPixAdapter()
    const created = await adapter.createCharge(baseInput)
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const paid = await adapter.simulatePayment(created.value.providerChargeId, {
      eventId: 'evt_dup',
    })
    expect(paid.ok).toBe(true)
    if (!paid.ok) return

    const first = await adapter.validateWebhookEvent(paid.value.envelope)
    const second = await adapter.validateWebhookEvent(paid.value.envelope)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.code).toBe('duplicate_event')
  })

  it('aceita aviso de pago fora de ordem após expiração (pagamento tardio)', async () => {
    const clock = new FakeClock(new Date('2026-10-24T12:00:00.000Z'))
    const adapter = new SimulatedPixAdapter({ clock })
    const created = await adapter.createCharge({
      ...baseInput,
      expiresInSeconds: 60,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    clock.advance(120_000)
    const expired = await adapter.getCharge(created.value.providerChargeId)
    expect(expired.ok && expired.value.status === 'expired').toBe(true)

    const latePay = await adapter.simulatePayment(created.value.providerChargeId, {
      occurredAt: clock.now().toISOString(),
      eventId: 'evt_late',
    })
    expect(latePay.ok).toBe(true)
    if (!latePay.ok) return
    expect(latePay.value.charge.status).toBe('paid')

    const event = await adapter.validateWebhookEvent(latePay.value.envelope)
    expect(event.ok).toBe(true)
    if (!event.ok) return
    expect(event.value.type).toBe('charge.paid')
    // Domínio (não o adaptador) decide "pago sem horário".
  })

  it('reproduz timeout na criação (resultado incerto)', async () => {
    const adapter = new SimulatedPixAdapter({ failNextCreateWithTimeout: true })
    const result = await adapter.createCharge(baseInput)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('timeout')
    expect(result.uncertain).toBe(true)
  })

  it('permite reconciliar criação com resposta incierta via idempotencyKey', async () => {
    const adapter = new SimulatedPixAdapter({ uncertainNextCreate: true })
    const uncertain = await adapter.createCharge(baseInput)
    expect(uncertain.ok).toBe(false)
    if (uncertain.ok) return
    expect(uncertain.code).toBe('uncertain')

    const reconciled = await adapter.findChargeByIdempotencyKey(baseInput.idempotencyKey)
    expect(reconciled.ok).toBe(true)
    if (!reconciled.ok) return
    expect(reconciled.value.externalReference).toBe(baseInput.externalReference)
    expect(reconciled.value.status).toBe('awaiting_payment')
  })

  it('reproduz devolução falhada com possibilidade de nova tentativa', async () => {
    const adapter = new SimulatedPixAdapter({ failNextRefund: true })
    const created = await adapter.createCharge(baseInput)
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const paid = await adapter.simulatePayment(created.value.providerChargeId)
    expect(paid.ok).toBe(true)

    const failed = await adapter.requestRefund({
      providerChargeId: created.value.providerChargeId,
      tenantId: baseInput.tenantId,
      accountId: baseInput.accountId,
      amountCents: baseInput.amountCents,
      idempotencyKey: 'idem_refund_1',
    })
    expect(failed.ok).toBe(false)
    if (failed.ok) return
    expect(failed.code).toBe('refund_failed')
    expect(failed.retryable).toBe(true)

    const retry = await adapter.requestRefund({
      providerChargeId: created.value.providerChargeId,
      tenantId: baseInput.tenantId,
      accountId: baseInput.accountId,
      amountCents: baseInput.amountCents,
      idempotencyKey: 'idem_refund_2',
    })
    expect(retry.ok).toBe(true)
    if (!retry.ok) return
    expect(retry.value.status).toBe('succeeded')
  })

  it('recusa assinatura inválida e mismatch de tenant', async () => {
    const adapter = new SimulatedPixAdapter()
    const created = await adapter.createCharge(baseInput)
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const paid = await adapter.simulatePayment(created.value.providerChargeId)
    expect(paid.ok).toBe(true)
    if (!paid.ok) return

    const badSig = await adapter.validateWebhookEvent({
      ...paid.value.envelope,
      headers: { 'x-tredane-pix-signature': '00'.repeat(32) },
    })
    expect(badSig.ok).toBe(false)
    if (badSig.ok) return
    expect(badSig.code).toBe('invalid_signature')

    const tampered = {
      ...paid.value.envelope,
      body: paid.value.envelope.body.replace(
        baseInput.tenantId,
        'tenant_outra_clinica',
      ),
    }
    // Assinatura antiga não cobre o corpo adulterado.
    const mismatch = await adapter.validateWebhookEvent(tampered)
    expect(mismatch.ok).toBe(false)
    if (mismatch.ok) return
    expect(mismatch.code).toBe('invalid_signature')
  })

  it('não movimenta dinheiro real (providerId simulated)', () => {
    const adapter = new SimulatedPixAdapter()
    expect(adapter.providerId).toBe('simulated')
  })
})
