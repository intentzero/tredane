import { describe, expect, it, vi } from 'vitest'
import { createControllableClock } from '../db/clock'
import { DoInvocationTimer, syncDoStorage } from './clinic-do-timing'

describe('clinic-do-timing', () => {
  it('DoInvocationTimer mede atraso até handler', () => {
    const clock = createControllableClock(1_000)
    const timer = new DoInvocationTimer('test', clock)
    clock.advance(12)
    timer.markHandlerEntry(clock)
    expect(timer.handlerDelayMs()).toBe(12)
    clock.advance(5)
    expect(timer.totalMs(clock)).toBe(17)
  })

  it('syncDoStorage retorna duração do flush', async () => {
    const clock = createControllableClock(0)
    const sync = vi.fn(async () => {
      clock.advance(25)
    })
    const ms = await syncDoStorage({ sync }, clock)
    expect(ms).toBe(25)
    expect(sync).toHaveBeenCalledOnce()
  })
})
