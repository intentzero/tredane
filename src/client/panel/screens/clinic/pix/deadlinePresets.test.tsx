// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  OTHER_CREDIT_WINDOW_SEED_MINUTES,
  OTHER_LEAD_SEED_MINUTES,
  SIGNAL_DEADLINE_PRESETS_MINUTES,
  combineCustomDeadline,
  formatDeadlinePresetLabel,
  isDeadlineMinutesValid,
  isDeadlinePreset,
  minutesToSeconds,
  normalizeDeadlineMinutes,
  sanitizeCustomAmountInput,
  secondsToMinutes,
  splitCustomDeadline,
} from './deadlinePresets'

describe('deadlinePresets (DEC-182 / M-33)', () => {
  it('presets de prazo são só 15 e 30 min', () => {
    expect([...SIGNAL_DEADLINE_PRESETS_MINUTES]).toEqual([15, 30])
  })

  it('converte minutos ↔ segundos sem perda nos presets', () => {
    for (const m of SIGNAL_DEADLINE_PRESETS_MINUTES) {
      expect(secondsToMinutes(minutesToSeconds(m))).toBe(m)
    }
  })

  it('rotula presets de prazo', () => {
    expect(formatDeadlinePresetLabel(15)).toBe('15 min')
    expect(formatDeadlinePresetLabel(30)).toBe('30 min')
  })

  it('valida só 15 e 30 min', () => {
    expect(isDeadlineMinutesValid(15)).toBe(true)
    expect(isDeadlineMinutesValid(30)).toBe(true)
    expect(isDeadlineMinutesValid(90)).toBe(false)
    expect(isDeadlineMinutesValid(14)).toBe(false)
    expect(isDeadlineMinutesValid(60)).toBe(false)
    expect(isDeadlineMinutesValid(15.5)).toBe(false)
  })

  it('mapeia prazo legado para 30 min', () => {
    expect(normalizeDeadlineMinutes(120)).toBe(30)
    expect(normalizeDeadlineMinutes(15)).toBe(15)
    expect(normalizeDeadlineMinutes(30)).toBe(30)
  })

  it('Outro… parte múltiplos de 60 em horas e limita a 2 dígitos', () => {
    expect(splitCustomDeadline(90)).toEqual({ amount: 90, unit: 'min' })
    expect(splitCustomDeadline(180)).toEqual({ amount: 3, unit: 'h' })
    expect(combineCustomDeadline(90, 'min')).toBe(90)
    expect(combineCustomDeadline(2, 'h')).toBe(120)
    expect(combineCustomDeadline(100, 'min')).toBeNull()
    expect(combineCustomDeadline(0, 'min')).toBeNull()
    expect(sanitizeCustomAmountInput('123')).toBe('12')
    expect(OTHER_LEAD_SEED_MINUTES).toBe(120)
    expect(OTHER_CREDIT_WINDOW_SEED_MINUTES).toBe(36 * 60)
  })

  it('reconhece presets vs personalizado', () => {
    expect(isDeadlinePreset(30)).toBe(true)
    expect(isDeadlinePreset(90)).toBe(false)
  })
})
