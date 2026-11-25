/**
 * Fecho de oportunidade partilhado pelos caminhos Terminar (idle DEC-087,
 * pós-agendamento/pós-cancelamento DEC-086, T3 preço) e Encerrar no painel
 * (staff `closeConversationOp`).
 *
 * Com horário futuro confirmado: não muda a etapa (DEC-086 / DEC-228 — cartão
 * fica Agendado). Sem horário futuro: move para Perdido e fecha o ciclo
 * (DEC-228; alinhamento Encerrar↔Terminar) — remove o cartão de
 * «Em atendimento».
 */
import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import type { OutboxRow } from '../outbox'
import { conversationHasFutureConfirmed } from '../pipeline/appointment-stage'
import {
  findOpenOpportunityForConversation,
  moveOpportunityStageOp,
} from '../pipeline'
import type { ClinicDb } from '../store'

/** Mesmos actores que `post-booking` / idle — evita import circular. */
const TERMINAR_ACTOR = 'system:conversational-followup'
const TERMINAR_ACTOR_DISPLAY = 'Sistema'

export function closeOpenOpportunityIfNoFuture(
  db: ClinicDb,
  caller: ClinicCaller,
  tenantId: string,
  conversationId: string,
  clock: Clock,
  note: string,
  actors?: { actorClerkUserId: string; actorDisplayName: string },
): { closedOpportunityId: string | null; outbox: OutboxRow[] } {
  const future = conversationHasFutureConfirmed(
    db,
    tenantId,
    conversationId,
    clock.nowMs(),
  )
  if (future) return { closedOpportunityId: null, outbox: [] }

  const opp = findOpenOpportunityForConversation(db, tenantId, conversationId)
  if (!opp || opp.stage === 'perdido' || opp.stage === 'concluido') {
    return { closedOpportunityId: null, outbox: [] }
  }

  const actorClerkUserId = actors?.actorClerkUserId ?? TERMINAR_ACTOR
  const actorDisplayName = actors?.actorDisplayName ?? TERMINAR_ACTOR_DISPLAY
  // O webhook/consumer usa `queueCaller`, que não representa uma pessoa e por
  // isso não traz actorId. Esta operação, porém, tem um ator de sistema fechado
  // e auditável. Propague-o também no envelope exigido pela mutação do pipeline.
  const mutationCaller = caller.actorId
    ? caller
    : { ...caller, actorId: actorClerkUserId }
  const moved = moveOpportunityStageOp(
    db,
    mutationCaller,
    {
      opportunityId: opp.id,
      toStage: 'perdido',
      actorClerkUserId,
      actorDisplayName,
      note,
    },
    clock,
  )
  return { closedOpportunityId: opp.id, outbox: moved.outbox }
}
