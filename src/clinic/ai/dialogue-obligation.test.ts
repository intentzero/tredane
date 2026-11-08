import { describe, expect, it } from 'vitest'
import {
  isChoiceObligation,
  obligationFromPending,
  resumeObligationAfterAskInfo,
  shouldEmitOptionMiss,
} from './dialogue-obligation'

describe('DialogueObligation (DEC-C4 / DEC-C3)', () => {
  it('tipa pending.variantes como choose_variants', () => {
    const ob = obligationFromPending({
      slot: 'variantes',
      options: [{ key: 'a', label: 'Axila' }],
      messageId: 'm1',
    })
    expect(ob?.kind).toBe('choose_variants')
    expect(isChoiceObligation(ob)).toBe(true)
  })

  it('tipa pending.horario como choose_slot', () => {
    const ob = obligationFromPending({
      slot: 'horario',
      options: [{ key: '2026-11-10T14:00', label: '14:00' }],
      messageId: 'm2',
    })
    expect(ob?.kind).toBe('choose_slot')
  })

  it('option-miss permitido em ask-tipo / choose_variants', () => {
    const ob = obligationFromPending({
      slot: 'variantes',
      options: [{ key: 'a', label: 'Axila' }],
      messageId: 'm1',
    })
    expect(
      shouldEmitOptionMiss({
        obligation: ob,
        unrecognizedLeftover: true,
        attemptedOptionMatch: true,
      }),
    ).toBe(true)
    // Sem pending formal (ask-tipo ainda a abrir Opções).
    expect(
      shouldEmitOptionMiss({
        obligation: null,
        unrecognizedLeftover: true,
        attemptedOptionMatch: true,
      }),
    ).toBe(true)
  })

  it('option-miss recusado em choose_slot (leftover de zona ≠ miss de horário)', () => {
    const ob = obligationFromPending({
      slot: 'horario',
      options: [{ key: 'k', label: '14:00' }],
      messageId: 'm2',
    })
    expect(
      shouldEmitOptionMiss({
        obligation: ob,
        unrecognizedLeftover: true,
        attemptedOptionMatch: true,
      }),
    ).toBe(false)
  })

  it('option-miss recusado sem tentativa de escolha', () => {
    expect(
      shouldEmitOptionMiss({
        obligation: null,
        unrecognizedLeftover: true,
        attemptedOptionMatch: false,
      }),
    ).toBe(false)
  })

  it('resume após ask_info preserva a mesma obrigação (DEC-C1)', () => {
    const ob = obligationFromPending({
      slot: 'variantes',
      options: [{ key: 'a', label: 'Axila' }],
      messageId: 'm1',
    })
    expect(resumeObligationAfterAskInfo(ob)).toEqual(ob)
    expect(resumeObligationAfterAskInfo(null)).toBeNull()
  })
})
