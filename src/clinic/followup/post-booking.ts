/**
 * DEC-086 — follow-up pós-agendamento com botões.
 * T3 (Paulo 09/11/2026): «Marcar outro» | «Terminar».
 * «Marcar outro» = B2 / DEC-142 (catálogo, mantém audiência).
 * «Terminar» = soft-decline Class A (limpa frame + acolher_adiamento).
 * O compromisso confirmado fica. Badge de não lidas zera no Terminar.
 */
import type { Clock } from '../../db/clock'
import { writeOperationalAudit } from '../audit'
import { deliverCatalogConsult, planCatalogConsult } from '../ai/catalog-consult'
import { sayAct } from '../ai/dialogue-acts'
import { clearBookingFrame, getBookingFrame } from '../ai/schedule-session'
import { readCatalogVersion } from '../ai/turn-context'
import { listServices } from '../config/services'
import { getActiveProposalForConversation, retireActiveProposal } from '../proposals/proposals'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller, workerCaller } from '../envelopes'
import { clearConversationUnread } from '../inbox/conversations'
import { sendOutboundMessageOp } from '../inbox/operations'
import { messagingWindowForConversation } from '../inbox/window'
import { assertClinicSchemaReady } from '../migrations'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import { PROPOSAL_BUTTON_TITLE_MAX } from '../proposals/render'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import { suppressFollowupsAfterClientEnd } from './suppress-after-end'

export const FOLLOWUP_ACTOR = 'system:conversational-followup'
export const FOLLOWUP_ACTOR_DISPLAY = 'Sistema'

export const POST_BOOKING_BODY =
  'Posso ajudar em algo mais?'

export const POST_BOOKING_BUTTONS = {
  another: {
    idSuffix: 'another',
    // T3 (Paulo 09/11/2026) — Cloud API máx. 20 caracteres.
    title: 'Marcar outro',
  },
  end: {
    idSuffix: 'end',
    title: 'Terminar',
  },
} as const

/** Adeus Class A (DEC-147 / T3 Terminar) — fallback do acto `acolher_adiamento`. */
export const TERMINAR_REPLY_BODY = 'Sem problema. Quando quiser, é só chamar.'

/**
 * Idle DEC-087 / «Não, obrigado» legado — agradecimento pós-contacto.
 * Distinto de Terminar Class A (T3).
 */
export const THANKS_REPLY_BODY =
  'Agradecemos o contato. Estamos à disposição quando precisar.'

/** Id opaco: fu:post:{appointmentId}:{another|end} */
export function postBookingButtonId(
  appointmentId: string,
  action: 'another' | 'end',
): string {
  return `fu:post:${appointmentId}:${action}`
}

export function parsePostBookingButtonId(
  raw: string,
): { appointmentId: string; action: 'another' | 'end' } | null {
  const m = /^fu:post:([^:]+):(another|end)$/.exec(raw.trim())
  if (!m) return null
  return { appointmentId: m[1]!, action: m[2] as 'another' | 'end' }
}

export function postBookingClientRequestId(appointmentId: string): string {
  return `followup.postbook:${appointmentId}`
}

function assertButtonTitles(): void {
  for (const b of Object.values(POST_BOOKING_BUTTONS)) {
    if (b.title.length > PROPOSAL_BUTTON_TITLE_MAX) {
      throw new Error(`post_booking_button_title_too_long:${b.title}`)
    }
  }
}
assertButtonTitles()

export type SendPostBookingFollowupResult =
  | {
      status: 'queued'
      outboundId: string
      messageId: string
      duplicate: boolean
      outbox: OutboxRow[]
    }
  | { status: 'skipped_closed_window' }
  | { status: 'skipped_no_conversation' }

/**
 * Envia a pergunta com botões depois da marcação confirmada (DEC-061).
 * Idempotente por appointmentId via clientRequestId.
 */
export function sendPostBookingFollowupOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: {
    conversationId: string
    appointmentId: string
  },
  clock: Clock,
): SendPostBookingFollowupResult {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  if (!input.conversationId.trim()) return { status: 'skipped_no_conversation' }

  const window = messagingWindowForConversation(
    db,
    meta.tenantId,
    input.conversationId,
    clock.nowMs(),
  )
  if (!window.open) return { status: 'skipped_closed_window' }

  const buttons = [
    {
      id: postBookingButtonId(input.appointmentId, 'another'),
      title: POST_BOOKING_BUTTONS.another.title,
    },
    {
      id: postBookingButtonId(input.appointmentId, 'end'),
      title: POST_BOOKING_BUTTONS.end.title,
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
      body: POST_BOOKING_BODY,
      clientRequestId: postBookingClientRequestId(input.appointmentId),
      authorClerkUserId: FOLLOWUP_ACTOR,
      authorDisplayName: FOLLOWUP_ACTOR_DISPLAY,
      interactive: { buttons },
    },
    clock,
  )

  return {
    status: 'queued',
    outboundId: sent.value.outbound.id,
    messageId: sent.value.message.id,
    duplicate: sent.value.duplicate,
    outbox: sent.outbox,
  }
}

/**
 * Best-effort após marcação confirmada (botão DEC-061 ou Pix pago).
 * Falha de follow-up não reverte o compromisso; idempotente por appointmentId.
 */
export function appendPostBookingFollowup(
  db: ClinicDb,
  caller: ClinicCaller,
  input: { conversationId: string | null | undefined; appointmentId: string },
  clock: Clock,
  outbox: OutboxRow[],
): OutboxRow[] {
  const conversationId = input.conversationId?.trim()
  if (!conversationId || !input.appointmentId.trim()) return outbox
  try {
    const follow = sendPostBookingFollowupOp(
      db,
      caller,
      { conversationId, appointmentId: input.appointmentId },
      clock,
    )
    if (follow.status === 'queued') return [...outbox, ...follow.outbox]
  } catch {
    /* marcação já confirmada */
  }
  return outbox
}

export type PostBookingButtonResult =
  | { handled: false; reason: 'not_post_booking_button' }
  | {
      handled: true
      action: 'end'
      closedOpportunityId: string | null
      outbox: OutboxRow[]
    }
  | {
      handled: true
      action: 'another'
      outbox: OutboxRow[]
    }

/**
 * Processa clique nos botões de follow-up. Não marca horário (DEC-061 intacto).
 * «Terminar» = Class A (limpa BookingFrame). «Marcar outro» = DEC-142 / B2.
 */
export function handlePostBookingButtonClick(
  db: ClinicDb,
  input: {
    tenantId: string
    conversationId: string
    buttonId: string
    providerEventKey?: string | null
  },
  clock: Clock,
): PostBookingButtonResult {
  assertClinicSchemaReady(db)
  const parsed = parsePostBookingButtonId(input.buttonId)
  if (!parsed) return { handled: false, reason: 'not_post_booking_button' }

  const caller = workerCaller(input.tenantId, FOLLOWUP_ACTOR)
  bindOrAssertTenant(db, caller, clock)
  const outbox: OutboxRow[] = []

  if (parsed.action === 'end') {
    const replyText = sayAct(
      'acolher_adiamento',
      input.conversationId,
      {},
      TERMINAR_REPLY_BODY,
    )
    const thanks = sendOutboundMessageOp(
      db,
      caller,
      {
        conversationId: input.conversationId,
        body: replyText,
        clientRequestId: `followup.postbook.end:${parsed.appointmentId}:${input.providerEventKey ?? 'x'}`,
        authorClerkUserId: FOLLOWUP_ACTOR,
        authorDisplayName: FOLLOWUP_ACTOR_DISPLAY,
        afterPersist: ({ db: txDb, tenantId, conversationId, now }) => {
          const out: OutboxRow[] = []
          retireActiveProposal(txDb, tenantId, conversationId, clock)
          const frameOb = clearBookingFrame(txDb, tenantId, conversationId, clock)
          if (frameOb) out.push(frameOb)
          clearConversationUnread(txDb, tenantId, conversationId, now)
          out.push(
            insertOutboxEvent(
              txDb,
              {
                tenantId,
                type: 'conversation.read',
                aggregateType: 'conversation',
                aggregateId: conversationId,
                idempotencyKey: `conversation.read:${conversationId}:${now}:post_booking_end`,
                payload: {
                  conversationId,
                  unreadCount: 0,
                  reason: 'post_booking_end',
                },
              },
              clock,
            ),
          )
          return out
        },
      },
      clock,
    )
    outbox.push(...thanks.outbox)
    // Depois do outbound: sendOutboundMessageOp reagenda idle; e se a IA
    // estava pausada (Confirmar funciona com pausa), cancela DEC-155.
    outbox.push(
      ...suppressFollowupsAfterClientEnd(
        db,
        input.tenantId,
        input.conversationId,
        clock,
      ),
    )

    writeOperationalAudit(
      db,
      {
        tenantId: input.tenantId,
        actor: FOLLOWUP_ACTOR,
        action: 'followup.post_booking_end',
        objectType: 'conversation',
        objectId: input.conversationId,
        detail: {
          appointmentId: parsed.appointmentId,
          closedOpportunityId: null,
        },
      },
      clock,
    )

    return { handled: true, action: 'end', closedOpportunityId: null, outbox }
  }

  // T3 + DEC-142 / B2: limpa o serviço e lista o catálogo.
  const frame = getBookingFrame(db, input.tenantId, input.conversationId)
  const action = planCatalogConsult({
    text: 'quero outro agendamento',
    frame,
    services: listServices(db, input.tenantId),
    catalogVersion: readCatalogVersion(db, input.tenantId),
    hasActiveProposal:
      getActiveProposalForConversation(db, input.tenantId, input.conversationId, clock) != null,
  })
  if (action) {
    const ask = deliverCatalogConsult(db, caller, clock, {
      conversationId: input.conversationId,
      clientRequestId: `followup.postbook.another:${parsed.appointmentId}:${input.providerEventKey ?? 'x'}`,
      authorClerkUserId: FOLLOWUP_ACTOR,
      authorDisplayName: FOLLOWUP_ACTOR_DISPLAY,
      action,
    })
    outbox.push(...ask.outbox)
  }

  writeOperationalAudit(
    db,
    {
      tenantId: input.tenantId,
      actor: FOLLOWUP_ACTOR,
      action: 'followup.post_booking_another',
      objectType: 'conversation',
      objectId: input.conversationId,
      detail: { appointmentId: parsed.appointmentId },
    },
    clock,
  )

  return { handled: true, action: 'another', outbox }
}

/** T3 mid-funnel após preço total — ids estáveis (sem appointment). */
export const PRICE_FOLLOWUP_BUTTONS = {
  another: { id: 'fu:price:another', title: 'Marcar outro' },
  end: { id: 'fu:price:end', title: 'Terminar' },
} as const

export function parsePriceFollowupButtonId(
  raw: string,
): 'another' | 'end' | null {
  if (raw.trim() === PRICE_FOLLOWUP_BUTTONS.another.id) return 'another'
  if (raw.trim() === PRICE_FOLLOWUP_BUTTONS.end.id) return 'end'
  return null
}

export function priceFollowupInteractiveButtons(): Array<{ id: string; title: string }> {
  return [
    { id: PRICE_FOLLOWUP_BUTTONS.another.id, title: PRICE_FOLLOWUP_BUTTONS.another.title },
    { id: PRICE_FOLLOWUP_BUTTONS.end.id, title: PRICE_FOLLOWUP_BUTTONS.end.title },
  ]
}

export type PriceFollowupButtonResult =
  | { handled: false; reason: 'not_price_followup_button' }
  | { handled: true; action: 'another' | 'end'; outbox: OutboxRow[] }

/**
 * T3 após «No total, ficam…»: Marcar outro → catálogo B2; Terminar → Class A.
 */
export function handlePriceFollowupButtonClick(
  db: ClinicDb,
  input: {
    tenantId: string
    conversationId: string
    buttonId: string
    providerEventKey?: string | null
  },
  clock: Clock,
): PriceFollowupButtonResult {
  assertClinicSchemaReady(db)
  const action = parsePriceFollowupButtonId(input.buttonId)
  if (!action) return { handled: false, reason: 'not_price_followup_button' }

  const caller = workerCaller(input.tenantId, FOLLOWUP_ACTOR)
  bindOrAssertTenant(db, caller, clock)
  const outbox: OutboxRow[] = []
  const key = input.providerEventKey ?? 'x'

  if (action === 'end') {
    const replyText = sayAct(
      'acolher_adiamento',
      input.conversationId,
      {},
      TERMINAR_REPLY_BODY,
    )
    const sent = sendOutboundMessageOp(
      db,
      caller,
      {
        conversationId: input.conversationId,
        body: replyText,
        clientRequestId: `followup.price.end:${key}`,
        authorClerkUserId: FOLLOWUP_ACTOR,
        authorDisplayName: FOLLOWUP_ACTOR_DISPLAY,
        afterPersist: ({ db: txDb, tenantId, conversationId }) => {
          const out: OutboxRow[] = []
          retireActiveProposal(txDb, tenantId, conversationId, clock)
          const frameOb = clearBookingFrame(txDb, tenantId, conversationId, clock)
          if (frameOb) out.push(frameOb)
          return out
        },
      },
      clock,
    )
    outbox.push(...sent.outbox)
    outbox.push(
      ...suppressFollowupsAfterClientEnd(
        db,
        input.tenantId,
        input.conversationId,
        clock,
      ),
    )
    return { handled: true, action: 'end', outbox }
  }

  const frame = getBookingFrame(db, input.tenantId, input.conversationId)
  const planned = planCatalogConsult({
    text: 'quero outro agendamento',
    frame,
    services: listServices(db, input.tenantId),
    catalogVersion: readCatalogVersion(db, input.tenantId),
    hasActiveProposal:
      getActiveProposalForConversation(db, input.tenantId, input.conversationId, clock) != null,
  })
  if (planned) {
    const ask = deliverCatalogConsult(db, caller, clock, {
      conversationId: input.conversationId,
      clientRequestId: `followup.price.another:${key}`,
      authorClerkUserId: FOLLOWUP_ACTOR,
      authorDisplayName: FOLLOWUP_ACTOR_DISPLAY,
      action: planned,
    })
    outbox.push(...ask.outbox)
  }
  return { handled: true, action: 'another', outbox }
}
