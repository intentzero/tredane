import { describe, expect, it } from 'vitest'
import type { ServiceRow } from '../config/types'
import { classifyTurn, TURN_ORDER, type ClassifyTurnInput } from './classify-turn'

const svc = (id: string, name: string): ServiceRow =>
  ({ id, name, active: true, synonyms: [], zones: [], audiencia: 'qualquer' }) as unknown as ServiceRow
const services = [svc('lim', 'Limpeza de pele'), svc('mas', 'Massagem relaxante')]

const base = (over: Partial<ClassifyTurnInput> = {}): ClassifyTurnInput => ({
  text: '',
  services,
  hasUpcoming: false,
  handoffReason: () => null,
  isFarewell: () => false,
  ...over,
})
const kind = (text: string, over: Partial<ClassifyTurnInput> = {}) => classifyTurn(base({ text, ...over })).kind

describe('classifyTurn: a ordem de decisão é o contrato (DEC-202, P3)', () => {
  it('a ordem das classes está fixada', () => {
    expect(TURN_ORDER).toEqual([
      'link_early',
      'handoff',
      'farewell',
      'my_appointments',
      'catalog_list',
      'link_route',
      'info',
    ])
  })

  it('cumprimento, cancelar e remarcar próprios ganham ao handoff', () => {
    const handoff = { handoffReason: () => 'customer_requested' }
    expect(kind('Oi', handoff)).toBe('link_early')
    expect(kind('quero cancelar minha consulta', handoff)).toBe('link_early')
    expect(kind('quero remarcar', { ...handoff, hasUpcoming: true })).toBe('link_early')
  })

  it('sem marcação futura, cancelar abre em agendar com noUpcoming', () => {
    expect(classifyTurn(base({ text: 'quero cancelar' }))).toEqual({
      kind: 'link_early',
      route: { purpose: 'agendar', serviceId: null, noUpcoming: true },
    })
  })

  it('o handoff ganha à despedida e à lista de serviços', () => {
    const r = { handoffReason: () => 'customer_requested', isFarewell: () => true }
    expect(kind('quais serviços vocês têm?', r)).toBe('handoff')
  })

  it('despedida ganha a «meus agendamentos» e ao link', () => {
    expect(kind('meus agendamentos', { isFarewell: () => true })).toBe('farewell')
  })

  it('lista de serviços é informação e ganha ao pedido de marcar', () => {
    expect(kind('quais serviços vocês oferecem?')).toBe('catalog_list')
  })

  it('pedido de marcar leva ao link; informação pura não', () => {
    expect(kind('quero marcar limpeza de pele')).toBe('link_route')
    expect(kind('quanto custa a limpeza de pele?')).toBe('info')
    expect(kind('qual o horário de funcionamento?')).toBe('info')
  })

  it('turno misto é link_route com mixed', () => {
    const c = classifyTurn(base({ text: 'quanto custa a limpeza de pele e tem horário amanhã?' }))
    expect(c).toMatchObject({ kind: 'link_route', route: { purpose: 'agendar', mixed: true } })
  })

  it('as sondas preguiçosas só correm se as etapas anteriores não decidiram', () => {
    let handoffCalls = 0
    let farewellCalls = 0
    classifyTurn(base({ text: 'Oi', handoffReason: () => (handoffCalls++, null), isFarewell: () => (farewellCalls++, false) }))
    expect([handoffCalls, farewellCalls]).toEqual([0, 0])
    classifyTurn(
      base({ text: 'bom dia, tudo bem com vocês?', handoffReason: () => (handoffCalls++, null), isFarewell: () => (farewellCalls++, false) }),
    )
    expect(handoffCalls).toBe(1)
    expect(farewellCalls).toBe(1)
  })
})
