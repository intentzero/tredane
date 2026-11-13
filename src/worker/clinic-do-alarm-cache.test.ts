/**
 * Regressão staging 13/11 08:20 BRT: depois do 1.º alarme de uma instância do DO,
 * o cache `#scheduledAlarmAt` (PR #708) ficava com uma hora já passada e
 * suprimia todos os `setAlarm` seguintes — o autodraft da 2.ª mensagem nunca
 * corria (sem typing, sem «lida», sem resposta).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canSkipAlarmSchedule } from './clinic-do-timing'

/** Modelo mínimo de `#scheduleAlarmNoLaterThan` + runtime de alarmes do DO. */
function makeScheduler() {
  let cached: number | null = null
  let stored: number | null = null
  const setCalls: number[] = []
  return {
    setCalls,
    schedule(at: number, now: number) {
      if (canSkipAlarmSchedule(cached, at, now)) return
      if (stored != null && stored <= at) {
        cached = stored
        return
      }
      stored = at
      cached = at
      setCalls.push(at)
    },
    fire(resetCache: boolean) {
      stored = null // o runtime apaga o alarme ao dispará-lo
      if (resetCache) cached = null
    },
  }
}

describe('ClinicDurableObject — cache do alarme', () => {
  it('canSkipAlarmSchedule só salta com alarme futuro que chega a tempo', () => {
    expect(canSkipAlarmSchedule(null, 2_000, 1_000)).toBe(false)
    expect(canSkipAlarmSchedule(1_500, 2_000, 1_000)).toBe(true)
    expect(canSkipAlarmSchedule(2_500, 2_000, 1_000)).toBe(false)
    // alarme em cache já disparou: tem de voltar a agendar
    expect(canSkipAlarmSchedule(1_500, 30_000, 20_000)).toBe(false)
    expect(canSkipAlarmSchedule(20_000, 30_000, 20_000)).toBe(false)
  })

  it('2.ª mensagem depois de um alarme disparado volta a agendar (sem reset explícito)', () => {
    const s = makeScheduler()
    s.schedule(16_300, 16_000) // msg 1 (debounce)
    s.fire(false)
    s.schedule(30_300, 30_000) // msg 2, 14 s depois
    expect(s.setCalls).toEqual([16_300, 30_300])
  })

  it('2.ª mensagem depois de um alarme disparado volta a agendar (com reset no alarm())', () => {
    const s = makeScheduler()
    s.schedule(16_300, 16_000)
    s.fire(true)
    s.schedule(30_300, 30_000)
    expect(s.setCalls).toEqual([16_300, 30_300])
  })

  it('alarm() esquece o cache antes de correr', () => {
    const src = readFileSync(resolve(import.meta.dirname, 'clinic-do.ts'), 'utf8')
    const start = src.indexOf('  async alarm(): Promise<void> {')
    expect(start).toBeGreaterThan(0)
    const head = src.slice(start, src.indexOf("#withRpc('alarm'", start))
    expect(head).toMatch(/this\.#scheduledAlarmAt = null/)
    expect(src).toMatch(/canSkipAlarmSchedule\(this\.#scheduledAlarmAt, at, this\.#clock\.nowMs\(\)\)/)
  })
})
