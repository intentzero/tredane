import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { setClinicAiAssistEnabled } from '../config/settings'
import { ingestContactMessage, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { enqueueAutoDraft } from '../ai/autodraft'
import { saveScheduleSession } from '../ai/schedule-session'
import {
  assignConversationOp,
  closeConversationOp,
  getConversationDetailOp,
  listConversationsOp,
  sendOutboundMessageOp,
} from './operations'
import { seedSyntheticInboxOp } from './seed'
import { seedSyntheticWhatsappTemplates } from './templates'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { serializeConversation } from '../../inbox/serialize'

describe('Clinic inbox — conversas e histórico (#29)', () => {
  it('mesmo waId em clínicas A e B gera contactos/conversas independentes', () => {
    const a = bootClinicDb()
    const b = bootClinicDb()
    try {
      const callerA = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      const callerB = workerCaller('clinic-demo-b', 'user_synth_owner_b')
      const waId = '5511999994242'

      const ra = ingestContactMessage(
        a.db,
        callerA,
        {
          providerEventKey: 'wa:a:1',
          waId,
          displayName: 'Marina A',
          body: 'olá A',
        },
        a.clock,
      )
      const rb = ingestContactMessage(
        b.db,
        callerB,
        {
          providerEventKey: 'wa:b:1',
          waId,
          displayName: 'Marina B',
          body: 'olá B',
        },
        b.clock,
      )

      expect(ra.conversation).toBeTruthy()
      expect(rb.conversation).toBeTruthy()
      expect(ra.contact!.id).not.toBe(rb.contact!.id)
      expect(ra.conversation!.id).not.toBe(rb.conversation!.id)

      const listA = listConversationsOp(a.db, callerA, { filter: 'all' }, a.clock)
      const listB = listConversationsOp(b.db, callerB, { filter: 'all' }, b.clock)
      expect(listA.items).toHaveLength(1)
      expect(listB.items).toHaveLength(1)
      expect(listA.items[0]!.contact.displayName).toBe('Marina A')
      expect(listB.items[0]!.contact.displayName).toBe('Marina B')

      expect(() =>
        getConversationDetailOp(
          a.db,
          callerA,
          { conversationId: rb.conversation!.id },
          a.clock,
        ),
      ).toThrow()
    } finally {
      a.close()
      b.close()
    }
  })

  it('reentrega do mesmo providerEventKey não duplica mensagem nem reordena', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      const first = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:dup:1',
          waId: '5511987001999',
          displayName: 'Teste',
          body: 'primeira',
        },
        clock,
      )
      expect(first.duplicate).toBe(false)
      expect(first.message).toBeTruthy()

      const again = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:dup:1',
          waId: '5511987001999',
          body: 'primeira outra vez',
        },
        clock,
      )
      expect(again.duplicate).toBe(true)

      const detail = getConversationDetailOp(
        db,
        caller,
        { conversationId: first.conversation!.id },
        clock,
      )
      expect(detail.messages.filter((m) => m.direction === 'inbound')).toHaveLength(1)
      expect(detail.messages[0]!.body).toBe('primeira')
    } finally {
      close()
    }
  })

  it('atribuição concorrente converge para responsável persistido (last-write-wins)', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:assign:1',
          waId: '5511987001888',
          displayName: 'Carla',
          body: 'preciso de horário',
        },
        clock,
      )
      const cnvId = ingested.conversation!.id

      const r1 = assignConversationOp(
        db,
        caller,
        {
          conversationId: cnvId,
          assigneeClerkUserId: 'user_synth_attendant_a',
          assigneeDisplayName: 'Ana',
          actorClerkUserId: 'user_synth_attendant_a',
          actorDisplayName: 'Ana',
          expectedAssignmentVersion: 0,
        },
        clock,
      )
      expect(r1.value.versionMatched).toBe(true)

      const r2 = assignConversationOp(
        db,
        caller,
        {
          conversationId: cnvId,
          assigneeClerkUserId: 'user_synth_owner_a',
          assigneeDisplayName: 'Bruno',
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Bruno',
          expectedAssignmentVersion: 0,
        },
        clock,
      )
      expect(r2.value.versionMatched).toBe(false)
      expect(r2.value.conversation.assigneeClerkUserId).toBe('user_synth_owner_a')
      expect(r2.value.conversation.assignmentVersion).toBe(2)

      const detail = getConversationDetailOp(db, caller, { conversationId: cnvId }, clock)
      expect(detail.assigneeClerkUserId).toBe('user_synth_owner_a')
      expect(detail.messages.some((m) => m.direction === 'system')).toBe(true)
      // Estado permanece open — atribuição separada do status
      expect(detail.status).toBe('open')
    } finally {
      close()
    }
  })

  it('o detalhe devolve o procedimento, dia e período já definidos na conversa', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      seedSyntheticInboxOp(db, caller, clock)
      const listed = listConversationsOp(db, caller, { filter: 'all', limit: 5 }, clock)
      const id = listed.items[0]!.id
      expect(getConversationDetailOp(db, caller, { conversationId: id }, clock).scheduleHint).toBeNull()

      saveScheduleSession(
        db,
        'clinic-demo-a',
        id,
        { serviceId: 'svc_laser', dayLabel: 'sexta', period: 'tarde' },
        clock,
      )
      expect(getConversationDetailOp(db, caller, { conversationId: id }, clock).scheduleHint).toEqual({
        serviceId: 'svc_laser',
        dayLabel: 'sexta',
        period: 'tarde',
      })
    } finally {
      close()
    }
  })

  it('conversa atribuída a outro continua visível no filtro all (DEC-015)', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      seedSyntheticInboxOp(db, caller, clock)
      const listed = listConversationsOp(
        db,
        caller,
        { filter: 'all', viewerClerkUserId: 'user_synth_attendant_a' },
        clock,
      )
      expect(listed.items.length).toBeGreaterThanOrEqual(3)
      const others = listed.items.filter(
        (c) =>
          c.assigneeClerkUserId &&
          c.assigneeClerkUserId !== 'user_synth_attendant_a',
      )
      expect(others.length).toBeGreaterThan(0)

      const mine = listConversationsOp(
        db,
        caller,
        { filter: 'mine', viewerClerkUserId: 'user_synth_attendant_a' },
        clock,
      )
      expect(
        mine.items.every((c) => c.assigneeClerkUserId === 'user_synth_attendant_a'),
      ).toBe(true)
    } finally {
      close()
    }
  })

  it('paginação de mensagens preserva ordem cronológica sem duplicar', () => {
    const clock = createControllableClock(1_700_000_000_000)
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-a', 'user_a')
      const first = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:page:0',
          waId: '5511987001777',
          body: 'msg 0',
        },
        clock,
      )
      const cnvId = first.conversation!.id
      for (let i = 1; i <= 5; i++) {
        clock.advance(1000)
        ingestContactMessage(
          db,
          caller,
          {
            providerEventKey: `wa:page:${i}`,
            waId: '5511987001777',
            body: `msg ${i}`,
          },
          clock,
        )
      }

      const page = getConversationDetailOp(
        db,
        caller,
        { conversationId: cnvId, messageLimit: 3 },
        clock,
      )
      expect(page.messages).toHaveLength(3)
      expect(page.messagesHasMore).toBe(true)
      expect(page.messages.map((m) => m.body)).toEqual(['msg 3', 'msg 4', 'msg 5'])

      const older = getConversationDetailOp(
        db,
        caller,
        {
          conversationId: cnvId,
          messageLimit: 10,
          before: page.messagesNextBefore,
        },
        clock,
      )
      const ids = new Set([...page.messages, ...older.messages].map((m) => m.id))
      expect(ids.size).toBe(page.messages.length + older.messages.length)
    } finally {
      close()
    }
  })

  it('envio outbound é idempotente por clientRequestId (pending + outbox)', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      syncWhatsappChannel(
        db,
        'clinic-demo-a',
        {
          status: 'connected',
          bindingId: 'b1',
          phoneNumberId: 'pn1',
          wabaId: 'w1',
          displayPhone: '+1555',
          action: 'channel_connected',
        },
        clock,
      )
      seedSyntheticWhatsappTemplates(db, 'clinic-demo-a', clock)
      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:out:1',
          waId: '5511987001666',
          body: 'oi',
        },
        clock,
      )
      const r1 = sendOutboundMessageOp(
        db,
        caller,
        {
          conversationId: ingested.conversation!.id,
          body: 'Resposta sintética',
          clientRequestId: 'client-req-1',
          authorClerkUserId: 'user_synth_attendant_a',
          authorDisplayName: 'Ana',
        },
        clock,
      )
      expect(r1.value.duplicate).toBe(false)
      expect(r1.value.message.deliveryState).toBe('pending')
      // message.created + whatsapp.send + etapa automática (DEC-062: novo_contato → em_atendimento).
      expect(r1.outbox.map((e) => e.type)).toEqual([
        'message.created',
        'whatsapp.send',
        'opportunity.stage_changed',
      ])
      const r2 = sendOutboundMessageOp(
        db,
        caller,
        {
          conversationId: ingested.conversation!.id,
          body: 'Resposta sintética',
          clientRequestId: 'client-req-1',
          authorClerkUserId: 'user_synth_attendant_a',
          authorDisplayName: 'Ana',
        },
        clock,
      )
      expect(r2.value.duplicate).toBe(true)
      expect(r2.value.message.id).toBe(r1.value.message.id)
    } finally {
      close()
    }
  })

  it('nova mensagem reabre conversa encerrada sem apagar histórico (hipótese)', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      const first = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:reopen:1',
          waId: '5511987001555',
          body: 'antes',
        },
        clock,
      )
      assignConversationOp(
        db,
        caller,
        {
          conversationId: first.conversation!.id,
          assigneeClerkUserId: 'user_synth_attendant_a',
          assigneeDisplayName: 'Ana',
          actorClerkUserId: 'user_synth_attendant_a',
          actorDisplayName: 'Ana',
        },
        clock,
      )
      closeConversationOp(
        db,
        caller,
        {
          conversationId: first.conversation!.id,
          actorClerkUserId: 'user_synth_attendant_a',
          actorDisplayName: 'Ana',
        },
        clock,
      )

      const again = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:reopen:2',
          waId: '5511987001555',
          body: 'voltei',
        },
        clock,
      )
      expect(again.conversation!.id).toBe(first.conversation!.id)
      expect(again.conversation!.status).toBe('open')
      const detail = getConversationDetailOp(
        db,
        caller,
        { conversationId: first.conversation!.id },
        clock,
      )
      expect(detail.messages.some((m) => m.body === 'antes')).toBe(true)
      expect(detail.messages.some((m) => m.body === 'voltei')).toBe(true)
    } finally {
      close()
    }
  })

  it('lista marca aiDrafting enquanto há job de rascunho automático', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      setClinicAiAssistEnabled(db, caller.tenantId, true, clock)
      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:aidraft:1',
          waId: '5511987001999',
          displayName: 'Paulo',
          body: 'Quero agendar uma depilação?',
        },
        clock,
      )
      const conversationId = ingested.conversation!.id
      const messageId = ingested.message!.id

      let listed = listConversationsOp(db, caller, { filter: 'all' }, clock)
      expect(listed.items.find((c) => c.id === conversationId)?.aiDrafting).toBe(false)

      expect(
        enqueueAutoDraft(db, caller.tenantId, { conversationId, messageId }, clock),
      ).not.toBeNull()

      listed = listConversationsOp(db, caller, { filter: 'all' }, clock)
      const row = listed.items.find((c) => c.id === conversationId)
      expect(row?.aiDrafting).toBe(true)
      expect(serializeConversation(row!).aiDrafting).toBe(true)
    } finally {
      close()
    }
  })
})
