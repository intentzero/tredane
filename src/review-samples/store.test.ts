import { describe, expect, it } from 'vitest'
import { bootAdminDb } from '../db/test-db'
import { REVIEW_SAMPLE_TTL_MS } from './constants'
import {
  getReviewSampleSync,
  listReviewSamplesSync,
  purgeExpiredReviewSamplesSync,
  upsertReviewSampleSync,
} from './store'
import type { ReviewSampleSnapshot } from './types'

function snap(
  overrides: Partial<ReviewSampleSnapshot> & Pick<
    ReviewSampleSnapshot,
    'tenantId' | 'conversationId'
  >,
): ReviewSampleSnapshot {
  return {
    tenantName: 'Clínica Demo',
    contactId: 'ct_1',
    contactWaId: '5511999990001',
    contactDisplayName: 'Ana Exemplo',
    flagSource: 'auto',
    flagReason: 'nao_encontrei',
    flaggedAt: 1_700_000_000_000,
    lastMessageAt: 1_700_000_000_100,
    lastMessagePreview: 'Não encontrei cotovelo',
    messages: [
      {
        messageId: 'msg_1',
        direction: 'inbound',
        body: 'quero cotovelo',
        createdAt: 1_700_000_000_050,
        deliveryState: 'delivered',
        authorClerkUserId: null,
        authorDisplayName: null,
      },
      {
        messageId: 'msg_2',
        direction: 'outbound',
        body: 'Não encontrei cotovelo nas opções.',
        createdAt: 1_700_000_000_100,
        deliveryState: 'sent',
        authorClerkUserId: null,
        authorDisplayName: null,
      },
    ],
    ...overrides,
  }
}

describe('review-samples D1 store (DEC-159)', () => {
  it('upsert, lista cross-tenant, detail e purge TTL', () => {
    const boot = bootAdminDb({ seed: false })
    try {
      const now = 1_700_000_100_000
      const a = upsertReviewSampleSync(
        boot.db,
        snap({ tenantId: 'ten_a', conversationId: 'cnv_a1' }),
        now,
      )
      const b = upsertReviewSampleSync(
        boot.db,
        snap({
          tenantId: 'ten_b',
          conversationId: 'cnv_b1',
          flagSource: 'client',
          flagReason: 'client_request',
          flaggedAt: now - 1000,
        }),
        now,
      )
      expect(a.created).toBe(true)
      expect(b.created).toBe(true)

      const listed = listReviewSamplesSync(boot.db, { nowMs: now, limit: 10 })
      expect(listed.items).toHaveLength(2)
      expect(listed.items.map((i) => i.tenantId).sort()).toEqual(['ten_a', 'ten_b'])

      const onlyA = listReviewSamplesSync(boot.db, {
        nowMs: now,
        tenantId: 'ten_a',
      })
      expect(onlyA.items).toHaveLength(1)
      expect(onlyA.items[0]!.id).toBe(a.sampleId)

      const detail = getReviewSampleSync(boot.db, a.sampleId, now)
      expect(detail?.messages).toHaveLength(2)
      expect(detail?.messages[0]!.body).toBe('quero cotovelo')
      expect(detail?.expiresAt).toBe(now + REVIEW_SAMPLE_TTL_MS)

      // Re-flag upsert substitui mensagens.
      upsertReviewSampleSync(
        boot.db,
        snap({
          tenantId: 'ten_a',
          conversationId: 'cnv_a1',
          messages: [
            {
              messageId: 'msg_3',
              direction: 'inbound',
              body: 'avaliar',
              createdAt: now,
              deliveryState: null,
              authorClerkUserId: null,
              authorDisplayName: null,
            },
          ],
        }),
        now + 1,
      )
      const again = getReviewSampleSync(boot.db, a.sampleId, now + 1)
      expect(again?.messages).toHaveLength(1)
      expect(again?.messages[0]!.body).toBe('avaliar')

      const purged = purgeExpiredReviewSamplesSync(
        boot.db,
        now + REVIEW_SAMPLE_TTL_MS + 1,
      )
      expect(purged.deleted).toBeGreaterThanOrEqual(2)
      expect(listReviewSamplesSync(boot.db, { nowMs: now + REVIEW_SAMPLE_TTL_MS + 1 }).items).toEqual(
        [],
      )
    } finally {
      boot.close()
    }
  })
})
