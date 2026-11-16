import { describe, expect, it } from 'vitest'
import { bootAdminDb } from '../db/test-db'
import { asyncFromSync } from '../db/admin/async-store'
import { computeConversationMetrics } from './compute'
import {
  insertFalseConfirmation,
  listConversationQualityEpisodes,
  listFalseConfirmationIds,
  upsertConversationQualityEpisode,
} from './store'
import type { ConversationQualityEpisodeRow } from './types'

const episode = (over: Partial<ConversationQualityEpisodeRow> = {}): ConversationQualityEpisodeRow => ({
  sessionId: 'bss_test',
  tenantId: 'clinic-a',
  conversationId: 'cnv1',
  openedAt: 1000,
  closedAt: 2000,
  lastMessageAt: 1800,
  outcome: 'agendado',
  dropStep: null,
  maxStep: 'confirm',
  inboundTurns: 6,
  inboundTurnsToConfirm: 6,
  confirmedAppointmentId: 'apt1',
  bookingIntent: true,
  misunderstandingTurns: 1,
  attendantSpontaneous: 0,
  attendantOfferedRule: 0,
  attendantRecognized: 0,
  attendantRegistered: 0,
  attendantLastStep: null,
  handoffUnattended: false,
  falseConfirmation: false,
  aiAppointmentFulfillment: 'pending',
  expiresAt: 9_000_000,
  ...over,
})

describe('conversation quality D1 store', () => {
  it('upsert + list + compute integrado', async () => {
    const { db, close } = bootAdminDb({ seed: false })
    try {
      const asyncDb = asyncFromSync(db)
      await upsertConversationQualityEpisode(asyncDb, episode())
      const rows = await listConversationQualityEpisodes(asyncDb, {
        sinceMs: 0,
        toMs: 5000,
        tenantId: 'clinic-a',
      })
      expect(rows).toHaveLength(1)
      await insertFalseConfirmation(asyncDb, {
        tenantId: 'clinic-a',
        conversationId: 'cnv1',
        sessionId: 'bss_test',
        messageId: 'msg1',
        signal: 'team_will_confirm',
        nowMs: 1500,
      })
      const falseIds = await listFalseConfirmationIds(asyncDb, {
        sinceMs: 0,
        toMs: 5000,
        tenantId: 'clinic-a',
      })
      const report = computeConversationMetrics(
        rows,
        falseIds,
        { tenantId: 'clinic-a', fromMs: 0, toMs: 5000 },
        4000,
      )
      expect(report.bookingRate.confirmed).toBe(1)
      expect(report.falseConfirmations.count).toBe(1)
    } finally {
      close()
    }
  })
})