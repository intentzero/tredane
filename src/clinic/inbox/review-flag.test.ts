/**
 * DEC-157 — fila de revisão: flag, filtro, idempotência, comando WhatsApp.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { upsertContact } from '../contacts'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { workerCaller } from '../index'
import {
  clearConversationReviewFlagOp,
  flagConversationForReviewOp,
  getReviewConversationDetailOp,
  listConversationsOp,
} from './operations'
import { createConversation, listConversations } from './conversations'
import { insertMessage } from './messages'
import {
  flagConversationForReview,
  isReviewFlagRequest,
  REVIEW_FLAG_CLIENT_ACK,
} from './review-flag'

const NOW = Date.UTC(2026, 10, 10, 18, 0)

function seedConversation() {
  const clock = createControllableClock(NOW)
  const { db, close } = bootClinicDb({ clock })
  const tenantId = 'clinic-demo-a'
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_review',
      phoneNumberId: 'pn_review',
      wabaId: 'waba_review',
      displayPhone: '+5511900000099',
      displayName: 'Clínica Review',
      action: 'channel_connected',
    },
    clock,
  )
  const contact = upsertContact(
    db,
    { tenantId, waId: '5511900000099', displayName: 'Ana Fictícia' },
    clock,
  )
  const cnv = createConversation(
    db,
    { tenantId, contactId: contact.id, status: 'open' },
    clock,
  )
  insertMessage(
    db,
    {
      tenantId,
      conversationId: cnv.id,
      direction: 'inbound',
      body: 'quero marcar',
      deliveryState: 'received',
      createdAt: NOW - 5_000,
    },
    clock,
  )
  return { db, close, clock, tenantId, cnv }
}

describe('DEC-157 review flag', () => {
  it('reconhece comandos avaliar / feedback', () => {
    expect(isReviewFlagRequest('avaliar')).toBe(true)
    expect(isReviewFlagRequest('Feedback')).toBe(true)
    expect(isReviewFlagRequest('quero avaliar')).toBe(true)
    expect(isReviewFlagRequest('avaliar o atendimento')).toBe(true)
    expect(isReviewFlagRequest('quero agendar depilação')).toBe(false)
    expect(isReviewFlagRequest('')).toBe(false)
    expect(REVIEW_FLAG_CLIENT_ACK).toMatch(/revisar/i)
  })

  it('marca, filtra Para revisão, limpa; idempotente', () => {
    const { db, close, clock, tenantId, cnv } = seedConversation()
    try {
      const first = flagConversationForReview(
        db,
        tenantId,
        cnv.id,
        { source: 'client', reason: 'client_request' },
        clock,
      )
      expect(first.changed).toBe(true)
      expect(first.outbox.some((o) => o.type === 'conversation.review_flagged')).toBe(true)

      const listed = listConversations(db, tenantId, { filter: 'for_review' })
      expect(listed.items).toHaveLength(1)
      expect(listed.items[0]!.forReview).toBe(true)
      expect(listed.items[0]!.reviewFlaggedSource).toBe('client')

      const second = flagConversationForReview(
        db,
        tenantId,
        cnv.id,
        { source: 'auto', reason: 'nao_encontrei' },
        clock,
      )
      expect(second.changed).toBe(false)
      expect(listed.items[0]!.reviewFlaggedSource).toBe('client')

      const caller = workerCaller(tenantId, 'user_synth_owner_a')
      const cleared = clearConversationReviewFlagOp(
        db,
        caller,
        { conversationId: cnv.id },
        clock,
      )
      expect(cleared.value.forReview).toBe(false)
      expect(
        listConversations(db, tenantId, { filter: 'for_review' }).items,
      ).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('API estável: detail só se flagged; contagem forReview', () => {
    const { db, close, clock, tenantId, cnv } = seedConversation()
    try {
      const caller = workerCaller(tenantId, 'user_synth_owner_a')
      expect(() =>
        getReviewConversationDetailOp(
          db,
          caller,
          { conversationId: cnv.id },
          clock,
        ),
      ).toThrow(/revisão/i)

      flagConversationForReviewOp(
        db,
        caller,
        { conversationId: cnv.id },
        clock,
      )
      const detail = getReviewConversationDetailOp(
        db,
        caller,
        { conversationId: cnv.id },
        clock,
      )
      expect(detail.forReview).toBe(true)
      expect(detail.messages.length).toBeGreaterThan(0)

      const listed = listConversationsOp(
        db,
        caller,
        { filter: 'for_review', viewerClerkUserId: caller.actorId },
        clock,
      )
      expect(listed.counts.forReview).toBe(1)
      expect(listed.items[0]!.id).toBe(cnv.id)
    } finally {
      close()
    }
  })

  it('auto nao_encontrei não pausa — só flag + outbox WS', () => {
    const { db, close, clock, tenantId, cnv } = seedConversation()
    try {
      const flagged = flagConversationForReview(
        db,
        tenantId,
        cnv.id,
        { source: 'auto', reason: 'nao_encontrei' },
        clock,
      )
      expect(flagged.outbox.some((o) => o.type === 'conversation.review_flagged')).toBe(true)
      const pause = db.get<{ at: number | null }>(
        `SELECT ai_reply_paused_at AS at FROM conversations WHERE tenant_id = ? AND id = ?`,
        tenantId,
        cnv.id,
      )
      expect(pause?.at).toBeNull()
      const item = listConversations(db, tenantId, { filter: 'for_review' }).items[0]!
      expect(item.reviewFlaggedSource).toBe('auto')
      expect(item.reviewFlagReason).toBe('nao_encontrei')
    } finally {
      close()
    }
  })
})

