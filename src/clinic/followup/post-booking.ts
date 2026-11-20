/**
 * DEC-086 — follow-up pós-agendamento.
 * T3 (Paulo 18/11/2026, DEC-202) + Meta: com URL https, «Posso ajudar…» leva só
 * `cta_url` «Abrir agenda» (abre a página no toque; a Meta não mistura cta_url com
 * reply). Sem URL (lab / base http), fallback reply «Abrir agenda»|«Terminar».
 * «Terminar» com CTA: a cliente escreve «terminar» (DEC-154). Reply legado
 * `fu:post:…:another` ainda devolve `another` → quem trata envia o CTA.
 * Sem «Falar com a equipe» neste T3.
 * «Terminar» (reply ou texto): limpa frame + adeus (terminar-farewell.ts).
 * Com horário futuro: etapa fica Agendado (DEC-086). Sem horário futuro
 * (ex. pós-cancelamento DEC-092 → Em atendimento): fecha em Perdido (DEC-087).
 * Badge de não lidas zera no Terminar.
 */
import type { Clock } from '../../db/clock'
import { clientWebOfferInteractive } from '../../clientweb/offer'
import { writeOperationalAudit } from '../audit'
import { clearBookingFrame } from '../ai/schedule-session'
import { ensureClinicSettings } from '../config/settings'
import { retireActiveProposal } from '../proposals/proposals'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller, workerCaller } from '../envelopes'
import { clearConversationUnread } from '../inbox/conversations'
import { sendOutboundMessageOp } from '../inbox/operations'
import type { SendOutboundInteractiveInput } from '../inbox/types'
import { messagingWindowForConversation } from '../inbox/window'
import { assertClinicSchemaReady } from '../migrations'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import { PROPOSAL_BUTTON_TITLE_MAX } from '../proposals/interactive-limits'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import { clearIdleSuppressed } from './idle-state'
import { suppressFollowupsAfterClientEnd } from './suppress-after-end'
import { closeOpenOpportunityIfNoFuture } from './terminar-close-opportunity'
import { pickTerminarFarewell } from './terminar-farewell'

export const FOLLOWUP_ACTOR = 'system:conversational-followup'
export const FOLLOWUP_ACTOR_DISPLAY = 'Sistema'

export const POST_BOOKING_BODY =
  'Posso ajudar em algo mais?'

export const POST_BOOKING_BUTTONS = {
  another: {
    idSuffix: 'another',
    // T3 (Paulo 18/11/2026) — rótulo «Abrir agenda» (DEC-202); máx. 20 caracteres.
    title: 'Abrir agenda',
  },
  end: {
    idSuffix: 'end',
    title: 'Terminar',
  },
} as const

/**
 * Fallback legado do soft-decline mid-funil (`acolher_adiamento` / DEC-147).
 * O adeus dos botões Terminar (pós-agendamento, idle, preço) usa
 * `pickTerminarFarewell` — não esta constante.
 */
export const TERMINAR_REPLY_BODY = 'Sem problema. Quando quiser, é só chamar.'

/**
 * @deprecated Idle DEC-087 / Terminar partilham `pickTerminarFarewell` (Paulo 13/11/2026).
 * Frase antiga do agradecimento idle; não usar em novos call-sites.
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

/** Idempotência do follow-up após cancelamento (recibo web); distinto do pós-marcação. */
export function postCancelClientRequestId(appointmentId: string): string {
  return `followup.postcancel:${appointmentId}`
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
 * Envia «Posso ajudar…» depois da marcação confirmada (DEC-061 / DEC-202).
 * Com `agendaUrl` https → só `cta_url` «Abrir agenda» (um toque abre a página).
 * Sem URL → reply «Abrir agenda»|«Terminar» (legado / lab).
 * Idempotente por appointmentId via clientRequestId.
 */
export function sendPostBookingFollowupOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: {
    conversationId: string
    appointmentId: string
    /**
     * Por omissão pós-marcação (`followup.postbook:…`). Após cancelamento na
     * página usa `postCancelClientRequestId` para não colidir com o pós-Agendado.
     */
    clientRequestId?: string
    /**
     * URL da página (DEC-202). Preferido: `cta_url` na mesma bolha — evita o loop
     * reply → «Para agendar, toque em Abrir agenda…».
     */
    agendaUrl?: string | null
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

  const agendaUrl = input.agendaUrl?.trim() || null
  const interactive: SendOutboundInteractiveInput = agendaUrl
    ? clientWebOfferInteractive(agendaUrl)
    : {
        buttons: [
          {
            id: postBookingButtonId(input.appointmentId, 'another'),
            title: POST_BOOKING_BUTTONS.another.title,
          },
          {
            id: postBookingButtonId(input.appointmentId, 'end'),
            title: POST_BOOKING_BUTTONS.end.title,
          },
        ],
      }

  const sendCaller = caller.actorId
    ? caller
    : workerCaller(meta.tenantId, FOLLOWUP_ACTOR)

  const sent = sendOutboundMessageOp(
    db,
    sendCaller,
    {
      conversationId: input.conversationId,
      body: POST_BOOKING_BODY,
      clientRequestId:
        input.clientRequestId?.trim() || postBookingClientRequestId(input.appointmentId),
      authorClerkUserId: FOLLOWUP_ACTOR,
      authorDisplayName: FOLLOWUP_ACTOR_DISPLAY,
      interactive,
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
  input: {
    conversationId: string | null | undefined
    appointmentId: string
    agendaUrl?: string | null
  },
  clock: Clock,
  outbox: OutboxRow[],
): OutboxRow[] {
  const conversationId = input.conversationId?.trim()
  if (!conversationId || !input.appointmentId.trim()) return outbox
  try {
    const follow = sendPostBookingFollowupOp(
      db,
      caller,
      {
        conversationId,
        appointmentId: input.appointmentId,
        agendaUrl: input.agendaUrl,
      },
      clock,
    )
    if (follow.status === 'queued') return [...outbox, ...follow.outbox]
  } catch {
    /* marcação já confirmada */
  }
  return outbox
}

/**
 * Best-effort após cancelamento pela página (DEC-198 + DEC-086).
 * Mesmos botões «Abrir agenda»|«Terminar»; idempotente por appointmentId
 * (`followup.postcancel:…`), distinto do pós-Agendado.
 */
export function appendPostCancelFollowup(
  db: ClinicDb,
  caller: ClinicCaller,
  input: {
    conversationId: string | null | undefined
    appointmentId: string
    agendaUrl?: string | null
  },
  clock: Clock,
  outbox: OutboxRow[],
): OutboxRow[] {
  const conversationId = input.conversationId?.trim()
  if (!conversationId || !input.appointmentId.trim()) return outbox
  try {
    const follow = sendPostBookingFollowupOp(
      db,
      caller,
      {
        conversationId,
        appointmentId: input.appointmentId,
        clientRequestId: postCancelClientRequestId(input.appointmentId),
        agendaUrl: input.agendaUrl,
      },
      clock,
    )
    if (follow.status === 'queued') return [...outbox, ...follow.outbox]
  } catch {
    /* cancelamento já feito */
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
 * Processa clique nos botões de follow-up. Não marca horário (DEC-061 / DEC-202).
 * «Terminar» = Class A (limpa BookingFrame). «Abrir agenda» = `another` → link na página.
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
    // Suppress antes do adeus: outbound não rearma idle (Paulo 14/11).
    outbox.push(
      ...suppressFollowupsAfterClientEnd(
        db,
        input.tenantId,
        input.conversationId,
        clock,
      ),
    )
    // Sem horário futuro (pós-cancel / Em atendimento): Perdido — parity DEC-087.
    const closed = closeOpenOpportunityIfNoFuture(
      db,
      caller,
      input.tenantId,
      input.conversationId,
      clock,
      'Cliente: Terminar (pós-agendamento)',
    )
    outbox.push(...closed.outbox)

    const timezone = ensureClinicSettings(db, input.tenantId, clock).timezone
    const replyText = pickTerminarFarewell({
      timezone,
      nowMs: clock.nowMs(),
    })
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
          closedOpportunityId: closed.closedOpportunityId,
        },
      },
      clock,
    )

    return {
      handled: true,
      action: 'end',
      closedOpportunityId: closed.closedOpportunityId,
      outbox,
    }
  }

  // Abrir agenda = nova intenção → idle volta a poder armar.
  clearIdleSuppressed(db, input.tenantId, input.conversationId, clock.nowMs())
  // DEC-202: o clique devolve «another»; quem trata o clique envia o CTA «Abrir agenda».

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
    outbox.push(
      ...suppressFollowupsAfterClientEnd(
        db,
        input.tenantId,
        input.conversationId,
        clock,
      ),
    )
    outbox.push(
      ...closeOpenOpportunityIfNoFuture(
        db,
        caller,
        input.tenantId,
        input.conversationId,
        clock,
        'Cliente: Terminar (pós-preço)',
      ).outbox,
    )
    const timezone = ensureClinicSettings(db, input.tenantId, clock).timezone
    const replyText = pickTerminarFarewell({
      timezone,
      nowMs: clock.nowMs(),
    })
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
    return { handled: true, action: 'end', outbox }
  }

  // DEC-202: «Marcar outro» já não abre catálogo no chat; quem trata o clique envia o link «Abrir agenda».
  clearIdleSuppressed(db, input.tenantId, input.conversationId, clock.nowMs())
  return { handled: true, action: 'another', outbox }
}
