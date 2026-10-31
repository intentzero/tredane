/**
 * DEC-087 — idle 30 min em conversas em aberto + segundo prazo Proposto (+30 min).
 * Mensagens system não reiniciam o relógio; humano activo (Assumir) isenta o prompt.
 */
import type { Clock } from '../../db/clock'
import { writeOperationalAudit } from '../audit'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller, workerCaller } from '../envelopes'
import { sendOutboundMessageOp } from '../inbox/operations'
import { messagingWindowForConversation } from '../inbox/window'
import { assertClinicSchemaReady } from '../migrations'
import type { OutboxRow } from '../outbox'
import {
  findOpenOpportunityForConversation,
  moveOpportunityStageOp,
} from '../pipeline'
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
import { FOLLOWUP_ACTOR, FOLLOWUP_ACTOR_DISPLAY, THANKS_REPLY_BODY } from './post-booking'

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

  // O próprio prompt é outbound — segundo prazo a partir do envio (não reinicia prompt).
  setConversationIdle(db, meta.tenantId, input.conversationId, {
    phase: 'close',
    dueAt: now + IDLE_CLOSE_AFTER_MS,
    promptSentAt: now,
    updatedAt: now,
  })

  writeOperationalAudit(
    db,
    {
      tenantId: meta.tenantId,
      actor: FOLLOWUP_ACTOR,
      action: 'followup.idle_prompt',
      objectType: 'conversation',
      objectId: input.conversationId,
      detail: { dueAt: now + IDLE_CLOSE_AFTER_MS },
    },
    clock,
  )

  return {
    status: 'queued',
    outbox: sent.outbox,
    duplicate: sent.value.duplicate,
  }
}

function closeIdleConversation(
  db: ClinicDb,
  caller: ClinicCaller,
  conversationId: string,
  clock: Clock,
): { closedOpportunityId: string | null; outbox: OutboxRow[] } {
  const meta = bindOrAssertTenant(db, caller, clock)
  const outbox: OutboxRow[] = []
  const thanks = sendOutboundMessageOp(
    db,
    caller,
    {
      conversationId,
      body: THANKS_REPLY_BODY,
      clientRequestId: `followup.idle.close:${conversationId}:${clock.nowMs()}`,
      authorClerkUserId: FOLLOWUP_ACTOR,
      authorDisplayName: FOLLOWUP_ACTOR_DISPLAY,
    },
    clock,
  )
  outbox.push(...thanks.outbox)

  const opp = findOpenOpportunityForConversation(db, meta.tenantId, conversationId)
  let closedOpportunityId: string | null = null
  if (opp && opp.stage !== 'concluido') {
    const moved = moveOpportunityStageOp(
      db,
      caller,
      {
        opportunityId: opp.id,
        toStage: 'concluido',
        actorClerkUserId: FOLLOWUP_ACTOR,
        actorDisplayName: FOLLOWUP_ACTOR_DISPLAY,
        note: 'Idle: sem resposta (fecho automático)',
      },
      clock,
    )
    outbox.push(...moved.outbox)
    closedOpportunityId = opp.id
  }

  clearConversationIdle(db, meta.tenantId, conversationId, clock.nowMs())
  writeOperationalAudit(
    db,
    {
      tenantId: meta.tenantId,
      actor: FOLLOWUP_ACTOR,
      action: 'followup.idle_closed',
      objectType: 'conversation',
      objectId: conversationId,
      detail: { closedOpportunityId },
    },
    clock,
  )
  return { closedOpportunityId, outbox }
}

export type IdleButtonResult =
  | { handled: false; reason: 'not_idle_button' }
  | {
      handled: true
      action: 'continue' | 'end'
      closedOpportunityId?: string | null
      outbox: OutboxRow[]
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

  const caller = workerCaller(input.tenantId, FOLLOWUP_ACTOR)
  bindOrAssertTenant(db, caller, clock)
  const outbox: OutboxRow[] = []
  const key = input.providerEventKey ?? 'x'

  if (parsed.action === 'end') {
    const thanks = sendOutboundMessageOp(
      db,
      caller,
      {
        conversationId: input.conversationId,
        body: THANKS_REPLY_BODY,
        clientRequestId: `followup.idle.end:${input.conversationId}:${key}`,
        authorClerkUserId: FOLLOWUP_ACTOR,
        authorDisplayName: FOLLOWUP_ACTOR_DISPLAY,
      },
      clock,
    )
    outbox.push(...thanks.outbox)
    const opp = findOpenOpportunityForConversation(
      db,
      input.tenantId,
      input.conversationId,
    )
    let closedOpportunityId: string | null = null
    if (opp && opp.stage !== 'concluido') {
      const moved = moveOpportunityStageOp(
        db,
        caller,
        {
          opportunityId: opp.id,
          toStage: 'concluido',
          actorClerkUserId: FOLLOWUP_ACTOR,
          actorDisplayName: FOLLOWUP_ACTOR_DISPLAY,
          note: 'Cliente: Terminar (idle)',
        },
        clock,
      )
      outbox.push(...moved.outbox)
      closedOpportunityId = opp.id
    }
    clearConversationIdle(db, input.tenantId, input.conversationId, clock.nowMs())
    writeOperationalAudit(
      db,
      {
        tenantId: input.tenantId,
        actor: FOLLOWUP_ACTOR,
        action: 'followup.idle_end',
        objectType: 'conversation',
        objectId: input.conversationId,
        detail: { closedOpportunityId },
      },
      clock,
    )
    return { handled: true, action: 'end', closedOpportunityId, outbox }
  }

  const reply = sendOutboundMessageOp(
    db,
    caller,
    {
      conversationId: input.conversationId,
      body: IDLE_CONTINUE_REPLY_BODY,
      clientRequestId: `followup.idle.continue:${input.conversationId}:${key}`,
      authorClerkUserId: FOLLOWUP_ACTOR,
      authorDisplayName: FOLLOWUP_ACTOR_DISPLAY,
    },
    clock,
  )
  outbox.push(...reply.outbox)
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
      detail: {},
    },
    clock,
  )
  return { handled: true, action: 'continue', outbox }
}
