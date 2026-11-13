/**
 * DEC-087 — idle 30 min em conversas em aberto + segundo prazo de mais 30 min.
 * Mensagens system não reiniciam o relógio; humano activo (Assumir) isenta o prompt.
 */
import type { Clock } from '../../db/clock'
import { clearBookingFrame } from '../ai/schedule-session'
import { writeOperationalAudit } from '../audit'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller, workerCaller } from '../envelopes'
import { sendOutboundMessageOp } from '../inbox/operations'
import { messagingWindowForConversation } from '../inbox/window'
import { assertClinicSchemaReady } from '../migrations'
import type { OutboxRow } from '../outbox'
import { conversationHasFutureConfirmed } from '../pipeline/appointment-stage'
import {
  findOpenOpportunityForConversation,
  moveOpportunityStageOp,
} from '../pipeline'
import { retireActiveProposal } from '../proposals/proposals'
import { PROPOSAL_BUTTON_TITLE_MAX } from '../proposals/render'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import {
  clearConversationIdle,
  conversationHasActiveHuman,
  IDLE_CLOSE_AFTER_MS,
  IDLE_PROMPT_AFTER_MS,
  lastUsefulMessageAt,
  rescheduleConversationIdle,
  setConversationIdle,
} from './idle-state'
import { ensureClinicSettings } from '../config/settings'
import { FOLLOWUP_ACTOR, FOLLOWUP_ACTOR_DISPLAY } from './post-booking'
import { suppressFollowupsAfterClientEnd } from './suppress-after-end'
import { pickTerminarFarewell } from './terminar-farewell'
import {
  planIdleContinueResume,
  sendIdleContinueProposalReoffer,
  sendIdleContinueReoffer,
  type IdleContinueChoiceResume,
} from './idle-continue-resume'

export {
  clearConversationIdle,
  conversationHasActiveHuman,
  IDLE_CLOSE_AFTER_MS,
  IDLE_PROMPT_AFTER_MS,
  lastUsefulMessageAt,
  nextIdleDueAt,
  rescheduleConversationIdle,
} from './idle-state'

export const IDLE_PROMPT_BODY =
  'Ainda está aí? Quer prosseguir com o atendimento ou terminar?'

export const IDLE_CONTINUE_REPLY_BODY =
  'Combinado! Em que posso ajudar?'

export const IDLE_BUTTONS = {
  continue: { idSuffix: 'continue', title: 'Prosseguir' },
  end: { idSuffix: 'end', title: 'Terminar' },
} as const

function assertIdleButtonTitles(): void {
  for (const b of Object.values(IDLE_BUTTONS)) {
    if (b.title.length > PROPOSAL_BUTTON_TITLE_MAX) {
      throw new Error(`idle_button_title_too_long:${b.title}`)
    }
  }
}
assertIdleButtonTitles()

export function idleButtonId(
  conversationId: string,
  action: 'continue' | 'end',
): string {
  return `fu:idle:${conversationId}:${action}`
}

export function parseIdleButtonId(
  raw: string,
): { conversationId: string; action: 'continue' | 'end' } | null {
  const m = /^fu:idle:([^:]+):(continue|end)$/.exec(raw.trim())
  if (!m) return null
  return { conversationId: m[1]!, action: m[2] as 'continue' | 'end' }
}

/**
 * Texto livre após o prompt DEC-087 («…prosseguir… ou terminar?»).
 * Não casa `[Botão]…` / `[Lista]…` — esses ids passam por `handleIdleButtonClick`.
 */
export function parseIdleTextReply(raw: string): 'continue' | 'end' | null {
  const t = raw.trim()
  if (!t || /^\[(?:Botão|Lista)\]/i.test(t)) return null
  if (/^terminar[.!?\s]*$/i.test(t)) return 'end'
  if (/^prosseguir[.!?\s]*$/i.test(t)) return 'continue'
  return null
}

/** Prompt idle ainda é a última outbound útil (fase `close` ou já reiniciada pelo inbound). */
export function isAwaitingIdleClientReply(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): boolean {
  assertClinicSchemaReady(db)
  const phase = db.get<{ phase: string | null }>(
    `SELECT idle_phase AS phase FROM conversations WHERE tenant_id = ? AND id = ?`,
    tenantId,
    conversationId,
  )
  if (phase?.phase === 'close') return true
  const lastOut = db.get<{ body: string }>(
    `SELECT body FROM messages
     WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'
     ORDER BY created_at DESC LIMIT 1`,
    tenantId,
    conversationId,
  )
  return lastOut?.body === IDLE_PROMPT_BODY
}

export type IdleSweepItem =
  | {
      conversationId: string
      action: 'prompted'
      outbox: OutboxRow[]
    }
  | {
      conversationId: string
      action: 'closed'
      closedOpportunityId: string | null
      outbox: OutboxRow[]
    }
  | {
      conversationId: string
      action: 'rescheduled'
      dueAt: number
    }
  | {
      conversationId: string
      action: 'cleared'
    }

/**
 * Processa conversas com idle_due_at vencido. Chamado pelo alarme do DO.
 */
export function sweepDueIdleConversations(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): IdleSweepItem[] {
  assertClinicSchemaReady(db)
  const now = clock.nowMs()
  const due = db.all<{
    id: string
    idle_phase: string | null
    idle_prompt_sent_at: number | null
    idle_due_at: number | null
  }>(
    `SELECT id, idle_phase, idle_prompt_sent_at, idle_due_at FROM conversations
     WHERE tenant_id = ? AND idle_due_at IS NOT NULL AND idle_due_at <= ?
     ORDER BY idle_due_at ASC
     LIMIT 50`,
    tenantId,
    now,
  )
  const results: IdleSweepItem[] = []
  const caller = workerCaller(tenantId, FOLLOWUP_ACTOR)

  for (const row of due) {
    const conversationId = row.id
    const opp = findOpenOpportunityForConversation(db, tenantId, conversationId)
    if (!opp || conversationHasActiveHuman(db, tenantId, conversationId)) {
      clearConversationIdle(db, tenantId, conversationId, now)
      results.push({ conversationId, action: 'cleared' })
      continue
    }

    if (row.idle_phase === 'close' && row.idle_prompt_sent_at != null) {
      const progress = lastUsefulMessageAt(db, tenantId, conversationId)
      // Progresso após o prompt (cliente ou equipa) cancela o fecho.
      if (progress != null && progress > row.idle_prompt_sent_at) {
        const dueAt = rescheduleConversationIdle(db, tenantId, conversationId, clock, {
          progressAt: progress,
        })
        results.push(
          dueAt != null
            ? { conversationId, action: 'rescheduled', dueAt }
            : { conversationId, action: 'cleared' },
        )
        continue
      }
      const closed = closeIdleConversation(db, caller, conversationId, clock)
      results.push({
        conversationId,
        action: 'closed',
        closedOpportunityId: closed.closedOpportunityId,
        outbox: closed.outbox,
      })
      continue
    }

    const progress = lastUsefulMessageAt(db, tenantId, conversationId)
    if (progress == null) {
      clearConversationIdle(db, tenantId, conversationId, now)
      results.push({ conversationId, action: 'cleared' })
      continue
    }
    if (now < progress + IDLE_PROMPT_AFTER_MS) {
      const dueAt = progress + IDLE_PROMPT_AFTER_MS
      setConversationIdle(db, tenantId, conversationId, {
        phase: 'prompt',
        dueAt,
        promptSentAt: null,
        updatedAt: now,
      })
      results.push({ conversationId, action: 'rescheduled', dueAt })
      continue
    }

    const prompted = sendIdlePromptOp(db, caller, { conversationId }, clock)
    if (prompted.status === 'queued') {
      results.push({
        conversationId,
        action: 'prompted',
        outbox: prompted.outbox,
      })
    } else {
      clearConversationIdle(db, tenantId, conversationId, now)
      results.push({ conversationId, action: 'cleared' })
    }
  }

  return results
}

export type SendIdlePromptResult =
  | { status: 'queued'; outbox: OutboxRow[]; duplicate: boolean }
  | { status: 'skipped_closed_window' }
  | { status: 'skipped' }

export function sendIdlePromptOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: { conversationId: string },
  clock: Clock,
): SendIdlePromptResult {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const now = clock.nowMs()
  const window = messagingWindowForConversation(
    db,
    meta.tenantId,
    input.conversationId,
    now,
  )
  if (!window.open) return { status: 'skipped_closed_window' }

  const buttons = [
    {
      id: idleButtonId(input.conversationId, 'continue'),
      title: IDLE_BUTTONS.continue.title,
    },
    {
      id: idleButtonId(input.conversationId, 'end'),
      title: IDLE_BUTTONS.end.title,
    },
  ]

  const sendCaller = caller.actorId
    ? caller
    : workerCaller(meta.tenantId, FOLLOWUP_ACTOR)

  const sent = sendOutboundMessageOp(
    db,
    sendCaller,
    {
      conversationId: input.conversationId,
      body: IDLE_PROMPT_BODY,
      clientRequestId: `followup.idle.prompt:${input.conversationId}:${now}`,
      authorClerkUserId: FOLLOWUP_ACTOR,
      authorDisplayName: FOLLOWUP_ACTOR_DISPLAY,
      interactive: { buttons },
    },
    clock,
  )

  // promptSentAt = instante da mensagem do prompt (não o `now` pré-envio).
  // Se ficar atrás de createdAt do outbound, o próprio prompt cancela o fecho
  // (progress > idle_prompt_sent_at) e o segundo prazo nunca corre.
  const promptSentAt =
    sent.value.message.createdAt ??
    lastUsefulMessageAt(db, meta.tenantId, input.conversationId) ??
    now
  const closeDueAt = promptSentAt + IDLE_CLOSE_AFTER_MS
  setConversationIdle(db, meta.tenantId, input.conversationId, {
    phase: 'close',
    dueAt: closeDueAt,
    promptSentAt,
    updatedAt: clock.nowMs(),
  })

  writeOperationalAudit(
    db,
    {
      tenantId: meta.tenantId,
      actor: FOLLOWUP_ACTOR,
      action: 'followup.idle_prompt',
      objectType: 'conversation',
      objectId: input.conversationId,
      detail: { dueAt: closeDueAt },
    },
    clock,
  )

  return {
    status: 'queued',
    outbox: sent.outbox,
    duplicate: sent.value.duplicate,
  }
}

function settleIdle(
  db: ClinicDb,
  caller: ClinicCaller,
  tenantId: string,
  conversationId: string,
  clock: Clock,
  input: { thanks: boolean; note: string; clientRequestId: string },
): { closedOpportunityId: string | null; outbox: OutboxRow[] } {
  const outbox: OutboxRow[] = []
  // CF-28 / #508: limpa o BookingFrame *antes* do agradecimento. Se o outbound
  // ou a analytics falharem a meio, o funil abandonado não fica no SQLite.
  retireActiveProposal(db, tenantId, conversationId, clock)
  const frameOb = clearBookingFrame(db, tenantId, conversationId, clock)
  if (frameOb) outbox.push(frameOb)

  const future = conversationHasFutureConfirmed(db, tenantId, conversationId, clock.nowMs())
  let closedOpportunityId: string | null = null
  if (!future) {
    const opp = findOpenOpportunityForConversation(db, tenantId, conversationId)
    if (opp && opp.stage !== 'perdido' && opp.stage !== 'concluido') {
      const moved = moveOpportunityStageOp(
        db,
        caller,
        {
          opportunityId: opp.id,
          toStage: 'perdido',
          actorClerkUserId: FOLLOWUP_ACTOR,
          actorDisplayName: FOLLOWUP_ACTOR_DISPLAY,
          note: input.note,
        },
        clock,
      )
      outbox.push(...moved.outbox)
      closedOpportunityId = opp.id
    }
  }
  if (input.thanks) {
    const timezone = ensureClinicSettings(db, tenantId, clock).timezone
    const thanks = sendOutboundMessageOp(
      db,
      caller,
      {
        conversationId,
        body: pickTerminarFarewell({ timezone, nowMs: clock.nowMs() }),
        clientRequestId: input.clientRequestId,
        authorClerkUserId: FOLLOWUP_ACTOR,
        authorDisplayName: FOLLOWUP_ACTOR_DISPLAY,
      },
      clock,
    )
    outbox.push(...thanks.outbox)
  }
  // Após outbound (que reagenda idle) e sem thanks: cancela idle + handoff DEC-155.
  outbox.push(...suppressFollowupsAfterClientEnd(db, tenantId, conversationId, clock))
  return { closedOpportunityId, outbox }
}

function closeIdleConversation(
  db: ClinicDb,
  caller: ClinicCaller,
  conversationId: string,
  clock: Clock,
): { closedOpportunityId: string | null; outbox: OutboxRow[] } {
  const meta = bindOrAssertTenant(db, caller, clock)
  const future = conversationHasFutureConfirmed(db, meta.tenantId, conversationId, clock.nowMs())
  const settled = settleIdle(db, caller, meta.tenantId, conversationId, clock, {
    thanks: !future,
    note: 'Idle: sem resposta (fecho automático)',
    clientRequestId: `followup.idle.close:${conversationId}:${clock.nowMs()}`,
  })
  writeOperationalAudit(
    db,
    {
      tenantId: meta.tenantId,
      actor: FOLLOWUP_ACTOR,
      action: 'followup.idle_closed',
      objectType: 'conversation',
      objectId: conversationId,
      detail: { closedOpportunityId: settled.closedOpportunityId },
    },
    clock,
  )
  return settled
}

export type IdleButtonResult =
  | { handled: false; reason: 'not_idle_button' }
  | {
      handled: true
      action: 'continue' | 'end'
      closedOpportunityId?: string | null
      outbox: OutboxRow[]
      /** Escolha M5 silenciosa a concluir no DO (handleChoiceOfferClick). */
      resumeChoice?: IdleContinueChoiceResume
    }

/**
 * Continuar / Terminar partilhado: idle DEC-087 e ack de revisão (TRE-29).
 * Continuar → retoma oferta/proposta ou «Combinado!…»; Terminar → settleIdle.
 */
export function applyIdleClientAction(
  db: ClinicDb,
  input: {
    tenantId: string
    conversationId: string
    action: 'continue' | 'end'
    via: 'button' | 'text'
    providerEventKey?: string | null
  },
  clock: Clock,
): {
  handled: true
  action: 'continue' | 'end'
  closedOpportunityId?: string | null
  outbox: OutboxRow[]
  resumeChoice?: IdleContinueChoiceResume
} {
  const caller = workerCaller(input.tenantId, FOLLOWUP_ACTOR)
  bindOrAssertTenant(db, caller, clock)
  const outbox: OutboxRow[] = []
  const key = input.providerEventKey ?? 'x'
  const viaTag = input.via === 'text' ? 'text' : 'button'

  if (input.action === 'end') {
    const settled = settleIdle(db, caller, input.tenantId, input.conversationId, clock, {
      thanks: true,
      note:
        input.via === 'text'
          ? 'Cliente: Terminar (idle, texto)'
          : 'Cliente: Terminar (idle)',
      clientRequestId: `followup.idle.end:${viaTag}:${input.conversationId}:${key}`,
    })
    writeOperationalAudit(
      db,
      {
        tenantId: input.tenantId,
        actor: FOLLOWUP_ACTOR,
        action: 'followup.idle_end',
        objectType: 'conversation',
        objectId: input.conversationId,
        detail: {
          closedOpportunityId: settled.closedOpportunityId,
          via: input.via,
        },
      },
      clock,
    )
    return {
      handled: true,
      action: 'end',
      closedOpportunityId: settled.closedOpportunityId,
      outbox: settled.outbox,
    }
  }

  const continueClientRequestId = `followup.idle.continue:${viaTag}:${input.conversationId}:${key}`
  const plan = planIdleContinueResume(db, input.tenantId, input.conversationId, clock)
  let resumeChoice: IdleContinueChoiceResume | undefined
  let usedGenericReply = false

  if (plan.mode === 'process_choice') {
    resumeChoice = { buttonId: plan.buttonId, buttonTitle: plan.buttonTitle }
  } else if (plan.mode === 'reoffer') {
    const reoffer = sendIdleContinueReoffer(
      db,
      caller,
      {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        clientRequestId: `followup.idle.continue.reoffer:${viaTag}:${input.conversationId}:${key}`,
      },
      clock,
    )
    outbox.push(...reoffer.outbox)
    if (reoffer.duplicate && reoffer.outbox.length === 0) {
      return { handled: true, action: 'continue', outbox }
    }
  } else if (plan.mode === 'reoffer_proposal') {
    const reoffer = sendIdleContinueProposalReoffer(
      db,
      caller,
      {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        proposalId: plan.proposalId,
        clientRequestId: `followup.idle.continue.proposal:${viaTag}:${input.conversationId}:${key}`,
      },
      clock,
    )
    outbox.push(...reoffer.outbox)
    if (reoffer.duplicate && reoffer.outbox.length === 0) {
      return { handled: true, action: 'continue', outbox }
    }
  } else {
    const reply = sendOutboundMessageOp(
      db,
      caller,
      {
        conversationId: input.conversationId,
        body: IDLE_CONTINUE_REPLY_BODY,
        clientRequestId: continueClientRequestId,
        authorClerkUserId: FOLLOWUP_ACTOR,
        authorDisplayName: FOLLOWUP_ACTOR_DISPLAY,
      },
      clock,
    )
    if (reply.value.duplicate && reply.outbox.length === 0) {
      return { handled: true, action: 'continue', outbox }
    }
    outbox.push(...reply.outbox)
    usedGenericReply = true
  }

  rescheduleConversationIdle(db, input.tenantId, input.conversationId, clock, {
    progressAt: clock.nowMs(),
  })
  writeOperationalAudit(
    db,
    {
      tenantId: input.tenantId,
      actor: FOLLOWUP_ACTOR,
      action: 'followup.idle_continue',
      objectType: 'conversation',
      objectId: input.conversationId,
      detail: { via: input.via, resume: plan.mode, generic: usedGenericReply },
    },
    clock,
  )
  return {
    handled: true,
    action: 'continue',
    outbox,
    ...(resumeChoice ? { resumeChoice } : {}),
  }
}

export function handleIdleButtonClick(
  db: ClinicDb,
  input: {
    tenantId: string
    conversationId: string
    buttonId: string
    providerEventKey?: string | null
  },
  clock: Clock,
): IdleButtonResult {
  assertClinicSchemaReady(db)
  const parsed = parseIdleButtonId(input.buttonId)
  if (!parsed || parsed.conversationId !== input.conversationId) {
    return { handled: false, reason: 'not_idle_button' }
  }
  return applyIdleClientAction(
    db,
    {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      action: parsed.action,
      via: 'button',
      providerEventKey: input.providerEventKey,
    },
    clock,
  )
}

export type IdleTextResult =
  | { handled: false; reason: 'not_idle_text' | 'not_awaiting' }
  | {
      handled: true
      action: 'continue' | 'end'
      closedOpportunityId?: string | null
      outbox: OutboxRow[]
      resumeChoice?: IdleContinueChoiceResume
    }

/**
 * Texto livre «Terminar» / «Prosseguir» na sequência do prompt DEC-087.
 * Partilha `settleIdle` com o botão e o fecho automático (#620 / F-10).
 */
export function handleIdleTextReply(
  db: ClinicDb,
  input: {
    tenantId: string
    conversationId: string
    text: string
    providerEventKey?: string | null
  },
  clock: Clock,
): IdleTextResult {
  assertClinicSchemaReady(db)
  const action = parseIdleTextReply(input.text)
  if (!action) return { handled: false, reason: 'not_idle_text' }
  if (!isAwaitingIdleClientReply(db, input.tenantId, input.conversationId)) {
    return { handled: false, reason: 'not_awaiting' }
  }
  return applyIdleClientAction(
    db,
    {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      action,
      via: 'text',
      providerEventKey: input.providerEventKey,
    },
    clock,
  )
}
