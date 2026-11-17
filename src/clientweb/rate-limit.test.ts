import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { bootAdminDb } from '../db/test-db'
import { CLIENT_WEB_RATE_WINDOW_MS, hitRateLimit, pruneRateLimits, rateBucket } from './rate-limit'
import { adminDbAsD1 } from './test-d1'

describe('limite de pedidos da página da cliente', () => {
  it('deixa passar até ao limite e recusa a seguir, com Retry-After', async () => {
    const { db, close } = bootAdminDb()
    try {
      const d1 = adminDbAsD1(db)
      const clock = createControllableClock(1_800_000_000_000)
      const bucket = await rateBucket('exchange:ip', '203.0.113.9')
      const results = []
      for (let i = 0; i < 4; i++) results.push(await hitRateLimit(d1, clock, { bucket, limit: 3 }))
      expect(results.map((r) => r.allowed)).toEqual([true, true, true, false])
      expect(results[3]!.retryAfterSec).toBeGreaterThan(0)
      expect(results[3]!.retryAfterSec).toBeLessThanOrEqual(CLIENT_WEB_RATE_WINDOW_MS / 1000)
    } finally {
      close()
    }
  })

  it('a janela seguinte recomeça e os buckets são independentes', async () => {
    const { db, close } = bootAdminDb()
    try {
      const d1 = adminDbAsD1(db)
      const clock = createControllableClock(1_800_000_000_000)
      const a = await rateBucket('exchange:ip', '203.0.113.9')
      const b = await rateBucket('exchange:ip', '203.0.113.10')
      await hitRateLimit(d1, clock, { bucket: a, limit: 1 })
      expect((await hitRateLimit(d1, clock, { bucket: a, limit: 1 })).allowed).toBe(false)
      expect((await hitRateLimit(d1, clock, { bucket: b, limit: 1 })).allowed).toBe(true)
      clock.advance(CLIENT_WEB_RATE_WINDOW_MS)
      expect((await hitRateLimit(d1, clock, { bucket: a, limit: 1 })).allowed).toBe(true)
    } finally {
      close()
    }
  })

  it('não guarda o IP em claro e a limpeza apaga janelas antigas', async () => {
    const { db, close } = bootAdminDb()
    try {
      const d1 = adminDbAsD1(db)
      const clock = createControllableClock(1_800_000_000_000)
      await hitRateLimit(d1, clock, { bucket: await rateBucket('exchange:ip', '203.0.113.9'), limit: 5 })
      expect(JSON.stringify(db.all('SELECT * FROM client_web_rate_limits'))).not.toContain('203.0.113.9')
      clock.advance(2 * 24 * 60 * 60 * 1000)
      await pruneRateLimits(d1, clock)
      expect(db.all('SELECT * FROM client_web_rate_limits')).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('se o D1 falhar, deixa passar', async () => {
    const broken = { prepare: () => { throw new Error('d1 em baixo') } } as unknown as D1Database
    const clock = createControllableClock(1_800_000_000_000)
    expect((await hitRateLimit(broken, clock, { bucket: 'x', limit: 1 })).allowed).toBe(true)
  })
})
