import { describe, expect, it } from 'vitest'
import { bootAdminDb } from '../db/test-db'
import {
  deleteReviewSamplesForTenantSync,
  getReviewSampleSync,
  upsertReviewSampleSync,
} from './store'

describe('review samples — tenant purge (DEC-159 / REQ-071)', () => {
  it('deleteReviewSamplesForTenantSync remove amostras do tenant', () => {
    const boot = bootAdminDb({ seed: false })
    try {
      const now = 1_700_000_300_000
      const a = upsertReviewSampleSync(
        boot.db,
        {
          tenantId: 'ten_purge',
          tenantName: 'X',
          conversationId: 'cnv_1',
          contactId: null,
          contactWaId: '5511999990001',
          contactDisplayName: 'Ana',
          flagSource: 'auto',
          flagReason: 'nao_encontrei',
          clientComment: null,
          flaggedAt: now,
          lastMessageAt: now,
          lastMessagePreview: 'x',
          messages: [
            {
              messageId: 'm1',
              direction: 'inbound',
              body: 'secret',
              createdAt: now,
              deliveryState: null,
              authorClerkUserId: null,
              authorDisplayName: null,
            },
          ],
        },
        now,
      )
      upsertReviewSampleSync(
        boot.db,
        {
          tenantId: 'ten_keep',
          tenantName: 'Y',
          conversationId: 'cnv_2',
          contactId: null,
          contactWaId: null,
          contactDisplayName: null,
          flagSource: 'client',
          flagReason: 'client_request',
          clientComment: null,
          flaggedAt: now,
          lastMessageAt: now,
          lastMessagePreview: 'y',
          messages: [],
        },
        now,
      )
      deleteReviewSamplesForTenantSync(boot.db, 'ten_purge')
      expect(getReviewSampleSync(boot.db, a.sampleId, now)).toBeNull()
      const kept = boot.db.get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM review_samples WHERE tenant_id = ?`,
        'ten_keep',
      )
      expect(kept?.c).toBe(1)
    } finally {
      boot.close()
    }
  })
})
