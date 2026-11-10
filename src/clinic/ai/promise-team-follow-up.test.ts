/**
 * TR-487 — alerta sem pausa quando a copy promete retorno da equipe.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { createConversation, listConversations } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { readAiReplyPause } from './human-handoff'
import {
  promiseTeamFollowUp,
  textPromisesTeamFollowUp,
} from './promise-team-follow-up'

const NOW = Date.UTC(2026, 10, 10, 15, 0)

describe('textPromisesTeamFollowUp', () => {
  it('casa promessas de retorno; ignora lacuna DEC-090', () => {
    expect(
      textPromisesTeamFollowUp(
        'Ainda não está marcado: a equipe confirma o horário e já te retorna.',
      ),
    ).toBe(true)
    expect(
      textPromisesTeamFollowUp(
        'Ainda não está marcado: a equipe vai te responder em seguida.',
      ),
    ).toBe(true)
    expect(
      textPromisesTeamFollowUp(
        'Não consegui fechar Massagem às 15:00 agora. A equipe confirma em seguida.',
      ),
    ).toBe(true)
    expect(textPromisesTeamFollowUp('A equipe confirma.')).toBe(true)
    expect(textPromisesTeamFollowUp('A equipe confirma o valor.')).toBe(false)
    expect(textPromisesTeamFollowUp('A equipe confirma quem atende.')).toBe(false)
    expect(
      textPromisesTeamFollowUp('Horário de funcionamento: a equipe confirma.'),
    ).toBe(false)
    expect(textPromisesTeamFollowUp('Se preferir, chamo a equipe.')).toBe(false)
  })
})

describe('promiseTeamFollowUp', () => {
  it('abre Precisa de alguém sem pausar a IA; idempotente', () => {
    const clock = createControllableClock(NOW)
    const { db, close } = bootClinicDb({ clock })
    try {
      const tenantId = 'clinic-demo-a'
      setClinicAiAssistEnabled(db, tenantId, true, clock)
      syncWhatsappChannel(
        db,
        tenantId,
        {
          status: 'connected',
          bindingId: 'bind_tr487',
          phoneNumberId: 'pn_tr487',
          wabaId: 'waba_tr487',
          displayPhone: '+5511900000487',
          displayName: 'Clínica TR487',
          action: 'channel_connected',
        },
        clock,
      )
      const contact = upsertContact(
        db,
        { tenantId, waId: '5511900000488', displayName: 'Ana' },
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
          body: 'sim',
          deliveryState: 'received',
          createdAt: NOW - 1_000,
        },
        clock,
      )

      const first = promiseTeamFollowUp(
        db,
        tenantId,
        {
          conversationId: cnv.id,
          detailText: 'Capacidade pausada: teste TR-487.',
        },
        clock,
      )
      expect(first).toEqual({ opened: true, already: false, paused: false })
      expect(readAiReplyPause(db, tenantId, cnv.id)).toBeNull()
      expect(
        listConversations(db, tenantId, { filter: 'needs_person' }).items.some(
          (c) => c.id === cnv.id && c.needsPerson,
        ),
      ).toBe(true)

      clock.advance(1_000)
      const second = promiseTeamFollowUp(
        db,
        tenantId,
        {
          conversationId: cnv.id,
          detailText: 'Segundo aviso.',
          messageId: 'msg_2',
        },
        clock,
      )
      expect(second).toEqual({ opened: false, already: true, paused: false })
      const pending = db.all<{ n: number }>(
        `SELECT COUNT(*) AS n FROM pending_communications
         WHERE tenant_id = ? AND conversation_id = ? AND kind = 'alter_awaiting_team' AND status != 'resolved'`,
        tenantId,
        cnv.id,
      )
      expect(pending[0]?.n).toBe(1)
    } finally {
      close()
    }
  })
})
