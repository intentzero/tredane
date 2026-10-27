import { describe, expect, it } from 'vitest'
import { avatarTone, dayLabel, sameDay, windowHint } from './format'

const NOW = Date.UTC(2026, 9, 27, 18, 0) // 27/10/2026 15:00 em Brasília

describe('avatarTone', () => {
  it('é estável e fica entre 1 e 4', () => {
    expect(avatarTone('Marina Alves')).toBe(avatarTone('Marina Alves'))
    for (const n of ['Ana', 'Bruno', 'Carla Mendes', '+55 11 9••••-1234', '']) {
      expect([1, 2, 3, 4]).toContain(avatarTone(n))
    }
  })
})

describe('dayLabel / sameDay', () => {
  it('Hoje, Ontem e data por extenso, no fuso de Brasília', () => {
    expect(dayLabel(NOW - 60_000, NOW)).toBe('Hoje')
    expect(dayLabel(NOW - 86_400_000, NOW)).toBe('Ontem')
    expect(dayLabel(Date.UTC(2026, 9, 20, 18, 0), NOW)).toBe('20 de outubro')
  })

  it('23:30 de Brasília ainda é o mesmo dia mesmo já sendo o dia seguinte em UTC', () => {
    const a = Date.UTC(2026, 9, 27, 14, 0)
    const b = Date.UTC(2026, 9, 28, 2, 30) // 23:30 do dia 27 em Brasília
    expect(sameDay(a, b)).toBe(true)
  })
})

describe('windowHint', () => {
  it('diz até quando pode responder livremente', () => {
    expect(windowHint(Date.UTC(2026, 9, 27, 21, 33), NOW)).toBe(
      'Você pode responder livremente até hoje às 18:33.',
    )
    expect(windowHint(Date.UTC(2026, 9, 28, 15, 33), NOW)).toBe(
      'Você pode responder livremente até amanhã às 12:33.',
    )
  })

  it('sem janela ou já fechada não mostra nada', () => {
    expect(windowHint(null, NOW)).toBeNull()
    expect(windowHint(NOW - 1, NOW)).toBeNull()
  })
})
