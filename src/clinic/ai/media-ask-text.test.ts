/**
 * CF-26 / DEC-119 / DEC-130 — áudio/imagem pedem texto; comprovativo à equipe.
 * Dados fictícios.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { bootClinicDb } from '../test-db'
import { workerCaller } from '../envelopes'
import { bindOrAssertTenant } from '../tenant'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import {
  createPendingAttachmentOp,
  linkAttachmentToMessageOp,
  markAttachmentReadyOp,
} from '../attachments'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './autodraft'
import { buildAiContextPayload } from './context'
import { HUMAN_HANDOFF_TEXT, readAiReplyPause } from './human-handoff'
import {
  MEDIA_ASK_TEXT,
  decideMediaOnlyTurn,
  isMediaOnlyMessage,
  looksLikePaymentProofText,
  redactMediaPlaceholderForAiContext,
} from './media-ask-text'
import { SimulatedAiAdapter } from '../../ai'

function seed() {
  const clock = createControllableClock(Date.UTC(2026, 10, 5, 13, 0))
  const boot = bootClinicDb({ clock })
  const tenantId = 'clinic-demo-media-cf26'
  const caller = workerCaller(tenantId, 'user_media_owner')
  bindOrAssertTenant(boot.db, caller, clock)
  syncWhatsappChannel(
    boot.db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_media_cf26',
      phoneNumberId: 'pn_media_cf26',
      wabaId: 'waba_media_cf26',
      displayPhone: '+5511900004426',
      displayName: 'Clínica Mídia',
      action: 'channel_connected',
    },
    clock,
  )
  setClinicAiAssistEnabled(boot.db, tenantId, true, clock)
  const contact = upsertContact(
    boot.db,
    { tenantId, waId: '5511900004426', displayName: 'Carla Mídia' },
    clock,
  )
  const cnv = createConversation(
    boot.db,
    { tenantId, contactId: contact.id, status: 'open' },
    clock,
  )
  return { ...boot, clock, caller, tenantId, contactId: contact.id, conversationId: cnv.id }
}

function attach(
  s: ReturnType<typeof seed>,
  messageId: string,
  contentType: string,
) {
  const pending = createPendingAttachmentOp(
    s.db,
    s.caller,
    {
      contentType,
      source: 'synthetic',
      conversationId: s.conversationId,
      messageId,
    },
    s.clock,
  )
  markAttachmentReadyOp(
    s.db,
    s.caller,
    { attachmentId: pending.id, byteSize: 64, contentType },
    s.clock,
  )
  linkAttachmentToMessageOp(
    s.db,
    s.caller,
    { attachmentId: pending.id, conversationId: s.conversationId, messageId },
    s.clock,
  )
}

describe('media-ask-text (CF-26 / DEC-119 / DEC-130)', () => {
  it('deteção por anexo, não pelo marcador sozinho', () => {
    const s = seed()
    try {
      const bare = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: '[Áudio]',
          deliveryState: 'received',
        },
        s.clock,
      )
      expect(isMediaOnlyMessage(s.db, s.tenantId, bare.id, '[Áudio]')).toBe(false)

      const withAtt = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: '[Imagem]',
          deliveryState: 'received',
        },
        s.clock,
      )
      attach(s, withAtt.id, 'image/jpeg')
      expect(isMediaOnlyMessage(s.db, s.tenantId, withAtt.id, '[Imagem]')).toBe(true)

      const captioned = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: 'quero limpeza amanhã',
          deliveryState: 'received',
        },
        s.clock,
      )
      attach(s, captioned.id, 'image/jpeg')
      expect(isMediaOnlyMessage(s.db, s.tenantId, captioned.id, 'quero limpeza amanhã')).toBe(
        false,
      )
    } finally {
      s.close()
    }
  })

  it('áudio sem texto → frase DEC-130 + botão; IA activa', async () => {
    const s = seed()
    try {
      const msg = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: '[Áudio]',
          deliveryState: 'received',
        },
        s.clock,
      )
      attach(s, msg.id, 'audio/ogg')
      enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.conversationId, messageId: msg.id },
        s.clock,
      )
      s.clock.advance(7_000)
      const out = await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
      expect(out).toHaveLength(1)
      expect(out[0]!.reason).toBe('media_ask_text')
      const bodies = s.db
        .all<{ body: string }>(
          `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound'`,
          s.conversationId,
        )
        .map((r) => r.body)
      expect(bodies).toEqual([MEDIA_ASK_TEXT])
      expect(readAiReplyPause(s.db, s.tenantId, s.conversationId)).toBeNull()
      const flagged = s.db.get<{ at: number | null }>(
        `SELECT media_ask_text_at AS at FROM conversations WHERE id = ?`,
        s.conversationId,
      )
      expect(flagged?.at).toBeTruthy()
      const outbound = s.db.get<{ interactive_json: string | null }>(
        `SELECT o.interactive_json AS interactive_json
         FROM outbound_messages o
         JOIN messages m ON m.id = o.message_id
         WHERE m.conversation_id = ? AND m.direction = 'outbound'
         ORDER BY m.created_at DESC LIMIT 1`,
        s.conversationId,
      )
      expect(outbound?.interactive_json).toContain('Falar com a equipe')
      expect(outbound?.interactive_json).toContain('handoff:human')
      const decided = s.db.get<{ payload_json: string }>(
        `SELECT payload_json FROM outbox_events
         WHERE tenant_id = ? AND type = 'ai.turn_decided'
         ORDER BY occurred_at DESC, rowid DESC LIMIT 1`,
        s.tenantId,
      )
      expect(decided?.payload_json).toContain('"route":"media_ask_text"')
    } finally {
      s.close()
    }
  })

  it('segunda mídia após o pedido → handoff DEC-083, sem laço', async () => {
    const s = seed()
    try {
      const first = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: '[Áudio]',
          deliveryState: 'received',
        },
        s.clock,
      )
      attach(s, first.id, 'audio/ogg')
      enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.conversationId, messageId: first.id },
        s.clock,
      )
      s.clock.advance(7_000)
      await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })

      const second = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: '[Imagem]',
          deliveryState: 'received',
        },
        s.clock,
      )
      attach(s, second.id, 'image/jpeg')
      enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.conversationId, messageId: second.id },
        s.clock,
      )
      s.clock.advance(7_000)
      await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })

      const bodies = s.db
        .all<{ body: string }>(
          `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound' ORDER BY created_at`,
          s.conversationId,
        )
        .map((r) => r.body)
      expect(bodies[0]).toBe(MEDIA_ASK_TEXT)
      expect(bodies.some((b) => b.startsWith(HUMAN_HANDOFF_TEXT))).toBe(true)
      expect(bodies.filter((b) => b === MEDIA_ASK_TEXT)).toHaveLength(1)
      const pause = readAiReplyPause(s.db, s.tenantId, s.conversationId)
      expect(pause).not.toBeNull()
      expect(pause?.reason).toBe('media_after_ask')
    } finally {
      s.close()
    }
  })

  it('#475 S4 opção B: texto de verdade limpa «já pedi»; mídia seguinte volta a pedir', async () => {
    const s = seed()
    try {
      const first = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: '[Áudio]',
          deliveryState: 'received',
        },
        s.clock,
      )
      attach(s, first.id, 'audio/ogg')
      enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.conversationId, messageId: first.id },
        s.clock,
      )
      s.clock.advance(7_000)
      await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
      expect(
        s.db.get<{ at: number | null }>(
          `SELECT media_ask_text_at AS at FROM conversations WHERE id = ?`,
          s.conversationId,
        )?.at,
      ).toBeTruthy()

      const text = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: 'quero limpeza de pele amanhã',
          deliveryState: 'received',
        },
        s.clock,
      )
      enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.conversationId, messageId: text.id },
        s.clock,
      )
      expect(
        s.db.get<{ at: number | null }>(
          `SELECT media_ask_text_at AS at FROM conversations WHERE id = ?`,
          s.conversationId,
        )?.at,
      ).toBeNull()
      s.clock.advance(7_000)
      await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })

      const third = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: '[Imagem]',
          deliveryState: 'received',
        },
        s.clock,
      )
      attach(s, third.id, 'image/jpeg')
      enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.conversationId, messageId: third.id },
        s.clock,
      )
      s.clock.advance(7_000)
      const out = await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
      expect(out[0]?.reason).toBe('media_ask_text')
      expect(readAiReplyPause(s.db, s.tenantId, s.conversationId)).toBeNull()
      const asks = s.db
        .all<{ body: string }>(
          `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound' AND body = ?`,
          s.conversationId,
          MEDIA_ASK_TEXT,
        )
        .length
      expect(asks).toBe(2)
    } finally {
      s.close()
    }
  })

  it('#475 S3: troca a redação da frase e a 2.ª mídia ainda vai à equipe', async () => {
    const s = seed()
    try {
      const first = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: '[Áudio]',
          deliveryState: 'received',
        },
        s.clock,
      )
      attach(s, first.id, 'audio/ogg')
      enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.conversationId, messageId: first.id },
        s.clock,
      )
      s.clock.advance(7_000)
      await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })

      // Simula DEC futura: o corpo outbound deixa de coincidir com MEDIA_ASK_TEXT.
      s.db.run(
        `UPDATE messages SET body = ?
         WHERE conversation_id = ? AND direction = 'outbound' AND body = ?`,
        'Frase antiga que já não é a constante',
        s.conversationId,
        MEDIA_ASK_TEXT,
      )

      const second = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: '[Imagem]',
          deliveryState: 'received',
        },
        s.clock,
      )
      attach(s, second.id, 'image/jpeg')
      enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.conversationId, messageId: second.id },
        s.clock,
      )
      s.clock.advance(7_000)
      await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })

      const bodies = s.db
        .all<{ body: string }>(
          `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound' ORDER BY created_at`,
          s.conversationId,
        )
        .map((r) => r.body)
      expect(bodies.some((b) => b === MEDIA_ASK_TEXT)).toBe(false)
      expect(bodies.some((b) => b.startsWith(HUMAN_HANDOFF_TEXT))).toBe(true)
      expect(readAiReplyPause(s.db, s.tenantId, s.conversationId)?.reason).toBe('media_after_ask')
    } finally {
      s.close()
    }
  })

  it('Pix pendente + imagem → handoff, sem pedir texto', () => {
    const s = seed()
    try {
      const now = s.clock.nowMs()
      s.db.run(
        `INSERT INTO pix_charges (id, tenant_id, account_id, provider, external_reference, amount_cents,
           status, expires_at, contact_id, created_at, updated_at)
         VALUES ('chg_m', ?, 'acc_m', 'fake', 'ext_m', 5000, 'awaiting_payment', ?, ?, ?, ?)`,
        s.tenantId,
        now + 3_600_000,
        s.contactId,
        now,
        now,
      )
      const msg = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: '[Imagem]',
          deliveryState: 'received',
        },
        s.clock,
      )
      attach(s, msg.id, 'image/jpeg')
      const d = decideMediaOnlyTurn(
        s.db,
        s.tenantId,
        {
          conversationId: s.conversationId,
          contactId: s.contactId,
          messageId: msg.id,
          body: '[Imagem]',
        },
        s.clock,
      )
      expect(d).toEqual({ action: 'handoff', reason: 'payment_proof' })
    } finally {
      s.close()
    }
  })

  it('Pix pendente + imagem no autodraft → alerta payment_proof (não off_purpose)', async () => {
    const s = seed()
    try {
      const now = s.clock.nowMs()
      s.db.run(
        `INSERT INTO pix_charges (id, tenant_id, account_id, provider, external_reference, amount_cents,
           status, expires_at, contact_id, created_at, updated_at)
         VALUES ('chg_m2', ?, 'acc_m2', 'fake', 'ext_m2', 5000, 'awaiting_payment', ?, ?, ?, ?)`,
        s.tenantId,
        now + 3_600_000,
        s.contactId,
        now,
        now,
      )
      const msg = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: '[Imagem]',
          deliveryState: 'received',
        },
        s.clock,
      )
      attach(s, msg.id, 'image/jpeg')
      enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.conversationId, messageId: msg.id },
        s.clock,
      )
      s.clock.advance(7_000)
      await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
      expect(readAiReplyPause(s.db, s.tenantId, s.conversationId)?.reason).toBe('payment_proof')
      const pending = s.db.get<{ detail_text: string }>(
        `SELECT detail_text FROM pending_communications
         WHERE tenant_id = ? AND conversation_id = ? AND kind = 'alter_awaiting_team'`,
        s.tenantId,
        s.conversationId,
      )
      expect(pending?.detail_text).toMatch(/comprovativo de pagamento/i)
      expect(pending?.detail_text).not.toMatch(/agendamento/i)
    } finally {
      s.close()
    }
  })

  it('texto de pagamento na mensagem anterior → handoff', () => {
    const s = seed()
    try {
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: 'Segue o comprovante do Pix',
          deliveryState: 'received',
        },
        s.clock,
      )
      s.clock.advance(1_000)
      const img = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: '[Imagem]',
          deliveryState: 'received',
        },
        s.clock,
      )
      attach(s, img.id, 'image/png')
      expect(
        decideMediaOnlyTurn(
          s.db,
          s.tenantId,
          {
            conversationId: s.conversationId,
            contactId: s.contactId,
            messageId: img.id,
            body: '[Imagem]',
          },
          s.clock,
        ),
      ).toEqual({ action: 'handoff', reason: 'payment_proof' })
      expect(looksLikePaymentProofText('já paguei o sinal')).toBe(true)
    } finally {
      s.close()
    }
  })

  it('marcador não entra no corpo enviado ao gateway', async () => {
    const s = seed()
    try {
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: '[Áudio]',
          deliveryState: 'received',
        },
        s.clock,
      )
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: 'quero limpeza de pele',
          deliveryState: 'received',
        },
        s.clock,
      )
      const built = await buildAiContextPayload(s.db, s.tenantId, s.conversationId, {
        clock: s.clock,
      })
      const json = JSON.stringify(built.payload.messages)
      expect(json).not.toContain('[Áudio]')
      expect(json).toContain('quero limpeza de pele')
      expect(redactMediaPlaceholderForAiContext('[Imagem]')).toBeNull()
      expect(redactMediaPlaceholderForAiContext('legenda real')).toBe('legenda real')
    } finally {
      s.close()
    }
  })

  it('idempotência: mesmo clientRequestId não duplica a frase', async () => {
    const s = seed()
    try {
      const msg = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: '[Áudio]',
          deliveryState: 'received',
          externalMessageId: 'wamid.media.cf26.1',
        },
        s.clock,
      )
      attach(s, msg.id, 'audio/ogg')
      for (let i = 0; i < 2; i++) {
        enqueueAutoDraft(
          s.db,
          s.tenantId,
          { conversationId: s.conversationId, messageId: msg.id },
          s.clock,
        )
        s.clock.advance(7_000)
        await runDueAutoDrafts(s.db, s.caller, s.clock, {
          mode: 'synthetic',
          adapter: new SimulatedAiAdapter(),
        })
      }
      const n = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM messages
         WHERE conversation_id = ? AND direction = 'outbound' AND body = ?`,
        s.conversationId,
        MEDIA_ASK_TEXT,
      )!.n
      expect(n).toBe(1)
    } finally {
      s.close()
    }
  })
})
