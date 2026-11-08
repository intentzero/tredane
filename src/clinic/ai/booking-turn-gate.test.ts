import { describe, expect, it } from 'vitest'
import { classifyCrossCuttingAct, isCrossCuttingInterrupt } from './booking-turn-gate'

describe('classifyCrossCuttingAct (P1 gate)', () => {
  it('restart antes de fillers', () => {
    const act = classifyCrossCuttingAct({ text: 'quero recomeçar' })
    expect(act.kind).toBe('restart')
    expect(isCrossCuttingInterrupt(act)).toBe(true)
  })

  it('Terminar = exit_ab explícito (DEC-147 A / DEC-152)', () => {
    const act = classifyCrossCuttingAct({ text: 'Terminar' })
    expect(act.kind).toBe('exit_ab')
    if (act.kind === 'exit_ab') expect(act.explicit).toBe(true)
  })

  it('obrigado após oferta = exit_ab (classe B)', () => {
    const act = classifyCrossCuttingAct({ text: 'obrigado!' })
    expect(act.kind).toBe('exit_ab')
  })

  it('não serve = reject_c', () => {
    const act = classifyCrossCuttingAct({ text: 'não serve' })
    expect(act.kind).toBe('reject_c')
  })

  it('quanto custa = ask_info price (antes de zone leftover)', () => {
    const act = classifyCrossCuttingAct({ text: 'Quanto custa?' })
    expect(act.kind).toBe('ask_info')
    if (act.kind === 'ask_info') expect(act.topic).toBe('price')
  })

  it('qual o valor = ask_info price', () => {
    const act = classifyCrossCuttingAct({ text: 'Qual o valor?' })
    expect(act.kind).toBe('ask_info')
    if (act.kind === 'ask_info') expect(act.topic).toBe('price')
  })

  it('quanto tempo dura = ask_info duration', () => {
    const act = classifyCrossCuttingAct({ text: 'Quanto tempo dura?' })
    expect(act.kind).toBe('ask_info')
    if (act.kind === 'ask_info') expect(act.topic).toBe('duration')
  })

  it('escolha de variante = none (segue pending/filler)', () => {
    const act = classifyCrossCuttingAct({ text: 'Massagem relaxante' })
    expect(act.kind).toBe('none')
    expect(isCrossCuttingInterrupt(act)).toBe(false)
  })

  it('ordem: exit vence ask_info se ambos casarem (não aplicável tipicamente)', () => {
    // «terminar» não é preço; garante que Class A não cai em none.
    expect(classifyCrossCuttingAct({ text: 'quero terminar' }).kind).toBe('exit_ab')
  })
})
