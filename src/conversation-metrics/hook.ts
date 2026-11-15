/**
 * Integração com Clinic DO: sink opcional D1 + persistência após sessão.
 */
import type { AsyncAdminDb } from '../db/admin/async-store'
import type { Clock } from '../db/clock'
import type { BookingSessionRow } from '../clinic/ai/booking-session'
import type { ClinicDb } from '../clinic/store'
import { buildConversationQualityEpisode } from './episode-snapshot'
import { upsertConversationQualityEpisode } from './store'

let centralDb: AsyncAdminDb | null = null

export function setConversationQualityCentralDb(db: AsyncAdminDb | null): void {
  centralDb = db
}

export function getConversationQualityCentralDb(): AsyncAdminDb | null {
  return centralDb
}

export function onBookingSessionEndedForQuality(
  db: ClinicDb,
  session: BookingSessionRow | null,
  clock: Clock,
): void {
  if (!session) return
  const row = buildConversationQualityEpisode(db, session, clock)
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'conversation_quality.episode',
      tenantId: row.tenantId,
      sessionId: row.sessionId,
      outcome: row.outcome,
      inboundTurns: row.inboundTurns,
    }),
  )
  if (!centralDb) return
  void upsertConversationQualityEpisode(centralDb, row)
}