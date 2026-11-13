// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  OTHER_DEADLINE_SEED_MINUTES,
  SIGNAL_DEADLINE_PRESETS_MINUTES,
  combineCustomDeadline,
  formatDeadlinePresetLabel,
  isDeadlineMinutesValid,
  isDeadlinePreset,
  minutesToSeconds,
  secondsToMinutes,
  splitCustomDeadline,
} from './deadlinePresets'

describe('deadlinePresets (DEC-179 / M-33)', () => {
  it('presets são 15 min … 48 h', () => {
    expect([...SIGNAL_DEADLINE_PRESETS_MINUTES]).toEqual([
      15, 30, 60, 120, 360, 1440, 2880,
    ])
  })

  it('converte minutos ↔ segundos sem perda nos presets', () => {
    for (const m of SIGNAL_DEADLINE_PRESETS_MINUTES) {
      expect(secondsToMinutes(minutesToSeconds(m))).toBe(m)
    }
  })

  it('rotula presets como no mock', () => {
    expect(formatDeadlinePresetLabel(15)).toBe('15 min')
    expect(formatDeadlinePresetLabel(30)).toBe('30 min')
    expect(formatDeadlinePresetLabel(60)).toBe('1 h')
    expect(formatDeadlinePresetLabel(120)).toBe('2 h')
    expect(formatDeadlinePresetLabel(360)).toBe('6 h')
    expect(formatDeadlinePresetLabel(1440)).toBe('24 h')
    expect(formatDeadlinePresetLabel(2880)).toBe('48 h')
  })

  it('valida 15 min–48 h inclusive', () => {
    expect(isDeadlineMinutesValid(15)).toBe(true)
    expect(isDeadlineMinutesValid(2880)).toBe(true)
    expect(isDeadlineMinutesValid(90)).toBe(true)
    expect(isDeadlineMinutesValid(14)).toBe(false)
    expect(isDeadlineMinutesValid(2881)).toBe(false)
    expect(isDeadlineMinutesValid(15.5)).toBe(false)
  })

  it('Outro… parte múltiplos de 60 em horas', () => {
    expect(splitCustomDeadline(90)).toEqual({ amount: 90, unit: 'min' })
    expect(splitCustomDeadline(180)).toEqual({ amount: 3, unit: 'h' })
    expect(combineCustomDeadline(90, 'min')).toBe(90)
    expect(combineCustomDeadline(1.5, 'h')).toBe(90)
    expect(combineCustomDeadline(0, 'min')).toBeNull()
    expect(OTHER_DEADLINE_SEED_MINUTES).toBe(90)
  })

  it('reconhece presets vs personalizado', () => {
    expect(isDeadlinePreset(120)).toBe(true)
    expect(isDeadlinePreset(90)).toBe(false)
  })
})
