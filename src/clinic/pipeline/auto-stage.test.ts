import { describe, expect, it } from 'vitest'
import { ingestContactMessage, workerCaller } from '../index'
import {
  assignConversationOp,
  closeConversationOp,
  getConversationDetailOp,
  sendOutboundMessageOp,
} from '../inbox/operations'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { seedSyntheticWhatsappTemplates } from '../inbox/templates'
import { moveOpportunityStageOp } from './index'
import { findOpenOpportunityForConversation, listStageHistory } from './opportunities'

const ANA = 'user_synth_attendant_a'
const BRUNO = 'user_synth_owner_a'

function setup() {
  const booted = bootClinicDb()
  const { db, clock } = booted
  const caller = workerCaller('clinic-demo-a', ANA)
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
    { providerEventKey: `wa:auto:${Math.random()}`, waId: '5511987002001', displayName: 'Carla', body: 'oi' },
    clock,
  )
  return { ...booted, caller, conversationId: ingested.conversation!.id }
}

function assume(
  ctx: ReturnType<typeof setup>,
  who: { id: string; name: string },
  assignee: { id: string; name: string } = who,
) {
  return assignConversationOp(
    ctx.db,
    ctx.caller,
    {
      conversationId: ctx.conversationId,
      assigneeClerkUserId: assignee.id,
      assigneeDisplayName: assignee.name,
      actorClerkUserId: who.id,
      actorDisplayName: who.name,
    },
    ctx.clock,
  )
}

function reply(ctx: ReturnType<typeof setup>, clientRequestId: string) {
  return sendOutboundMessageOp(
    ctx.db,
    ctx.caller,
    {
      conversationId: ctx.conversationId,
      body: 'Olá! Como posso ajudar?',
      clientRequestId,
      authorClerkUserId: ANA,
      authorDisplayName: 'Ana',
    },
    ctx.clock,
  )
}

function stageOf(ctx: ReturnType<typeof setup>) {
  return findOpenOpportunityForConversation(ctx.db, 'clinic-demo-a', ctx.conversationId)!
}

describe('Etapa automática (DEC-061, DEC-065)', () => {
  it('o detalhe da conversa devolve a oportunidade com a etapa', () => {
    const ctx = setup()
    try {
      const detail = getConversationDetailOp(
        ctx.db,
        ctx.caller,
        { conversationId: ctx.conversationId },
        ctx.clock,
      )
      expect(detail.opportunity).toMatchObject({
        stage: 'novo_contato',
        label: 'Novo contato',
      })
    } finally {
      ctx.close()
    }
  })

  it('assumir move novo_contato → em_atendimento, com histórico e evento', () => {
    const ctx = setup()
    try {
      const r = assume(ctx, { id: ANA, name: 'Ana' })
      expect(r.outbox.map((e) => e.type)).toContain('opportunity.stage_changed')
      const opp = stageOf(ctx)
      expect(opp.stage).toBe('em_atendimento')
      const history = listStageHistory(ctx.db, 'clinic-demo-a', opp.id)
      const auto = history.find((h) => h.toStage === 'em_atendimento')
      expect(auto).toMatchObject({
        fromStage: 'novo_contato',
        actorClerkUserId: ANA,
        note: 'Automática: assumiu a conversa',
      })
    } finally {
      ctx.close()
    }
  })

  it('transferir para outra pessoa não altera a etapa', () => {
    const ctx = setup()
    try {
      assume(ctx, { id: ANA, name: 'Ana' }, { id: BRUNO, name: 'Bruno' })
      expect(stageOf(ctx).stage).toBe('novo_contato')
    } finally {
      ctx.close()
    }
  })

  it('a primeira resposta move a etapa; a segunda não duplica o histórico', () => {
    const ctx = setup()
    try {
      reply(ctx, 'auto-1')
      const opp = stageOf(ctx)
      expect(opp.stage).toBe('em_atendimento')
      reply(ctx, 'auto-2')
      const moves = listStageHistory(ctx.db, 'clinic-demo-a', opp.id).filter(
        (h) => h.toStage === 'em_atendimento',
      )
      expect(moves).toHaveLength(1)
    } finally {
      ctx.close()
    }
  })

  it('nunca retrocede: horario_proposto continua após assumir e responder', () => {
    const ctx = setup()
    try {
      const opp = stageOf(ctx)
      moveOpportunityStageOp(
        ctx.db,
        ctx.caller,
        {
          opportunityId: opp.id,
          toStage: 'horario_proposto',
          actorClerkUserId: ANA,
          actorDisplayName: 'Ana',
        },
        ctx.clock,
      )
      assume(ctx, { id: ANA, name: 'Ana' })
      reply(ctx, 'auto-3')
      expect(stageOf(ctx).stage).toBe('horario_proposto')
    } finally {
      ctx.close()
    }
  })

  it('encerrar a conversa não altera a etapa (DEC-065)', () => {
    const ctx = setup()
    try {
      const before = stageOf(ctx)
      closeConversationOp(
        ctx.db,
        ctx.caller,
        {
          conversationId: ctx.conversationId,
          actorClerkUserId: ANA,
          actorDisplayName: 'Ana',
        },
        ctx.clock,
      )
      const after = findOpenOpportunityForConversation(ctx.db, 'clinic-demo-a', ctx.conversationId)!
      expect(after.stage).toBe(before.stage)
    } finally {
      ctx.close()
    }
  })
})
