/**
 * Sombra M3 (#413): evento ai.policy_shadow sem texto da conversa.
 */
import { describe, expect, it, vi } from 'vitest'
import { logPolicyShadow } from './policy-shadow'

describe('ai.policy_shadow', () => {
  it('regista divergência sem corpos de mensagem', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      logPolicyShadow({
        tenantId: 'clinic-demo-a',
        conversationId: 'cnv_ficticio',
        phase: 'cf19',
        current: { action: 'ask_empty_time' },
        proposed: { action: 'offer_slots', detail: 'date' },
      })
      expect(spy).toHaveBeenCalledTimes(1)
      const line = String(spy.mock.calls[0]![0])
      const parsed = JSON.parse(line) as Record<string, unknown>
      expect(parsed.event).toBe('ai.policy_shadow')
      expect(parsed.current).toBe('ask_empty_time')
      expect(parsed.proposed).toBe('offer_slots')
      expect(parsed.proposedDetail).toBe('date')
      expect(line).not.toMatch(/quero|limpeza|obrigad|mensagem|body|inbound/i)
      expect(Object.keys(parsed).sort()).toEqual(
        ['conversationId', 'current', 'event', 'level', 'phase', 'proposed', 'proposedDetail', 'tenantId'].sort(),
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('não loga quando actual = proposta', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      logPolicyShadow({
        tenantId: 't',
        conversationId: 'c',
        phase: 'ca03',
        current: { action: 'skip_model' },
        proposed: { action: 'skip_model' },
      })
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})
