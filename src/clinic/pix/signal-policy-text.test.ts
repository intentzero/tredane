import { describe, expect, it } from 'vitest'
import { buildSignalPolicyPreview, formatDeadlineHuman } from './signal-policy-text'

describe('signal-policy-text (DEC-180)', () => {
  it('gera as três frases com crédito 24 h e valor fixo', () => {
    const preview = buildSignalPolicyPreview({
      amountKind: 'fixed',
      fixedCents: 5000,
      percent: null,
      deadlineSeconds: 7200,
      policyKind: 'credit_next',
      creditWindowHours: 24,
    })
    expect(preview.generated).toBe(true)
    expect(preview.booking).toContain('R$\u00a050,00')
    expect(preview.booking).toContain('2\u00a0h')
    expect(preview.reschedule).toContain('24\u00a0h')
    expect(preview.cancel).toContain('crédito')
    expect(preview.combined).toContain(preview.booking)
  })

  it('Não devolve não fala de crédito', () => {
    const preview = buildSignalPolicyPreview({
      amountKind: 'percent',
      fixedCents: null,
      percent: 30,
      deadlineSeconds: 1800,
      policyKind: 'keep',
      creditWindowHours: null,
    })
    expect(preview.booking).toContain('30% do serviço')
    expect(preview.cancel).toContain('fica com a clínica')
    expect(preview.cancel.toLowerCase()).not.toContain('crédito')
  })

  it('Outro… sobrescreve o texto gerado', () => {
    const preview = buildSignalPolicyPreview({
      amountKind: 'fixed',
      fixedCents: 1000,
      percent: null,
      deadlineSeconds: 3600,
      policyKind: 'custom',
      creditWindowHours: null,
      customPolicyText: '  Política custom da clínica.  ',
    })
    expect(preview.generated).toBe(false)
    expect(preview.combined).toBe('Política custom da clínica.')
    expect(preview.booking).toBe(preview.combined)
  })

  it('formata prazo humano', () => {
    expect(formatDeadlineHuman(900)).toBe('15\u00a0min')
    expect(formatDeadlineHuman(3600)).toBe('1\u00a0h')
  })
})
