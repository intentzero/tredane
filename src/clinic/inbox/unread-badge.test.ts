/**
 * DEC-160 — chips Todas/Novas/Minhas/Sem responsável, badge do ícone e
 * círculo da linha contam só dual-unread (humano não leu ∧ última inbound).
 * Outbound da IA zera `unread_count` (proxy de «lido/atendido» pela IA).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { upsertContact } from '../contacts'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { workerCaller } from '../index'
import {
  countInboxFilters,
  countUnreadConversations,
  createConversation,
  touchConversationMessage,
} from './conversations'
import { insertMessage } from './messages'
import { markConversationReadOp, sendOutboundMessageOp } from './operations'

const NOW = Date.UTC(2026, 10, 11, 14, 0)
const TENANT = 'clinic-demo-a'

function boot() {
  const clock = createControllableClock(NOW)
  const { db, close } = bootClinicDb({ clock })
  syncWhatsappChannel(
    db,
    TENANT,
    {
      status: 'connected',
      bindingId: 'bind_unread_badge',
      phoneNumberId: 'pn_unread_badge',
      wabaId: 'waba_unread_badge',
      displayPhone: '+5511900000099',
      displayName: 'Clínica Badge',
      action: 'channel_connected',
    },
    clock,
  )
  return { db, clock, close }
}

function seedInbound(
  db: ReturnType<typeof bootClinicDb>['db'],
  clock: ReturnType<typeof createControllableClock>,
  waId: string,
  name: string,
  body: string,
) {
  const contact = upsertContact(db, { tenantId: TENANT, waId, displayName: name }, clock)
  const cnv = createConversation(db, { tenantId: TENANT, contactId: contact.id, status: 'new' }, clock)
  insertMessage(
    db,
    {
      tenantId: TENANT,
      conversationId: cnv.id,
      direction: 'inbound',
      body,
      deliveryState: 'received',
      createdAt: clock.nowMs(),
    },
    clock,
  )
  touchConversationMessage(db, {
    tenantId: TENANT,
    conversationId: cnv.id,
    preview: body,
    direction: 'inbound',
    at: clock.nowMs(),
    bumpUnread: true,
    reopenIfClosed: false,
  })
  return cnv
}

describe('DEC-160 dual-unread filter badges', () => {
  it('Todas / unread contam inbound não lido; outbound da IA tira do badge', () => {
    const { db, clock, close } = boot()
    try {
      const gislaine = seedInbound(db, clock, '5511900000001', 'Gislaine Santos', 'oi')
      const paulo = seedInbound(db, clock, '5511900000002', 'Paulo', 'quero horários')

      let counts = countInboxFilters(db, TENANT, 'user_synth_owner_a')
      expect(counts.all).toBe(2)
      expect(counts.new).toBe(2)
      expect(counts.unread).toBe(2)
      expect(countUnreadConversations(db, TENANT)).toBe(2)

      // IA responde a Gislaine — zera unread e tira do chip / círculo.
      sendOutboundMessageOp(
        db,
        workerCaller(TENANT, 'system:ai-autodraft'),
        {
          conversationId: gislaine.id,
          body: 'Tudo bem! Fico por aqui quando você decidir.',
          clientRequestId: 'ai-gislaine-1',
          authorClerkUserId: 'system:ai-autodraft',
          authorDisplayName: 'Assistente IA',
        },
        clock,
      )
      const gRow = db.get<{ unread_count: number; last_message_direction: string }>(
        `SELECT unread_count, last_message_direction FROM conversations WHERE id = ?`,
        gislaine.id,
      )
      expect(gRow?.unread_count).toBe(0)
      expect(gRow?.last_message_direction).toBe('outbound')

      counts = countInboxFilters(db, TENANT, 'user_synth_owner_a')
      expect(counts.all).toBe(1)
      expect(counts.new).toBe(1)
      expect(counts.unread).toBe(1)

      // IA responde a Paulo — badge Todas / unread → 0 (como no ecrã com 2 fios IA).
      sendOutboundMessageOp(
        db,
        workerCaller(TENANT, 'system:ai-autodraft'),
        {
          conversationId: paulo.id,
          body: 'Ainda está aí? Quer prosseguir com o atendimento?',
          clientRequestId: 'ai-paulo-1',
          authorClerkUserId: 'system:ai-autodraft',
          authorDisplayName: 'Assistente IA',
        },
        clock,
      )
      counts = countInboxFilters(db, TENANT, 'user_synth_owner_a')
      expect(counts.all).toBe(0)
      expect(counts.new).toBe(0)
      expect(counts.unread).toBe(0)
      // Círculo da linha também some: unread_count zerado ao atender.
      const pRow = db.get<{ unread_count: number; last_message_direction: string }>(
        `SELECT unread_count, last_message_direction FROM conversations WHERE id = ?`,
        paulo.id,
      )
      expect(pRow?.unread_count).toBe(0)
      expect(pRow?.last_message_direction).toBe('outbound')
    } finally {
      close()
    }
  })

  it('outbound da IA zera unread; próximo inbound conta só a mensagem nova', () => {
    const { db, clock, close } = boot()
    try {
      const cnv = seedInbound(db, clock, '5511900000009', 'Paulo', 'quero massagem')
      insertMessage(
        db,
        {
          tenantId: TENANT,
          conversationId: cnv.id,
          direction: 'inbound',
          body: 'amanhã de manhã',
          deliveryState: 'received',
          createdAt: clock.nowMs(),
        },
        clock,
      )
      touchConversationMessage(db, {
        tenantId: TENANT,
        conversationId: cnv.id,
        preview: 'amanhã de manhã',
        direction: 'inbound',
        at: clock.nowMs(),
        bumpUnread: true,
        reopenIfClosed: false,
      })
      expect(
        db.get<{ unread_count: number }>(
          `SELECT unread_count FROM conversations WHERE id = ?`,
          cnv.id,
        )?.unread_count,
      ).toBe(2)

      sendOutboundMessageOp(
        db,
        workerCaller(TENANT, 'system:ai-autodraft'),
        {
          conversationId: cnv.id,
          body: 'Para massagem, qual horário prefere?',
          clientRequestId: 'ai-paulo-massagem-1',
          authorClerkUserId: 'system:ai-autodraft',
          authorDisplayName: 'IA',
        },
        clock,
      )
      expect(
        db.get<{ unread_count: number; last_message_direction: string }>(
          `SELECT unread_count, last_message_direction FROM conversations WHERE id = ?`,
          cnv.id,
        ),
      ).toEqual({ unread_count: 0, last_message_direction: 'outbound' })

      insertMessage(
        db,
        {
          tenantId: TENANT,
          conversationId: cnv.id,
          direction: 'inbound',
          body: 'às 10',
          deliveryState: 'received',
          createdAt: clock.nowMs(),
        },
        clock,
      )
      touchConversationMessage(db, {
        tenantId: TENANT,
        conversationId: cnv.id,
        preview: 'às 10',
        direction: 'inbound',
        at: clock.nowMs(),
        bumpUnread: true,
        reopenIfClosed: false,
      })
      expect(
        db.get<{ unread_count: number }>(
          `SELECT unread_count FROM conversations WHERE id = ?`,
          cnv.id,
        )?.unread_count,
      ).toBe(1)
      expect(countInboxFilters(db, TENANT, undefined).unread).toBe(1)
    } finally {
      close()
    }
  })

  it('marcar lido pelo humano tira do badge mesmo com última inbound', () => {
    const { db, clock, close } = boot()
    try {
      const cnv = seedInbound(db, clock, '5511900000003', 'Lia', 'preciso de ajuda')
      expect(countInboxFilters(db, TENANT, undefined).all).toBe(1)

      markConversationReadOp(
        db,
        workerCaller(TENANT, 'user_synth_owner_a'),
        {
          conversationId: cnv.id,
          readerClerkUserId: 'user_synth_owner_a',
          readerDisplayName: 'Owner',
        },
        clock,
      )
      const counts = countInboxFilters(db, TENANT, 'user_synth_owner_a')
      expect(counts.all).toBe(0)
      expect(counts.unread).toBe(0)
      expect(
        db.get<{ unread_count: number }>(
          `SELECT unread_count FROM conversations WHERE id = ?`,
          cnv.id,
        )?.unread_count,
      ).toBe(0)
    } finally {
      close()
    }
  })

  it('após IA zerar unread_count, mark_read humano ainda grava read_at e whatsapp.mark_read', () => {
    const { db, clock, close } = boot()
    try {
      const contact = upsertContact(
        db,
        { tenantId: TENANT, waId: '5511900000006', displayName: 'Rita' },
        clock,
      )
      const cnv = createConversation(
        db,
        { tenantId: TENANT, contactId: contact.id, status: 'new' },
        clock,
      )
      insertMessage(
        db,
        {
          tenantId: TENANT,
          conversationId: cnv.id,
          direction: 'inbound',
          body: 'tem horário?',
          deliveryState: 'received',
          externalMessageId: 'wa:msg:wamid.rita_1',
          createdAt: clock.nowMs(),
        },
        clock,
      )
      touchConversationMessage(db, {
        tenantId: TENANT,
        conversationId: cnv.id,
        preview: 'tem horário?',
        direction: 'inbound',
        at: clock.nowMs(),
        bumpUnread: true,
        reopenIfClosed: false,
      })
      sendOutboundMessageOp(
        db,
        workerCaller(TENANT, 'system:ai-autodraft'),
        {
          conversationId: cnv.id,
          body: 'Sim, posso ajudar.',
          clientRequestId: 'ai-rita-1',
          authorClerkUserId: 'system:ai-autodraft',
          authorDisplayName: 'Assistente IA',
        },
        clock,
      )
      expect(
        db.get<{ unread_count: number }>(
          `SELECT unread_count FROM conversations WHERE id = ?`,
          cnv.id,
        )?.unread_count,
      ).toBe(0)
      expect(
        db.get<{ read_at: number | null }>(
          `SELECT read_at FROM messages WHERE external_message_id = ?`,
          'wa:msg:wamid.rita_1',
        )?.read_at,
      ).toBeNull()

      const r = markConversationReadOp(
        db,
        workerCaller(TENANT, 'user_synth_owner_a'),
        {
          conversationId: cnv.id,
          readerClerkUserId: 'user_synth_owner_a',
          readerDisplayName: 'Owner',
        },
        clock,
      )
      const row = db.get<{ read_by_display_name: string; read_at: number }>(
        `SELECT read_by_display_name, read_at FROM messages WHERE external_message_id = ?`,
        'wa:msg:wamid.rita_1',
      )!
      expect(row.read_by_display_name).toBe('Owner')
      expect(row.read_at).toBeGreaterThan(0)
      const mark = r.outbox.find((o) => o.type === 'whatsapp.mark_read')
      expect(mark).toBeTruthy()
      expect(JSON.parse(mark!.payloadJson)).toMatchObject({
        providerMessageId: 'wamid.rita_1',
      })
    } finally {
      close()
    }
  })

  it('Minhas / Sem responsável só contam dual-unread no critério do filtro', () => {
    const { db, clock, close } = boot()
    try {
      const mine = seedInbound(db, clock, '5511900000004', 'Minha', 'oi')
      const free = seedInbound(db, clock, '5511900000005', 'Livre', 'olá')
      db.run(
        `UPDATE conversations SET assignee_clerk_user_id = ?, assignee_display_name = ?, status = 'open'
         WHERE id = ?`,
        'user_eu',
        'Eu',
        mine.id,
      )

      const counts = countInboxFilters(db, TENANT, 'user_eu')
      expect(counts.mine).toBe(1)
      expect(counts.unassigned).toBe(1)
      expect(counts.all).toBe(2)

      sendOutboundMessageOp(
        db,
        workerCaller(TENANT, 'system:ai-autodraft'),
        {
          conversationId: free.id,
          body: 'Posso ajudar?',
          clientRequestId: 'ai-free-1',
          authorClerkUserId: 'system:ai-autodraft',
          authorDisplayName: 'Assistente IA',
        },
        clock,
      )
      const after = countInboxFilters(db, TENANT, 'user_eu')
      expect(after.mine).toBe(1)
      expect(after.unassigned).toBe(0)
      expect(after.all).toBe(1)
    } finally {
      close()
    }
  })
})
