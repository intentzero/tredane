/**
 * DEC-083: o que o teste da frase hostil ainda não cobria.
 * Pedido de pessoa, idempotência, responsável humano, catálogo pelo autodraft,
 * botões da proposta e retomada.
 */
import { describe, expect, it } from 'vitest'
import type { AiGenerateResult } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { setConversationAssignee, createConversation, listConversations } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import {
  createProposal,
  getProposal,
  handleProposalButtonClick,
  markProposalSent,
  proposalButtonId,
} from '../proposals'
import { zonedCivilToUtc } from '../scheduling/timezone'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, enqueueLatestUnansweredInbound, runDueAutoDrafts } from './index'
import { HUMAN_HANDOFF_TEXT, notifyHumanHandoff, readAiReplyPause, resumeAiReply } from './human-handoff'
import {
  listOpenPendingCommunicationsForConversation,
  resolvePendingCommunication,
} from '../proposals/pending-communication'

const TZ = 'America/Sao_Paulo'
const NOW = Date.UTC(2026, 9, 28, 18, 51)

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_dec083',
      phoneNumberId: 'pn_dec083',
      wabaId: 'waba_dec083',
      displayPhone: '+5511900000098',
      displayName: 'Clínica DEC-083',
      action: 'channel_connected',
    },
    clock,
  )
  const gi = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi' }, clock)
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 15,
      bufferMinutes: 15,
      priceCents: 5000,
      professionalIds: [gi.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  const split = [1, 2, 3, 4, 5].flatMap((d) => [
    { dayOfWeek: d, startMinute: 9 * 60, endMinute: 12 * 60 },
    { dayOfWeek: d, startMinute: 13 * 60, endMinute: 18 * 60 },
  ])
  setWeeklyWindowsOp(db, caller, { resourceId: gi.id, windows: split }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000078', displayName: 'Paulo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  let t = NOW - 60_000
  const say = (body: string) => {
    const m = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body,
        deliveryState: 'received',
        createdAt: t,
      },
      clock,
    )
    t += 1_000
    return m
  }
  let calls = 0
  const adapter = {
    providerId: 'test',
    mode: 'synthetic' as const,
    async generate(): Promise<AiGenerateResult> {
      calls += 1
      throw new Error('model_called')
    },
    lastInspection() {
      return null
    },
  }
  const outboundCount = () =>
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND direction = 'outbound'`,
      tenantId,
    )!.n
  return {
    db,
    caller,
    tenantId,
    clock,
    gi,
    svc,
    contact,
    cnv,
    say,
    adapter,
    calls: () => calls,
    outboundCount,
    close: boot.close,
  }
}

async function runInbound(s: ReturnType<typeof seed>, body: string) {
  const message = s.say(body)
  enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: message.id }, s.clock)
  s.clock.advance(7_000)
  const out = await runDueAutoDrafts(s.db, s.caller, s.clock, { mode: 'synthetic', adapter: s.adapter })
  expect(out).toHaveLength(1)
  return out[0]!
}

describe('DEC-083', () => {
  it('«quero uma pessoa» pausa, manda uma frase e não marca', async () => {
    const s = seed()
    try {
      const out = await runInbound(s, 'Quero uma pessoa')
      expect(out.reason).toBe('human_handoff')
      expect(out.replyOutbox?.some((row) => row.type === 'whatsapp.send')).toBe(true)
      expect(s.calls()).toBe(0)
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)?.reason).toBe('customer_requested')
      const sent = s.db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
      )
      expect(sent?.body).toBe(HUMAN_HANDOFF_TEXT)
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)!.n).toBe(0)
    } finally {
      s.close()
    }
  })

  it('a segunda pausa não manda outra frase', () => {
    const s = seed()
    try {
      s.say('Oi')
      const first = notifyHumanHandoff(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, reason: 'customer_requested', clientRequestId: 'handoff-1' },
        s.clock,
      )
      expect(first.sent).toBe(true)
      const n = s.outboundCount()
      s.clock.advance(1_000)
      const second = notifyHumanHandoff(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, reason: 'off_purpose', clientRequestId: 'handoff-2' },
        s.clock,
      )
      expect(second).toEqual({ already: true, sent: false, outbox: [] })
      expect(s.outboundCount()).toBe(n)
    } finally {
      s.close()
    }
  })

  it('devolver à IA fecha o alerta; um pedido novo manda a frase outra vez', () => {
    const s = seed()
    try {
      s.say('Oi')
      notifyHumanHandoff(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, reason: 'customer_requested', clientRequestId: 'handoff-once' },
        s.clock,
      )
      const n = s.outboundCount()
      s.clock.advance(1_000)
      const paused = listConversations(s.db, s.tenantId, { filter: 'all' }).items.find(
        (item) => item.id === s.cnv.id,
      )
      expect(paused?.status).toBe('open')
      expect(paused?.assigneeClerkUserId).toBeNull()
      resumeAiReply(s.db, s.tenantId, s.cnv.id, s.clock)
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)).toBeNull()
      const returned = listConversations(s.db, s.tenantId, { filter: 'all' }).items.find(
        (item) => item.id === s.cnv.id,
      )
      expect(returned?.assigneeClerkUserId).toBe('system:ai-autodraft')
      expect(returned?.assigneeDisplayName).toBe('IA')
      expect(returned?.status).toBe('open')
      expect(
        listOpenPendingCommunicationsForConversation(s.db, s.tenantId, s.cnv.id).some(
          (row) => row.kind === 'alter_awaiting_team',
        ),
      ).toBe(false)
      s.clock.advance(1_000)
      const again = notifyHumanHandoff(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, reason: 'off_purpose', clientRequestId: 'handoff-again' },
        s.clock,
      )
      expect(again.sent).toBe(true)
      expect(s.outboundCount()).toBe(n + 1)
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)).not.toBeNull()
      const listed = listConversations(s.db, s.tenantId, { filter: 'needs_person' })
      expect(listed.items.some((item) => item.id === s.cnv.id && item.needsPerson)).toBe(true)
    } finally {
      s.close()
    }
  })

  it('devolver à IA enfileira a mensagem que chegou durante a pausa', () => {
    const s = seed()
    try {
      notifyHumanHandoff(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, reason: 'human_only', clientRequestId: 'handoff-sandra' },
        s.clock,
      )
      s.clock.advance(1_000)
      const pending = s.say('Quero marcar com a Sandra.')
      expect(enqueueLatestUnansweredInbound(s.db, s.tenantId, s.cnv.id, s.clock)).toBeNull()
      s.clock.advance(1_000)
      resumeAiReply(s.db, s.tenantId, s.cnv.id, s.clock)
      const job = enqueueLatestUnansweredInbound(s.db, s.tenantId, s.cnv.id, s.clock)
      expect(job?.messageId).toBe(pending.id)
    } finally {
      s.close()
    }
  })

  it('depois que a equipe assume, um pedido novo manda a frase outra vez', () => {
    const s = seed()
    try {
      s.say('Oi')
      notifyHumanHandoff(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, reason: 'customer_requested', clientRequestId: 'handoff-before-assign' },
        s.clock,
      )
      const n = s.outboundCount()
      s.clock.advance(1_000)
      for (const pending of listOpenPendingCommunicationsForConversation(s.db, s.tenantId, s.cnv.id)) {
        if (pending.kind === 'alter_awaiting_team') {
          resolvePendingCommunication(s.db, s.tenantId, pending.id, s.clock)
        }
      }
      resumeAiReply(s.db, s.tenantId, s.cnv.id, s.clock)
      s.clock.advance(1_000)
      const again = notifyHumanHandoff(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, reason: 'off_purpose', clientRequestId: 'handoff-after-assign' },
        s.clock,
      )
      expect(again.sent).toBe(true)
      expect(s.outboundCount()).toBe(n + 1)
    } finally {
      s.close()
    }
  })

  it('responsável humano permanece na pausa', () => {
    const s = seed()
    try {
      s.say('Oi')
      setConversationAssignee(s.db, {
        tenantId: s.tenantId,
        conversationId: s.cnv.id,
        assigneeClerkUserId: 'user_ana',
        assigneeDisplayName: 'Ana',
        updatedAt: s.clock.nowMs(),
      })
      notifyHumanHandoff(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, reason: 'customer_requested', clientRequestId: 'handoff-ana' },
        s.clock,
      )
      const row = s.db.get<{ assignee: string | null }>(
        `SELECT assignee_clerk_user_id AS assignee FROM conversations WHERE id = ?`,
        s.cnv.id,
      )
      expect(row?.assignee).toBe('user_ana')
    } finally {
      s.close()
    }
  })

  it('horário de funcionamento sai pelo catálogo, com o vão do almoço, sem modelo', async () => {
    const s = seed()
    try {
      const out = await runInbound(s, 'Qual o horário de funcionamento da clínica?')
      expect(out.reason).toBe('catalog_reply')
      expect(out.replyOutbox?.some((row) => row.type === 'whatsapp.send')).toBe(true)
      expect(s.calls()).toBe(0)
      const sent = s.db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
      )
      expect(sent?.body).toContain('09:00–12:00 e 13:00–18:00')
      expect(sent?.body).not.toContain('09:00–18:00')
    } finally {
      s.close()
    }
  })

  it('botão Falar com a equipe devolve a frase e não encaminha a proposta', () => {
    const s = seed()
    try {
      s.say('Oi')
      const startsAt = zonedCivilToUtc(TZ, 2026, 10, 29, 15, 0)
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: s.svc.id,
          professionalId: s.gi.id,
          startsAt,
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
      const click = handleProposalButtonClick(
        s.db,
        {
          tenantId: s.tenantId,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          buttonId: proposalButtonId(proposal.id, proposal.version, 'human'),
          buttonTitle: 'Falar com a equipe',
        },
        s.clock,
      )
      expect(click.handled).toBe(true)
      if (!('action' in click) || click.action !== 'human' || !('outbox' in click)) {
        throw new Error('expected human')
      }
      expect(click.outbox.some((row) => row.type === 'whatsapp.send')).toBe(true)
      expect(click.outbox.some((row) => row.type === 'conversation.ai_pause')).toBe(true)
      expect(getProposal(s.db, s.tenantId, proposal.id)?.state).not.toBe('encaminhada')
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)!.n).toBe(0)
      const sent = s.db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
      )
      expect(sent?.body).toBe(HUMAN_HANDOFF_TEXT)
    } finally {
      s.close()
    }
  })

  it('Alterar detalhes inclui a frase e não cria compromisso', () => {
    const s = seed()
    try {
      s.say('Oi')
      const startsAt = zonedCivilToUtc(TZ, 2026, 10, 29, 15, 0)
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: s.svc.id,
          professionalId: s.gi.id,
          startsAt,
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
      const click = handleProposalButtonClick(
        s.db,
        {
          tenantId: s.tenantId,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          buttonId: proposalButtonId(proposal.id, proposal.version, 'alter'),
          buttonTitle: 'Alterar detalhes',
        },
        s.clock,
      )
      expect(click.handled).toBe(true)
      if (!('action' in click) || click.action !== 'alter' || !('outbox' in click)) {
        throw new Error('expected alter')
      }
      expect(click.outbox.some((row) => row.type === 'whatsapp.send')).toBe(true)
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)!.n).toBe(0)
      const sent = s.db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
      )
      expect(sent?.body).toBe(HUMAN_HANDOFF_TEXT)
    } finally {
      s.close()
    }
  })

  it('Devolver à IA limpa a pausa e avisa o painel', () => {
    const s = seed()
    try {
      s.say('Oi')
      notifyHumanHandoff(
        s.db,
        s.tenantId,
        { conversationId: s.cnv.id, reason: 'off_purpose', clientRequestId: 'handoff-resume' },
        s.clock,
      )
      s.clock.advance(1_000)
      const outbox = resumeAiReply(s.db, s.tenantId, s.cnv.id, s.clock)
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)).toBeNull()
      expect(outbox).toHaveLength(1)
      expect(outbox[0]!.type).toBe('conversation.ai_pause')
      expect(JSON.parse(outbox[0]!.payloadJson)).toMatchObject({
        conversationId: s.cnv.id,
        aiReplyPaused: false,
      })
      expect(
        listOpenPendingCommunicationsForConversation(s.db, s.tenantId, s.cnv.id).some(
          (row) => row.kind === 'alter_awaiting_team',
        ),
      ).toBe(false)
    } finally {
      s.close()
    }
  })

  it('«Remarca meu horário de segunda para terça, 3 de novembro, às 10:00.» pausa antes do modelo', async () => {
    const s = seed()
    try {
      const out = await runInbound(
        s,
        'Remarca meu horário de segunda para terça, 3 de novembro, às 10:00.',
      )
      expect(out.reason).toBe('human_handoff')
      expect(s.calls()).toBe(0)
      const sent = s.db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
      )
      expect(sent?.body).toBe(HUMAN_HANDOFF_TEXT)
      expect(sent?.body).not.toMatch(/para qual dia/i)
    } finally {
      s.close()
    }
  })
})
