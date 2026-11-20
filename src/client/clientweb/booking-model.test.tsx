import { describe, expect, it } from 'vitest'
import type { Catalog, CatalogService } from './api'
import {
  canGoNextWeek,
  canGoPrevWeek,
  catalogNeedsLine,
  civilDayLabel,
  dayPart,
  resolveSchedulePreset,
  weekStartForDay,
  formatPrice,
  prevWeekStart,
  servicesForLine,
  visitTotals,
  weekDays,
  zonesForLine,
} from './booking-model'

const svc = (over: Partial<CatalogService> & { id: string }): CatalogService => ({
  name: over.id,
  synonyms: [],
  durationMinutes: 60,
  priceCents: 12_000,
  audience: 'qualquer',
  variantKind: null,
  variantKindPlural: null,
  variantSelection: 'varias',
  requiresSignal: false,
  zones: [],
  professionals: [],
  ...over,
})

const laser = svc({
  id: 'laser',
  zones: [
    { id: 'ax', name: 'Axilas', synonyms: [], audience: 'feminino', durationMinutes: 15, priceCents: 4_000 },
    { id: 'ba', name: 'Barba', synonyms: [], audience: 'masculino', durationMinutes: 30, priceCents: 8_000 },
    { id: 'so', name: 'Sobrancelha', synonyms: [], audience: 'ambos', durationMinutes: 15, priceCents: 3_050 },
  ],
})
const limpeza = svc({ id: 'limpeza' })
const catalog = (services: CatalogService[]): Catalog => ({ timezone: 'America/Sao_Paulo', horizonDays: 30, today: '2026-11-17', services })

describe('género no catálogo (DEC-200)', () => {
  it('só pergunta «Para quem é?» quando o catálogo depende de género', () => {
    expect(catalogNeedsLine(catalog([limpeza]))).toBe(false)
    expect(catalogNeedsLine(catalog([limpeza, laser]))).toBe(true)
    expect(catalogNeedsLine(catalog([svc({ id: 'f', audience: 'feminino' })]))).toBe(true)
  })

  it('sem linha só mostra o que não depende de género; com linha filtra serviços e zonas', () => {
    const c = catalog([limpeza, laser, svc({ id: 'so-fem', audience: 'feminino' })])
    expect(servicesForLine(c, null).map((s) => s.id)).toEqual(['limpeza'])
    expect(servicesForLine(c, 'feminino').map((s) => s.id)).toEqual(['limpeza', 'laser', 'so-fem'])
    expect(servicesForLine(c, 'masculino').map((s) => s.id)).toEqual(['limpeza', 'laser'])
    expect(zonesForLine(laser, 'feminino').map((z) => z.id)).toEqual(['ax', 'so'])
    expect(zonesForLine(laser, 'masculino').map((z) => z.id)).toEqual(['ba', 'so'])
  })

  it('serviço com zonas só do outro género não aparece', () => {
    const soBarba = svc({ id: 'barba', zones: [{ id: 'ba', name: 'Barba', synonyms: [], audience: 'masculino', durationMinutes: 30, priceCents: 8_000 }] })
    expect(servicesForLine(catalog([soBarba]), 'feminino')).toEqual([])
  })
})

describe('totais e preço', () => {
  it('soma zonas; sem zonas usa o serviço; sem preço numa zona fica «sob consulta»', () => {
    expect(visitTotals(laser, ['ax', 'so'])).toEqual({
      minutes: 30,
      priceCents: 7_050,
      listPriceCents: null,
      combo: null,
    })
    expect(visitTotals(limpeza, [])).toEqual({
      minutes: 60,
      priceCents: 12_000,
      listPriceCents: null,
      combo: null,
    })
    const semPreco = svc({ id: 'x', zones: [{ id: 'z', name: 'Z', synonyms: [], audience: 'ambos', durationMinutes: 10, priceCents: null }] })
    expect(visitTotals(semPreco, ['z']).priceCents).toBeNull()
    expect(formatPrice(null)).toBe('Sob consulta')
  })
  it('aplica o combo sozinho quando todas as zonas dele estão escolhidas (DEC-080)', () => {
    const withCombo = svc({
      id: 'laser-combo',
      zones: [
        { id: 'ax', name: 'Axilas', synonyms: [], audience: 'feminino', durationMinutes: 15, priceCents: 4_000 },
        { id: 'vi', name: 'Virilha', synonyms: [], audience: 'feminino', durationMinutes: 20, priceCents: 5_000 },
        { id: 'bu', name: 'Buço', synonyms: [], audience: 'feminino', durationMinutes: 5, priceCents: 2_000 },
      ],
      combos: [{ id: 'c1', name: 'Buço + axila', priceCents: 5_000, zoneIds: ['ax', 'bu'] }],
    })
    expect(visitTotals(withCombo, ['ax', 'bu'])).toEqual({
      minutes: 20,
      priceCents: 5_000,
      listPriceCents: 6_000,
      combo: { name: 'Buço + axila', discountCents: 1_000 },
    })
    expect(visitTotals(withCombo, ['ax', 'bu', 'vi'])).toMatchObject({
      priceCents: 10_000,
      combo: { name: 'Buço + axila', discountCents: 1_000 },
    })
    expect(visitTotals(withCombo, ['ax']).combo).toBeNull()
  })
  it('formata em reais, sem centavos quando inteiro', () => {
    expect(formatPrice(9_000).replace(/\s/g, ' ')).toBe('R$ 90')
    expect(formatPrice(7_050).replace(/\s/g, ' ')).toBe('R$ 70,50')
  })
})

describe('semanas e dias', () => {
  it('semana de 7 dias cortada ao horizonte e setas coerentes', () => {
    expect(weekDays('2026-11-17', '2026-11-17', 30)).toHaveLength(7)
    const last = weekDays('2026-12-15', '2026-11-17', 30)
    expect(last[last.length - 1]).toBe('2026-12-16')
    expect(canGoPrevWeek('2026-11-17', '2026-11-17')).toBe(false)
    expect(canGoPrevWeek('2026-11-24', '2026-11-17')).toBe(true)
    expect(canGoNextWeek('2026-12-08', '2026-11-17', 30)).toBe(true)
    expect(canGoNextWeek('2026-12-15', '2026-11-17', 30)).toBe(false)
    expect(prevWeekStart('2026-11-20', '2026-11-17')).toBe('2026-11-17')
  })
  it('rótulo civil e período do dia', () => {
    expect(civilDayLabel('2026-11-25')).toMatchObject({ weekday: 'qua', short: '25', dayMonth: '25/11' })
    expect(dayPart('09:00')).toBe('Manhã')
    expect(dayPart('12:00')).toBe('Tarde')
    expect(dayPart('18:00')).toBe('Noite')
  })
  it('resolveSchedulePreset valida data no horizonte', () => {
    const catalog = { today: '2026-11-18', horizonDays: 30, timezone: 'America/Sao_Paulo', services: [] }
    expect(resolveSchedulePreset(catalog, { preferredDate: '2026-11-19', dayPart: 'manha' })).toEqual({
      preferredDate: '2026-11-19',
      preferredDayPart: 'Manhã',
    })
    expect(resolveSchedulePreset(catalog, { preferredDate: '2025-01-01', dayPart: null }).preferredDate).toBeNull()
    expect(weekStartForDay('2026-11-19', '2026-11-18')).toBe('2026-11-19')
  })
})
