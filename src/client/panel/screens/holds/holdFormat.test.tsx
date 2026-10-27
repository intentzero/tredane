import { describe, expect, it } from 'vitest'
import {
  civilMinuteToEpoch,
  durationLabel,
  holdConfirmedMessage,
  periodChip,
  shortDay,
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
    const ok = holdConfirmedMessage({
      contactName: 'Marina',
      serviceName: 'Preenchimento labial',
      professionalName: 'Dra. Ana',
      startsAt: ws + 7_200_000,
      endsAt: ws + 10_800_000,
      timeZone: TZ,
    })
    expect(ok).toContain('Olá, Marina!')
    expect(ok).toContain('terça, 3/11, às 10:00 (até 11:00)')
    // Fuso configurável da clínica: a mesma hora em Lisboa.
    expect(
      holdConfirmedMessage({
        contactName: null,
        serviceName: 'Limpeza',
        professionalName: 'Ana',
        startsAt: ws,
        endsAt: ws + 3_600_000,
        timeZone: 'Europe/Lisbon',
      }),
    ).toContain('às 11:00 (até 12:00)')
  })
})
