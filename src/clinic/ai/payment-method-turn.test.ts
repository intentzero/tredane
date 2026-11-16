import { describe, expect, it } from 'vitest'
import {
  buildPaymentDeferralReply,
  outboundWasPaymentDeferral,
  PAYMENT_METHOD_REPLY_REPEAT,
} from './payment-method-turn'
import { PAYMENT_METHOD_REPLY } from './client-copy'

describe('payment-method-turn', () => {
  it('primeira vez usa copy padrão; repetição varia', () => {
    expect(buildPaymentDeferralReply(false)).toBe(PAYMENT_METHOD_REPLY)
    expect(buildPaymentDeferralReply(true)).toBe(PAYMENT_METHOD_REPLY_REPEAT)
    expect(buildPaymentDeferralReply(true)).not.toBe(PAYMENT_METHOD_REPLY)
  })

  it('deteta eco de deferimento de pagamento', () => {
    expect(outboundWasPaymentDeferral(PAYMENT_METHOD_REPLY)).toBe(true)
    expect(outboundWasPaymentDeferral(PAYMENT_METHOD_REPLY_REPEAT)).toBe(true)
    expect(outboundWasPaymentDeferral('Os horários disponíveis são 09:00')).toBe(false)
  })
})