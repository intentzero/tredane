import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { bootAdminDb } from '../db/test-db'
import { purgeExpiredClientWebRows } from './cleanup'
import { exchangeClientWebLink, issueClientWebLink, getClientWebSession } from './links'
import { hitRateLimit, rateBucket } from './rate-limit'
import { adminDbAsD1 } from './test-d1'

const LINK = { tenantId: 'clinic-a', bindingId: 'b', contactId: 'ctc-1', conversationId: 'cnv-1', purpose: 'home' as const }
const DAY = 24 * 60 * 60 * 1000

describe('limpeza diária do D1 da página da cliente', () => {
  it('apaga o que expirou há tempo e mantém o recente e o que ainda vale', async () => {
    const { db, close } = bootAdminDb()
    try {
      const d1 = adminDbAsD1(db)
      const clock = createControllableClock(1_800_000_000_000)
      const old = await issueClientWebLink(d1, clock, { ...LINK, conversationId: 'cnv-old' })
      await exchangeClientWebLink(d1, clock, old.token)
      await hitRateLimit(d1, clock, { bucket: await rateBucket('exchange:ip', '203.0.113.9'), limit: 5 })

      clock.advance(10 * DAY)
      const fresh = await issueClientWebLink(d1, clock, { ...LINK, conversationId: 'cnv-new' })
      const session = await exchangeClientWebLink(d1, clock, fresh.token)
      await hitRateLimit(d1, clock, { bucket: await rateBucket('exchange:ip', '203.0.113.10'), limit: 5 })

      expect(await purgeExpiredClientWebRows(d1, clock)).toEqual({ ok: true })
      const count = (t: string) => (db.get(`SELECT COUNT(*) AS n FROM ${t}`) as { n: number }).n
      expect(count('client_web_links')).toBe(1)
      expect(count('client_web_sessions')).toBe(1)
      expect(count('client_web_rate_limits')).toBe(1)
      // O que ainda vale continua a valer.
      expect(await getClientWebSession(d1, clock, session!.sessionToken)).not.toBeNull()
    } finally {
      close()
    }
  })

  it('não apaga um link expirado há menos de 7 dias e falhar não lança', async () => {
    const { db, close } = bootAdminDb()
    try {
      const d1 = adminDbAsD1(db)
      const clock = createControllableClock(1_800_000_000_000)
      await issueClientWebLink(d1, clock, LINK)
      clock.advance(3 * DAY)
      await purgeExpiredClientWebRows(d1, clock)
      expect((db.get('SELECT COUNT(*) AS n FROM client_web_links') as { n: number }).n).toBe(1)
      const broken = { prepare: () => { throw new Error('d1 em baixo') } } as unknown as D1Database
      expect(await purgeExpiredClientWebRows(broken, clock)).toEqual({ ok: false })
    } finally {
      close()
    }
  })
})
