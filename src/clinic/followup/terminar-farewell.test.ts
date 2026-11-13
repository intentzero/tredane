import { afterEach, describe, expect, it } from 'vitest'
import {
  dayPartGreeting,
  isTerminarFarewellBody,
  pickTerminarFarewell,
  setTerminarFarewellIndexForTests,
  terminarFarewellCandidates,
  terminarFarewellWithGreeting,
} from './terminar-farewell'

const TZ = 'America/Sao_Paulo'

afterEach(() => {
  setTerminarFarewellIndexForTests(null)
})

describe('terminar-farewell', () => {
  it('dayPartGreeting: manhã / tarde / noite no fuso da clínica', () => {
    // 2026-11-13 10:00 BRT = 13:00 UTC
    expect(dayPartGreeting(TZ, Date.UTC(2026, 10, 13, 13))).toBe('Bom dia')
    // 14:00 BRT = 17:00 UTC
    expect(dayPartGreeting(TZ, Date.UTC(2026, 10, 13, 17))).toBe('Boa tarde')
    // 19:00 BRT = 22:00 UTC
    expect(dayPartGreeting(TZ, Date.UTC(2026, 10, 13, 22))).toBe('Boa noite')
    // 00:30 BRT = 03:30 UTC → ainda noite
    expect(dayPartGreeting(TZ, Date.UTC(2026, 10, 13, 3, 30))).toBe('Boa noite')
  })

  it('pickTerminarFarewell respeita RNG injectável e índice de teste', () => {
    const nowMs = Date.UTC(2026, 10, 13, 17) // Boa tarde
    const candidates = terminarFarewellCandidates(TZ, nowMs)
    expect(candidates[2]).toBe(terminarFarewellWithGreeting('Boa tarde'))

    expect(pickTerminarFarewell({ timezone: TZ, nowMs, random: () => 0 })).toBe(candidates[0])
    expect(pickTerminarFarewell({ timezone: TZ, nowMs, random: () => 0.34 })).toBe(
      candidates[1],
    )
    expect(pickTerminarFarewell({ timezone: TZ, nowMs, random: () => 0.99 })).toBe(
      candidates[2],
    )

    setTerminarFarewellIndexForTests(2)
    expect(pickTerminarFarewell({ timezone: TZ, nowMs, random: () => 0 })).toBe(candidates[2])
  })

  it('isTerminarFarewellBody reconhece as três frases do instante', () => {
    const nowMs = Date.UTC(2026, 10, 13, 13) // Bom dia
    for (const body of terminarFarewellCandidates(TZ, nowMs)) {
      expect(isTerminarFarewellBody(body, TZ, nowMs)).toBe(true)
    }
    expect(isTerminarFarewellBody('Sem problema. Quando quiser, é só chamar.', TZ, nowMs)).toBe(
      false,
    )
  })
})
