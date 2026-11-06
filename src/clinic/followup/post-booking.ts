/**
 * DEC-086 — follow-up pós-agendamento com botões.
 * «Não, obrigado» agradece, não muda a etapa e fecha a sessão conversacional
 * (BookingFrame, pergunta pendente e última oferta — o mesmo clear do recomeço/idle).
 * Também zera o badge de não lidas da conversa (atenção do painel).
 * O compromisso confirmado fica. «Quero outro serviço» segue a consulta de
 * catálogo (DEC-142): não marca, e mantém a audiência se a conversa já a tiver.
 */
import type { Clock } from '../../db/clock'
import { writeOperationalAudit } from '../audit'
import { deliverCatalogConsult, planCatalogConsult } from '../ai/catalog-consult'
import { clearBookingFrame, getBookingFrame } from '../ai/schedule-session'
import { readCatalogVersion } from '../ai/turn-context'
import { listServices } from '../config/services'
import { getActiveProposalForConversation } from '../proposals/proposals'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller, workerCaller } from '../envelopes'
import { clearConversationUnread } from '../inbox/conversations'
import { sendOutboundMessageOp } from '../inbox/operations'
import { messagingWindowForConversation } from '../inbox/window'
import { assertClinicSchemaReady } from '../migrations'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import { PROPOSAL_BUTTON_TITLE_MAX } from '../proposals/render'
import { clearConversationIdle } from './idle-state'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'

export const FOLLOWUP_ACTOR = 'system:conversational-followup'
export const FOLLOWUP_ACTOR_DISPLAY = 'Sistema'

export const POST_BOOKING_BODY =
  'Posso ajudar em algo mais?'

export const POST_BOOKING_BUTTONS = {
  thanks: {
    idSuffix: 'thanks',
    title: 'Não, obrigado',
  },
  another: {
    idSuffix: 'another',
    // DEC-086 «Quero agendar outro serviço»; Cloud API máx. 20 caracteres.
    title: 'Quero outro serviço',
  },
} as const

export const THANKS_REPLY_BODY =
  'Agradecemos o contato. Estamos à disposição quando precisar.'

/** Id opaco: fu:post:{appointmentId}:{thanks|another} */
export function postBookingButtonId(
  appointmentId: string,
  action: 'thanks' | 'another',
): string {
  return `fu:post:${appointmentId}:${action}`
}

export function parsePostBookingButtonId(
  raw: string,
): { appointmentId: string; action: 'thanks' | 'another' } | null {
  const m = /^fu:post:([^:]+):(thanks|another)$/.exec(raw.trim())
  if (!m) return null
  return { appointmentId: m[1]!, action: m[2] as 'thanks' | 'another' }
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
      id: postBookingButtonId(input.appointmentId, 'thanks'),
      title: POST_BOOKING_BUTTONS.thanks.title,
    },
    {
      id: postBookingButtonId(input.appointmentId, 'another'),
      title: POST_BOOKING_BUTTONS.another.title,
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
      action: 'thanks'
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
 * «Não, obrigado» limpa o BookingFrame (ADR-0015). «Quero outro serviço» segue a DEC-142.
 * «Não, obrigado» também zera `unread_count` e emite `conversation.read`.
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

  if (parsed.action === 'thanks') {
    // Fim do pós-agendamento (ADR-0015): agradece e apaga o funil. Não cancela
    // o compromisso nem move a etapa (DEC-086). Zera unread para o badge da
    // lista deixar de chamar a atendente (Paulo, 2026-11-04).
    const thanks = sendOutboundMessageOp(
      db,
      caller,
      {
        conversationId: input.conversationId,
        body: THANKS_REPLY_BODY,
        clientRequestId: `followup.postbook.thanks:${parsed.appointmentId}:${input.providerEventKey ?? 'x'}`,
        authorClerkUserId: FOLLOWUP_ACTOR,
        authorDisplayName: FOLLOWUP_ACTOR_DISPLAY,
        afterPersist: ({ db: txDb, tenantId, conversationId, now }) => {
          const out: OutboxRow[] = []
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
                idempotencyKey: `conversation.read:${conversationId}:${now}:post_booking_thanks`,
                payload: {
                  conversationId,
                  unreadCount: 0,
                  reason: 'post_booking_thanks',
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
    clearConversationIdle(db, input.tenantId, input.conversationId, clock.nowMs())

    writeOperationalAudit(
      db,
      {
        tenantId: input.tenantId,
        actor: FOLLOWUP_ACTOR,
        action: 'followup.post_booking_thanks',
        objectType: 'conversation',
        objectId: input.conversationId,
        detail: {
          appointmentId: parsed.appointmentId,
          closedOpportunityId: null,
        },
      },
      clock,
    )

    return { handled: true, action: 'thanks', closedOpportunityId: null, outbox }
  }

  // DEC-086 + DEC-142: o botão não marca. Limpa o serviço e lista o catálogo.
  const frame = getBookingFrame(db, input.tenantId, input.conversationId)
  const action = planCatalogConsult({
    text: 'quero outro serviço',
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
