import { describe, expect, it } from 'vitest'
import {
  civilMinuteToEpoch,
  defaultConfirmBy,
  durationLabel,
  holdConfirmedMessage,
  holdOptionsMessage,
  holdReservedMessage,
  periodChip,
  shortDay,
  startsInLabel,
} from './holdFormat'

const TZ = 'America/Sao_Paulo'

describe('holdFormat', () => {
  it('converte data civil + minuto no fuso da clínica', () => {
    expect(new Date(civilMinuteToEpoch('2026-11-03', 8 * 60, TZ)).toISOString()).toBe('2026-11-03T11:00:00.000Z')
    expect(new Date(civilMinuteToEpoch('2026-11-03', 18 * 60, 'UTC')).toISOString()).toBe('2026-11-03T18:00:00.000Z')
  })

  it('rótulos de período, dia e duração', () => {
    const s = civilMinuteToEpoch('2026-11-03', 480, TZ)
    expect(periodChip(s, civilMinuteToEpoch('2026-11-03', 720, TZ), TZ)).toBe('manhã')
    expect(periodChip(s + 3_600_000, civilMinuteToEpoch('2026-11-03', 780, TZ), TZ)).toBe('9h–13h')
    expect(shortDay(s, TZ)).toBe('Ter 3/11')
    expect(durationLabel(60)).toBe('1 h')
    expect(durationLabel(90)).toBe('1h30')
    expect(durationLabel(45)).toBe('45 min')
  })

  it('mensagens de WhatsApp', () => {
    const ws = civilMinuteToEpoch('2026-11-03', 480, TZ)
    const we = civilMinuteToEpoch('2026-11-03', 720, TZ)
    const msg = holdReservedMessage({
      contactName: 'Marina Costa',
      serviceName: 'Preenchimento labial',
      professionalName: 'Dra. Ana',
      windowStartsAt: ws,
      windowEndsAt: we,
      confirmBy: defaultConfirmBy('2026-11-03', ws, TZ, Date.UTC(2026, 9, 27)),
      timeZone: TZ,
    })
    expect(msg).toContain('Olá, Marina!')
    expect(msg).toContain('terça, 3/11, de manhã, com Dra. Ana')
    expect(msg).toContain('até segunda, 2/11')
    const ok = holdConfirmedMessage({
      contactName: 'Marina',
      serviceName: 'Preenchimento labial',
      professionalName: 'Dra. Ana',
      startsAt: ws + 7_200_000,
      endsAt: ws + 10_800_000,
      timeZone: TZ,
    })
    expect(ok).toContain('às 10:00 (até 11:00)')
    const opts = holdOptionsMessage({
      contactName: null,
      professionalName: 'Dra. Ana',
      windowStartsAt: ws,
      windowEndsAt: we,
      options: [ws + 3_600_000, ws + 7_200_000],
      timeZone: TZ,
    })
    expect(opts.split('\n')).toHaveLength(4)
    expect(opts).toContain('2️⃣ 10:00')
  })

  it('quanto falta para o bloco', () => {
    expect(startsInLabel(1000 + 18 * 3_600_000, 1000 + 22 * 3_600_000, 1000)).toBe('Começa em 18 h')
    expect(startsInLabel(0, 10, 20)).toBe('Período passou')
  })
})
