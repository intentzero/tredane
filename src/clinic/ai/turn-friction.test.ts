/**
 * T2 session-analytics — friction flags mínimas (sem texto da cliente).
 */
import { describe, expect, it } from 'vitest'
import {
  assertFrictionMinimized,
  detectDayAskIgnoredLockedVariant,
  foldFrictionTerm,
  frictionForCatalogMiss,
  frictionForOptionMiss,
  frictionModeUmaTodas,
  frictionTermHash,
  isParticleFrictionTerm,
  mergeFriction,
  turnLooksLikeDayOrTimeAsk,
} from './turn-friction'

describe('turn-friction T2', () => {
  it('termHash é estável e não contém o termo', () => {
    const h = frictionTermHash('Cotovelo')
    expect(h).toBe(frictionTermHash('cotovelo'))
    expect(h).toBe(frictionTermHash(foldFrictionTerm('COTÓVELO')))
    expect(h).toHaveLength(16)
    expect(h).not.toMatch(/cotovelo/i)
  })

  it('nao_encontrei zona + particle_as_zone quando leftover é partícula', () => {
    const zone = frictionForOptionMiss('cotovelo')
    expect(zone).toEqual([
      {
        flag: 'nao_encontrei',
        kind: 'zone',
        termHash: frictionTermHash('cotovelo'),
      },
    ])

    const particle = frictionForOptionMiss('tem')
    expect(particle.map((e) => e.flag).sort()).toEqual(['nao_encontrei', 'particle_as_zone'])
    expect(particle.find((e) => e.flag === 'nao_encontrei')?.kind).toBe('particle_suspected')
    expect(particle.every((e) => e.termHash === frictionTermHash('tem'))).toBe(true)
    expect(isParticleFrictionTerm('feira')).toBe(true)
    expect(isParticleFrictionTerm('disponível')).toBe(true)
  })

  it('catalog miss emite nao_encontrei kind=catalog', () => {
    expect(frictionForCatalogMiss('brinzeamento')).toEqual([
      {
        flag: 'nao_encontrei',
        kind: 'catalog',
        termHash: frictionTermHash('brinzeamento'),
      },
    ])
  })

  it('mode_uma_todas só carrega serviceId opaco', () => {
    expect(frictionModeUmaTodas('svc_massagem')).toEqual({
      flag: 'mode_uma_todas',
      serviceId: 'svc_massagem',
    })
  })

  it('day_ask_ignored_locked_variant só quando limpa/reabre com variante travada', () => {
    expect(
      detectDayAskIgnoredLockedVariant({
        frameBefore: { variantIds: ['z1'], pending: { slot: 'horario' } },
        frameAfter: { variantIds: ['z1'], pending: { slot: 'horario' } },
        turnLooksLikeDayAsk: true,
      }),
    ).toBeNull()

    expect(
      detectDayAskIgnoredLockedVariant({
        frameBefore: { variantIds: ['z1'], pending: { slot: 'horario' } },
        frameAfter: { variantIds: null, pending: { slot: 'variantes' } },
        turnLooksLikeDayAsk: true,
      }),
    ).toEqual({
      flag: 'day_ask_ignored_locked_variant',
      pendingSlotBefore: 'horario',
    })

    expect(
      detectDayAskIgnoredLockedVariant({
        frameBefore: { variantIds: ['z1'], pending: null },
        frameAfter: { variantIds: null, pending: { slot: 'variantes' } },
        turnLooksLikeDayAsk: false,
      }),
    ).toBeNull()
  })

  it('turnLooksLikeDayOrTimeAsk cobre as frases de staging', () => {
    expect(turnLooksLikeDayOrTimeAsk('Tem horário na próxima quarta?')).toBe(true)
    expect(turnLooksLikeDayOrTimeAsk('Quarta feira tem horário?')).toBe(true)
    expect(turnLooksLikeDayOrTimeAsk('axila')).toBe(false)
  })

  it('mergeFriction deduplica e assertFrictionMinimized rejeita prosa', () => {
    const a = frictionForOptionMiss('cotovelo')
    expect(mergeFriction(a, a)).toHaveLength(1)
    expect(() =>
      assertFrictionMinimized([{ flag: 'nao_encontrei', leftover: 'tem' } as never]),
    ).toThrow(/texto/)
  })
})
