import { describe, expect, it } from 'vitest'
import {
  analyzeGeneralPolicyConflict,
  formatPolicyConflictMessage,
} from './policy-conflict'
import { joinPolicyParts, POLICY_JOIN_PHRASE } from './policy-join'

describe('analyzeGeneralPolicyConflict (DEC-210 revisão / Q1)', () => {
  it('B vazio: sem conflito', () => {
    expect(analyzeGeneralPolicyConflict('', { signalOn: true })).toEqual({
      conflicts: [],
      blocksSave: false,
      softWarns: [],
    })
  })

  it('atraso/falta complementar: não bloqueia com sinal ligado', () => {
    const r = analyzeGeneralPolicyConflict(
      'Atrasos acima de 15 minutos podem perder o horário. Faltas sem aviso ficam registadas.',
      { signalOn: true },
    )
    expect(r.blocksSave).toBe(false)
    expect(r.conflicts).toEqual([])
  })

  it('prazo de cancelar/remarcar em B com sinal ligado: bloqueia (Q1)', () => {
    const r = analyzeGeneralPolicyConflict('Avise com 24 h de antecedência.', {
      signalOn: true,
    })
    expect(r.blocksSave).toBe(true)
    expect(r.conflicts.some((c) => c.kind === 'lead_time')).toBe(true)
  })

  it('crédito / devolução / sinal em B com sinal ligado: bloqueia', () => {
    for (const text of [
      'O crédito vale no próximo horário.',
      'O sinal não se devolve.',
      'Pague o Pix antes.',
      'Depois disso o sinal é retido.',
      'Há multa de R$ 50.',
    ]) {
      const r = analyzeGeneralPolicyConflict(text, { signalOn: true })
      expect(r.blocksSave, text).toBe(true)
    }
  })

  it('com sinal desligado, prazo de aviso é permitido; Pix só aviso leve', () => {
    const lead = analyzeGeneralPolicyConflict('Avise com 24 h de antecedência.', {
      signalOn: false,
    })
    expect(lead.blocksSave).toBe(false)
    expect(lead.softWarns).toEqual([])

    const pix = analyzeGeneralPolicyConflict('O sinal não se devolve.', {
      signalOn: false,
    })
    expect(pix.blocksSave).toBe(false)
    expect(pix.softWarns.length).toBeGreaterThan(0)
  })

  it('mensagem de bloqueio lista o motivo', () => {
    const r = analyzeGeneralPolicyConflict(
      'Avise com 12 h; o crédito fica para o próximo.',
      { signalOn: true },
    )
    const msg = formatPolicyConflictMessage(r)
    expect(msg).toMatch(/Recebimento do sinal/)
    expect(msg).toMatch(/prazo|crédito/i)
  })
})

describe('joinPolicyParts não stripa B legado (Q3)', () => {
  it('sinal + B conflituoso continua a juntar A e B', () => {
    const a = 'Sinal de R$ 50,00. Crédito se cancelar com 12 h de antecedência.'
    const b = 'Avise com 24 h de antecedência.'
    const out = joinPolicyParts(a, b)
    expect(out).toContain(a)
    expect(out).toContain(POLICY_JOIN_PHRASE)
    expect(out).toContain(b)
  })
})
