/**
 * DEC-157 — fila de revisão: flag, filtro, idempotência, comando WhatsApp.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { workerCaller } from '../index'
import { enqueueAutoDraft, runDueAutoDrafts } from '../ai'
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
  parseReviewFlagAckButtonId,
  parseReviewFlagRequest,
  readReviewFlag,
  REVIEW_FLAG_ACK_BUTTONS,
  REVIEW_FLAG_CLIENT_ACK,
  reviewFlagAckButtonId,
  reviewFlagAckInteractiveButtons,
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
  it('reconhece comandos avaliar / feedback (case, pontuação, prefixos)', () => {
    expect(isReviewFlagRequest('avaliar')).toBe(true)
    expect(isReviewFlagRequest('Avaliar')).toBe(true)
    expect(isReviewFlagRequest('AVALIAR')).toBe(true)
    expect(isReviewFlagRequest('avaliar.')).toBe(true)
    expect(isReviewFlagRequest('  Avaliar!  ')).toBe(true)
    expect(isReviewFlagRequest('Feedback')).toBe(true)
    expect(isReviewFlagRequest('quero avaliar')).toBe(true)
    expect(isReviewFlagRequest('por favor avaliar')).toBe(true)
    expect(isReviewFlagRequest('avaliar o atendimento')).toBe(true)
    expect(isReviewFlagRequest('quero agendar depilação')).toBe(false)
    expect(isReviewFlagRequest('me ajuda a avaliar')).toBe(false)
    expect(isReviewFlagRequest('')).toBe(false)
    expect(REVIEW_FLAG_CLIENT_ACK).toBe(
      'Obrigado. Marquei esta conversa para a equipe revisar.',
    )
    expect(REVIEW_FLAG_ACK_BUTTONS.continue.title).toBe('Continuar')
    expect(REVIEW_FLAG_ACK_BUTTONS.end.title).toBe('Terminar')
    expect(parseReviewFlagAckButtonId(reviewFlagAckButtonId('cnv_1', 'continue'))).toEqual({
      conversationId: 'cnv_1',
      action: 'continue',
    })
    expect(parseReviewFlagAckButtonId(reviewFlagAckButtonId('cnv_1', 'end'))).toEqual({
      conversationId: 'cnv_1',
      action: 'end',
    })
    expect(parseReviewFlagAckButtonId('fu:idle:cnv_1:continue')).toBeNull()
    const buttons = reviewFlagAckInteractiveButtons('cnv_x')
    expect(buttons).toEqual([
      { id: 'fu:review:cnv_x:continue', title: 'Continuar' },
      { id: 'fu:review:cnv_x:end', title: 'Terminar' },
    ])
  })

  it('DEC-166: comentário opcional após avaliar/feedback; rejeita mid-texto', () => {
    expect(parseReviewFlagRequest('avaliar')).toEqual({
      matched: true,
      clientComment: null,
    })
    expect(parseReviewFlagRequest('feedback')).toEqual({
      matched: true,
      clientComment: null,
    })
    expect(
      parseReviewFlagRequest('avaliar eu vi que o horario estava repetido'),
    ).toEqual({
      matched: true,
      clientComment: 'eu vi que o horario estava repetido',
    })
    expect(
      parseReviewFlagRequest(
        'feedback pedi para chamar o atendente e o sistema travou',
      ),
    ).toEqual({
      matched: true,
      clientComment: 'pedi para chamar o atendente e o sistema travou',
    })
    expect(
      parseReviewFlagRequest('Avaliar o horário estava repetido'),
    ).toEqual({
      matched: true,
      clientComment: 'o horário estava repetido',
    })
    expect(parseReviewFlagRequest('quero avaliar o bot')).toEqual({
      matched: true,
      clientComment: null,
    })
    expect(parseReviewFlagRequest('ÁVALIAR')).toEqual({
      matched: true,
      clientComment: null,
    })
    expect(parseReviewFlagRequest('me ajuda a avaliar')).toEqual({
      matched: false,
    })
    expect(parseReviewFlagRequest('quero agendar depilação')).toEqual({
      matched: false,
    })
    expect(parseReviewFlagRequest('avaliaracao')).toEqual({ matched: false })
  })

  it('DEC-166: vírgula, dois-pontos ou travessão após keyword ainda casa + comentário', () => {
    expect(
      parseReviewFlagRequest('avaliar, eu vi que o horario estava repetido'),
    ).toEqual({
      matched: true,
      clientComment: 'eu vi que o horario estava repetido',
    })
    expect(
      parseReviewFlagRequest('avaliar: o bot repetiu o mesmo horário'),
    ).toEqual({
      matched: true,
      clientComment: 'o bot repetiu o mesmo horário',
    })
    expect(
      parseReviewFlagRequest('avaliar - pedi atendente e travou'),
    ).toEqual({
      matched: true,
      clientComment: 'pedi atendente e travou',
    })
    expect(
      parseReviewFlagRequest('feedback: horário errado na proposta'),
    ).toEqual({
      matched: true,
      clientComment: 'horário errado na proposta',
    })
    expect(
      parseReviewFlagRequest('quero avaliar, algo estranho no eco'),
    ).toEqual({
      matched: true,
      clientComment: 'algo estranho no eco',
    })
    expect(
      parseReviewFlagRequest('avaliar o atendimento: demorou a responder'),
    ).toEqual({
      matched: true,
      clientComment: 'demorou a responder',
    })
    expect(parseReviewFlagRequest('avaliar,')).toEqual({
      matched: true,
      clientComment: null,
    })
    expect(parseReviewFlagRequest('avaliar:')).toEqual({
      matched: true,
      clientComment: null,
    })
    expect(isReviewFlagRequest('avaliar, comment')).toBe(true)
    expect(isReviewFlagRequest('avaliar: comment')).toBe(true)
  })

  it('DEC-166/167: 1.º flag guarda comentário; re-flag com texto appenda e emite outbox', () => {
    const { db, close, clock, tenantId, cnv } = seedConversation()
    try {
      const first = flagConversationForReview(
        db,
        tenantId,
        cnv.id,
        {
          source: 'client',
          reason: 'client_request',
          clientComment: 'eu vi que o horario estava repetido',
        },
        clock,
      )
      expect(first.changed).toBe(true)
      expect(readReviewFlag(db, tenantId, cnv.id)?.clientComment).toBe(
        'eu vi que o horario estava repetido',
      )
      expect(readReviewFlag(db, tenantId, cnv.id)?.clientComments).toEqual([
        'eu vi que o horario estava repetido',
      ])
      const payload = JSON.parse(first.outbox[0]!.payloadJson) as {
        clientComment: string | null
        clientComments: string[]
      }
      expect(payload.clientComment).toBe('eu vi que o horario estava repetido')
      expect(payload.clientComments).toEqual([
        'eu vi que o horario estava repetido',
      ])

      const second = flagConversationForReview(
        db,
        tenantId,
        cnv.id,
        {
          source: 'client',
          reason: 'client_request',
          clientComment: 'esta última mensagem deveria oferecer novamente os horários',
        },
        clock,
      )
      expect(second.changed).toBe(true)
      expect(second.outbox.some((o) => o.type === 'conversation.review_flagged')).toBe(
        true,
      )
      const state = readReviewFlag(db, tenantId, cnv.id)
      expect(state?.clientComment).toBe('eu vi que o horario estava repetido')
      expect(state?.clientComments).toEqual([
        'eu vi que o horario estava repetido',
        'esta última mensagem deveria oferecer novamente os horários',
      ])
      expect(state?.source).toBe('client')
      const secondPayload = JSON.parse(second.outbox[0]!.payloadJson) as {
        clientComments: string[]
        commentAppended: boolean
        source: string
      }
      expect(secondPayload.commentAppended).toBe(true)
      expect(secondPayload.clientComments).toEqual(state?.clientComments)
      expect(secondPayload.source).toBe('client')
    } finally {
      close()
    }
  })

  it('DEC-167: re-flag bare (sem comentário) continua no-op; metadados first-flag-wins', () => {
    const { db, close, clock, tenantId, cnv } = seedConversation()
    try {
      flagConversationForReview(
        db,
        tenantId,
        cnv.id,
        {
          source: 'client',
          reason: 'client_request',
          clientComment: 'primeiro',
        },
        clock,
      )
      const bare = flagConversationForReview(
        db,
        tenantId,
        cnv.id,
        { source: 'auto', reason: 'nao_encontrei' },
        clock,
      )
      expect(bare.changed).toBe(false)
      expect(bare.outbox).toHaveLength(0)
      expect(readReviewFlag(db, tenantId, cnv.id)?.source).toBe('client')
      expect(readReviewFlag(db, tenantId, cnv.id)?.clientComments).toEqual([
        'primeiro',
      ])
    } finally {
      close()
    }
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

  it('TR-496: Avaliar com IA pausada (DEC-083) ainda marca + ack', async () => {
    const { db, close, clock, tenantId, cnv } = seedConversation()
    try {
      setClinicAiAssistEnabled(db, tenantId, true, clock)
      // Janela 24h: outbound recente da clínica.
      insertMessage(
        db,
        {
          tenantId,
          conversationId: cnv.id,
          direction: 'outbound',
          body: 'Horários disponíveis…',
          deliveryState: 'accepted',
          createdAt: NOW - 1_000,
        },
        clock,
      )
      db.run(
        `UPDATE conversations SET ai_reply_paused_at = ?, ai_reply_pause_reason = ?, updated_at = ?
         WHERE tenant_id = ? AND id = ?`,
        NOW - 500,
        'customer_requested',
        NOW - 500,
        tenantId,
        cnv.id,
      )
      const inbound = insertMessage(
        db,
        {
          tenantId,
          conversationId: cnv.id,
          direction: 'inbound',
          body: 'Avaliar',
          deliveryState: 'received',
          createdAt: NOW,
        },
        clock,
      )
      const job = enqueueAutoDraft(
        db,
        tenantId,
        { conversationId: cnv.id, messageId: inbound.id },
        clock,
      )
      expect(job).not.toBeNull()
      clock.advance(7_000)
      const caller = workerCaller(tenantId, 'user_synth_owner_a')
      await runDueAutoDrafts(db, caller, clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
      expect(readReviewFlag(db, tenantId, cnv.id)?.source).toBe('client')
      const ack = db.get<{ body: string; interactive_json: string | null }>(
        `SELECT m.body AS body, o.interactive_json AS interactive_json
         FROM messages m
         JOIN outbound_messages o ON o.message_id = m.id
         WHERE m.tenant_id = ? AND m.conversation_id = ?
           AND m.direction = 'outbound'
         ORDER BY m.created_at DESC LIMIT 1`,
        tenantId,
        cnv.id,
      )
      expect(ack?.body).toBe(REVIEW_FLAG_CLIENT_ACK)
      const interactive = JSON.parse(ack?.interactive_json ?? 'null') as {
        buttons?: Array<{ id: string; title: string }>
      }
      expect(interactive.buttons).toEqual(reviewFlagAckInteractiveButtons(cnv.id))
      const stillPaused = db.get<{ at: number | null }>(
        `SELECT ai_reply_paused_at AS at FROM conversations WHERE tenant_id = ? AND id = ?`,
        tenantId,
        cnv.id,
      )
      expect(stillPaused?.at).not.toBeNull()
    } finally {
      close()
    }
  })
})

