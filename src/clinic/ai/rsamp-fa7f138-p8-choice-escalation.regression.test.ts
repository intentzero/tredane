/**
 * P8 — rsamp_fa7f138db9039e4a63df33e5 (cnv_3fa911760aa64516, staging, 13/11/2026 BRT).
 *
 * Sequência real:
 *   09:11:03 «[Lista] terça 17/11 09:30»
 *   09:11:05 «Proposta de horário …» (proposal.send:<id>:v1)
 *   09:11:06 sistema «Escalação: toque em escolha sem confirmação após retentativa na fila.»
 *   09:11:14 «[Botão] Confirmar» → 09:11:15 «Agendado: …» + «Posso ajudar em algo mais?»
 *   09:11:27 «[Botão] Terminar» → «Sem problema. Quando quiser, é só chamar.»
 *   09:16:06 «Comunicação pendente…» · 09:41:06 «A equipe não conseguiu assumir agora…»
 *   10:11:06 «Ainda está aí?…» (repetido 11:26 / 11:31 / 11:56).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { HANDOFF_TIMEOUT_MS, PENDING_COMMUNICATION_ALERT_MS } from '../constants'
import { ingestContactMessage, workerCaller } from '../index'
import { sendOutboundMessageOp } from '../inbox/operations'
import { insertMessage } from '../inbox/messages'
import { findOpenOpportunityForConversation } from '../pipeline'
import { ensureOpenOpportunity } from '../pipeline/operations'
import { sweepPendingCommunicationAlerts } from '../proposals/pending-communication'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { seedSyntheticWhatsappTemplates } from '../inbox/templates'
import {
  handlePostBookingButtonClick,
  postBookingButtonId,
  sendPostBookingFollowupOp,
} from '../followup/post-booking'
import {
  IDLE_PROMPT_AFTER_MS,
  IDLE_PROMPT_BODY,
  sweepDueIdleConversations,
} from '../followup/idle'
import {
  HANDOFF_TIMEOUT_RESUME_TEXT,
  notifyHumanHandoff,
  readAiReplyPause,
  readHandoffTimeoutAt,
  sweepDueHandoffTimeouts,
} from './human-handoff'
import {
  escalateChoiceClickDeliveryToTeam,
  hasChoiceClickBookingDelivery,
  releaseChoiceClickEscalationAfterBooking,
} from './interactive-click-guard'

const TENANT = 'clinic-demo-a'
/** 13/11/2026 09:11:03 BRT = 12:11:03 UTC. */
const TAP_AT = Date.UTC(2026, 10, 13, 12, 11, 3)
const LIST_TAP_KEY = 'wa:msg:wamid.rsamp_fa7f138.list_0930'

function seed() {
  const clock = createControllableClock(TAP_AT - 60_000)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  syncWhatsappChannel(
    db,
    TENANT,
    {
      status: 'connected',
      bindingId: 'b_p8',
      phoneNumberId: 'pn_p8',
      wabaId: 'w_p8',
      displayPhone: '+5561900000000',
      action: 'channel_connected',
    },
    clock,
  )
  seedSyntheticWhatsappTemplates(db, TENANT, clock)
  const caller = workerCaller(TENANT, 'user_synth_attendant_a')
  const first = ingestContactMessage(
    db,
    caller,
    { providerEventKey: 'wa:msg:wamid.rsamp_fa7f138.0908', waId: '556181882769', body: 'Quero agendar uma depilação para segunda' },
    clock,
  )
  const conversationId = first.conversation!.id
  const contactId = first.contact!.id
  return { db, clock, caller, conversationId, contactId, close: boot.close }
}

type Seed = ReturnType<typeof seed>

function tapList(s: Seed) {
  s.clock.set(TAP_AT)
  ingestContactMessage(
    s.db,
    s.caller,
    { providerEventKey: LIST_TAP_KEY, waId: '556181882769', body: '[Lista] terça 17/11 09:30' },
    s.clock,
  )
}

function sendProposal(s: Seed, proposalId = 'prop_rsamp_fa7f138') {
  sendOutboundMessageOp(
    s.db,
    s.caller,
    {
      conversationId: s.conversationId,
      body: 'Proposta de horário\n\nServiço: Depilação · Pernas, Intima\nQuando: terça-feira, 17 de novembro de 2026 às 09:30 – 10:10',
      clientRequestId: `proposal.send:${proposalId}:v1`,
      authorClerkUserId: 'system:proposal-send',
      authorDisplayName: 'Sistema',
    },
    s.clock,
  )
}

function outboundBodies(s: Seed): string[] {
  return s.db
    .all<{ body: string }>(
      `SELECT body FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'`,
      TENANT,
      s.conversationId,
    )
    .map((r) => r.body)
}

function systemBodies(s: Seed): string[] {
  return s.db
    .all<{ body: string }>(
      `SELECT body FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'system'`,
      TENANT,
      s.conversationId,
    )
    .map((r) => r.body)
}

function openAwaitingTeam(s: Seed): number {
  return (
    s.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM pending_communications
       WHERE tenant_id = ? AND conversation_id = ? AND kind = 'alter_awaiting_team' AND status != 'resolved'`,
      TENANT,
      s.conversationId,
    )?.n ?? 0
  )
}

describe('P8 rsamp_fa7f138 — escalação falsa depois da proposta', () => {
  it('toque de lista que gerou «Proposta de horário» conta como entrega (não escala)', () => {
    const s = seed()
    try {
      tapList(s)
      expect(hasChoiceClickBookingDelivery(s.db, TENANT, LIST_TAP_KEY, s.conversationId)).toBe(false)
      s.clock.advance(2_000) // 09:11:05
      sendProposal(s)
      expect(hasChoiceClickBookingDelivery(s.db, TENANT, LIST_TAP_KEY, s.conversationId)).toBe(true)
    } finally {
      s.close()
    }
  })

  it('proposta anterior ao toque não conta como entrega deste toque', () => {
    const s = seed()
    try {
      sendProposal(s, 'prop_old')
      s.clock.advance(5_000)
      tapList(s)
      expect(hasChoiceClickBookingDelivery(s.db, TENANT, LIST_TAP_KEY, s.conversationId)).toBe(false)
    } finally {
      s.close()
    }
  })

  it('Confirmar com agendamento desfaz a escalação: sem pendente, sem «equipe não conseguiu», sem «Ainda está aí?»', () => {
    const s = seed()
    try {
      tapList(s)
      // Comportamento antigo (antes do fix) — escalou mesmo assim às 09:11:06.
      s.clock.advance(3_000)
      const esc = escalateChoiceClickDeliveryToTeam(
        s.db,
        TENANT,
        { conversationId: s.conversationId, providerEventKey: LIST_TAP_KEY },
        s.clock,
      )
      expect(esc.escalated).toBe(true)
      expect(readAiReplyPause(s.db, TENANT, s.conversationId)?.reason).toBe('human_only')
      expect(openAwaitingTeam(s)).toBe(1)

      // 09:11:14 Confirmar → booked.
      s.clock.advance(8_000)
      const released = releaseChoiceClickEscalationAfterBooking(s.db, TENANT, s.conversationId, s.clock)
      expect(released.length).toBeGreaterThan(0)
      expect(readAiReplyPause(s.db, TENANT, s.conversationId)).toBeNull()
      expect(readHandoffTimeoutAt(s.db, TENANT, s.conversationId)).toBeNull()
      expect(openAwaitingTeam(s)).toBe(0)

      // 09:16 / 09:41 / 10:11 — nada deve disparar.
      s.clock.advance(PENDING_COMMUNICATION_ALERT_MS + 1)
      expect(sweepPendingCommunicationAlerts(s.db, TENANT, s.clock)).toHaveLength(0)
      s.clock.advance(HANDOFF_TIMEOUT_MS)
      expect(sweepDueHandoffTimeouts(s.db, TENANT, s.clock)).toHaveLength(0)
      expect(outboundBodies(s)).not.toContain(HANDOFF_TIMEOUT_RESUME_TEXT)
    } finally {
      s.close()
    }
  })

  it('Confirmar não desfaz pedido explícito de equipe (customer_requested)', () => {
    const s = seed()
    try {
      tapList(s)
      notifyHumanHandoff(
        s.db,
        TENANT,
        { conversationId: s.conversationId, reason: 'customer_requested', clientRequestId: 'handoff.button:x' },
        s.clock,
      )
      expect(releaseChoiceClickEscalationAfterBooking(s.db, TENANT, s.conversationId, s.clock)).toEqual([])
      expect(readAiReplyPause(s.db, TENANT, s.conversationId)?.reason).toBe('customer_requested')
      expect(openAwaitingTeam(s)).toBe(1)
    } finally {
      s.close()
    }
  })

  it('Confirmar não desfaz pausa human_only sem marcador de toque (ex.: cancelar / terceiro)', () => {
    const s = seed()
    try {
      notifyHumanHandoff(
        s.db,
        TENANT,
        { conversationId: s.conversationId, reason: 'human_only', clientRequestId: 'hu:1' },
        s.clock,
      )
      expect(releaseChoiceClickEscalationAfterBooking(s.db, TENANT, s.conversationId, s.clock)).toEqual([])
      expect(readAiReplyPause(s.db, TENANT, s.conversationId)?.reason).toBe('human_only')
    } finally {
      s.close()
    }
  })

  it('Terminar pós-agendamento depois da escalação silenciosa: nada de «Comunicação pendente», «equipe não conseguiu» ou «Ainda está aí?»', () => {
    const s = seed()
    try {
      tapList(s)
      s.clock.advance(3_000)
      escalateChoiceClickDeliveryToTeam(
        s.db,
        TENANT,
        { conversationId: s.conversationId, providerEventKey: LIST_TAP_KEY },
        s.clock,
      )
      ensureOpenOpportunity(
        s.db,
        { tenantId: TENANT, contactId: s.contactId, conversationId: s.conversationId },
        s.clock,
      )
      const opp = findOpenOpportunityForConversation(s.db, TENANT, s.conversationId)!
      s.db.run(
        `UPDATE opportunities SET stage = 'agendado', updated_at = ? WHERE tenant_id = ? AND id = ?`,
        s.clock.nowMs(),
        TENANT,
        opp.id,
      )
      s.clock.advance(9_000) // 09:11:15 Agendado + «Posso ajudar em algo mais?»
      sendPostBookingFollowupOp(
        s.db,
        s.caller,
        { conversationId: s.conversationId, appointmentId: 'apt_rsamp_fa7f138' },
        s.clock,
      )
      s.clock.advance(12_000) // 09:11:27 Terminar
      insertMessage(
        s.db,
        {
          tenantId: TENANT,
          conversationId: s.conversationId,
          direction: 'inbound',
          body: '[Botão] Terminar',
          deliveryState: 'received',
        },
        s.clock,
      )
      const click = handlePostBookingButtonClick(
        s.db,
        {
          tenantId: TENANT,
          conversationId: s.conversationId,
          buttonId: postBookingButtonId('apt_rsamp_fa7f138', 'end'),
          providerEventKey: 'wa:msg:wamid.rsamp_fa7f138.terminar',
        },
        s.clock,
      )
      expect(click.handled).toBe(true)
      expect(readAiReplyPause(s.db, TENANT, s.conversationId)).toBeNull()
      expect(openAwaitingTeam(s)).toBe(0)

      s.clock.advance(PENDING_COMMUNICATION_ALERT_MS + 1) // 09:16
      expect(sweepPendingCommunicationAlerts(s.db, TENANT, s.clock)).toHaveLength(0)
      s.clock.advance(HANDOFF_TIMEOUT_MS) // 09:41
      expect(sweepDueHandoffTimeouts(s.db, TENANT, s.clock)).toHaveLength(0)
      s.clock.advance(IDLE_PROMPT_AFTER_MS) // 10:11
      const idle = sweepDueIdleConversations(s.db, TENANT, s.clock)
      expect(idle.every((i) => i.action !== 'prompted')).toBe(true)

      const bodies = outboundBodies(s)
      expect(bodies).not.toContain(HANDOFF_TIMEOUT_RESUME_TEXT)
      expect(bodies).not.toContain(IDLE_PROMPT_BODY)
      expect(systemBodies(s).filter((b) => b.startsWith('Comunicação pendente'))).toHaveLength(0)
    } finally {
      s.close()
    }
  })
})
