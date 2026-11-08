import { describe, expect, it } from 'vitest'
import { AI_AUTODRAFT_DEBOUNCE_MS } from '../../ai/budgets'
import { insertMessage } from '../inbox/messages'
import { WHATSAPP_TYPING_INDICATOR_TYPE } from './typing-indicator'
import { enqueueAutoDraft, getAutoDraftJob } from './autodraft'
import { bootDialogScenario } from './evals/dialogs/scenario'
import {
  AI_AUTODRAFT_DEBOUNCE_COMPLETE_MS,
  AI_AUTODRAFT_DEBOUNCE_HUB_MS,
  AI_AUTODRAFT_DEBOUNCE_INTERACTIVE_MS,
  AI_AUTODRAFT_DEBOUNCE_PENDING_MS,
  autodraftDebounceMs,
  looksLikeCompleteBookingRequest,
  looksLikeShortPendingAnswer,
} from './debounce'

describe('debounce DEC-111', () => {
  it('botão/lista → 0 s', () => {
    expect(autodraftDebounceMs({ text: 'Confirmar', fromInteractive: true })).toBe(
      AI_AUTODRAFT_DEBOUNCE_INTERACTIVE_MS,
    )
  })

  it('pedido completo → 2–3 s', () => {
    expect(looksLikeCompleteBookingRequest('Quero limpeza de pele amanhã às 15h')).toBe(true)
    expect(autodraftDebounceMs({ text: 'Quero limpeza de pele amanhã às 15h' })).toBe(
      AI_AUTODRAFT_DEBOUNCE_COMPLETE_MS,
    )
  })

  it('texto aberto → 7 s', () => {
    expect(looksLikeCompleteBookingRequest('Oi, tudo bem?')).toBe(false)
    expect(autodraftDebounceMs({ text: 'Oi, tudo bem?' })).toBe(AI_AUTODRAFT_DEBOUNCE_MS)
  })

  it('abertura do hub (opção C) → 300 ms, não 7 s', () => {
    expect(AI_AUTODRAFT_DEBOUNCE_HUB_MS).toBe(300)
    expect(AI_AUTODRAFT_DEBOUNCE_HUB_MS).toBeLessThanOrEqual(500)
    expect(autodraftDebounceMs({ text: 'Oi', hubOpening: true })).toBe(AI_AUTODRAFT_DEBOUNCE_HUB_MS)
    expect(autodraftDebounceMs({ text: 'Boa noite', hubOpening: true })).toBe(
      AI_AUTODRAFT_DEBOUNCE_HUB_MS,
    )
    // Pedido vago sem dia/hora («quero marcar») → hub 300 ms.
    expect(autodraftDebounceMs({ text: 'quero marcar', hubOpening: true })).toBe(
      AI_AUTODRAFT_DEBOUNCE_HUB_MS,
    )
    // Sem flag hub → continua texto aberto (7 s).
    expect(autodraftDebounceMs({ text: 'Oi' })).toBe(AI_AUTODRAFT_DEBOUNCE_MS)
  })

  it('dia+período com «horário» (VAGUE_BOOK) → 2,5 s, não 300 ms (F1 #560)', () => {
    const text = 'Amanhã na parte da tarde, tem algum horário?'
    expect(looksLikeCompleteBookingRequest(text)).toBe(true)
    // Mesmo com hubOpening (detector casa «horário»), o tier complete vence.
    expect(autodraftDebounceMs({ text, hubOpening: true })).toBe(AI_AUTODRAFT_DEBOUNCE_COMPLETE_MS)
  })

  it('pending aberto + resposta curta → 300 ms (Paulo P2 07/11)', () => {
    expect(AI_AUTODRAFT_DEBOUNCE_PENDING_MS).toBe(300)
    expect(looksLikeShortPendingAnswer('Axila')).toBe(true)
    expect(looksLikeShortPendingAnswer('14h')).toBe(true)
    expect(looksLikeShortPendingAnswer('sim')).toBe(true)
    expect(autodraftDebounceMs({ text: 'Axila', pendingSlot: 'variantes' })).toBe(
      AI_AUTODRAFT_DEBOUNCE_PENDING_MS,
    )
    // «14h» seria complete (2,5 s); com pending horario vence o tier curto.
    expect(looksLikeCompleteBookingRequest('14h')).toBe(true)
    expect(autodraftDebounceMs({ text: '14h', pendingSlot: 'horario' })).toBe(
      AI_AUTODRAFT_DEBOUNCE_PENDING_MS,
    )
    // Texto longo com pending → não força 300 ms.
    const long = 'quero axila e pernas e buço por favor amanhã'
    expect(looksLikeShortPendingAnswer(long)).toBe(false)
    expect(autodraftDebounceMs({ text: long, pendingSlot: 'variantes' })).not.toBe(
      AI_AUTODRAFT_DEBOUNCE_PENDING_MS,
    )
  })
})

describe('enqueueAutoDraft debounce hub opção C', () => {
  it('cumprimento → dueAt +300 ms e typing já na fila (antes da espera)', () => {
    const s = bootDialogScenario()
    try {
      s.clock.advance(1_000)
      const now = s.clock.nowMs()
      const msg = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: 'Oi',
          externalMessageId: 'wa:msg:wamid.HUB_GREET_EARLY',
          deliveryState: 'received',
          createdAt: now,
        },
        s.clock,
      )
      const job = enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.conversationId, messageId: msg.id },
        s.clock,
      )
      expect(job).not.toBeNull()
      expect(job!.dueAt - job!.createdAt).toBe(AI_AUTODRAFT_DEBOUNCE_HUB_MS)
      expect(job!.dueAt - now).toBe(AI_AUTODRAFT_DEBOUNCE_HUB_MS)

      const typing = s.db.get<{ type: string; payload_json: string }>(
        `SELECT type, payload_json FROM outbox_events
         WHERE tenant_id = ? AND type = ? ORDER BY occurred_at DESC LIMIT 1`,
        s.tenantId,
        WHATSAPP_TYPING_INDICATOR_TYPE,
      )
      expect(typing).not.toBeNull()
      expect(JSON.parse(typing!.payload_json)).toMatchObject({
        providerMessageId: 'wamid.HUB_GREET_EARLY',
        messageId: msg.id,
      })

      // Ainda não due: 299 ms < 300.
      s.clock.advance(AI_AUTODRAFT_DEBOUNCE_HUB_MS - 1)
      expect(getAutoDraftJob(s.db, s.tenantId, s.conversationId)?.dueAt).toBeGreaterThan(
        s.clock.nowMs(),
      )
      s.clock.advance(1)
      expect(getAutoDraftJob(s.db, s.tenantId, s.conversationId)?.dueAt).toBeLessThanOrEqual(
        s.clock.nowMs(),
      )
    } finally {
      s.close()
    }
  })

  it('texto longo com serviço nomeado → ainda 7 s e sem typing precoce', () => {
    const s = bootDialogScenario()
    try {
      // Sinónimo «depilar» → shouldOfferHubOpening = false (caminho directo, não hub).
      const dep = s.db.get<{ id: string }>(
        `SELECT id FROM services WHERE tenant_id = ? AND name = ?`,
        s.tenantId,
        'Depilação',
      )
      expect(dep).toBeTruthy()
      s.db.run(
        `UPDATE services SET synonyms_json = ? WHERE tenant_id = ? AND id = ?`,
        JSON.stringify(['depilar']),
        s.tenantId,
        dep!.id,
      )

      s.clock.advance(1_000)
      const now = s.clock.nowMs()
      const msg = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: 'quero depilar axila e pernas',
          externalMessageId: 'wa:msg:wamid.LONG_FREE_TEXT',
          deliveryState: 'received',
          createdAt: now,
        },
        s.clock,
      )
      const job = enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.conversationId, messageId: msg.id },
        s.clock,
      )
      expect(job).not.toBeNull()
      expect(job!.dueAt - job!.createdAt).toBe(AI_AUTODRAFT_DEBOUNCE_MS)

      const typing = s.db.get<{ id: string }>(
        `SELECT id FROM outbox_events
         WHERE tenant_id = ? AND type = ? AND idempotency_key = ?`,
        s.tenantId,
        WHATSAPP_TYPING_INDICATOR_TYPE,
        'whatsapp.typing_indicator:wamid.LONG_FREE_TEXT',
      )
      expect(typing).toBeUndefined()
    } finally {
      s.close()
    }
  })
})
