import { describe, expect, it, vi, afterEach } from 'vitest'
import { logIntentLlm } from './intent-llm-log'

describe('logIntentLlm', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emite evento estruturado com label, confiança e outcome', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    logIntentLlm({
      tenantId: 'clinic-demo',
      conversationId: 'cnv_1',
      jobId: 'job_1',
      origin: 'llm',
      mode: 'live',
      label: 'faq_catalog',
      confidence: 0.91,
      closed: true,
      handler: 'faq_catalog',
      outcome: 'catalog',
      sent: true,
    })
    expect(spy).toHaveBeenCalledTimes(1)
    const row = JSON.parse(String(spy.mock.calls[0]?.[0]))
    expect(row.event).toBe('ai.intent_llm')
    expect(row.label).toBe('faq_catalog')
    expect(row.confidence).toBe(0.91)
    expect(row.outcome).toBe('catalog')
    expect(row.mode).toBe('live')
    expect(row.handler).toBe('faq_catalog')
  })
})
