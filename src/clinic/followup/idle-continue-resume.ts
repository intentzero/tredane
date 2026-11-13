/**
 * DEC-087 — ao Prosseguir, retomar oferta ou processar escolha silenciosa (staging 12/11/2026).
 */
import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import { listServices } from '../config/services'
import { isPendingOfferFresh, matchPendingChoice } from '../ai/booking-frame-choice'
import {
  buildLineChoiceInteractive,
  buildPeriodDayInteractive,
  buildSlotChoiceInteractive,
  buildVariantChoiceInteractive,
  buildZoneEchoInteractive,
  encodeChoiceId,
  handleChoiceOfferClick,
  slotBindingFromChoice,
  toSendInteractive,
  validateChoiceAgainstFrame,
  type ChoiceInteractive,
  type ChoiceSlot,
} from '../ai/choice-offer'
import { isInteractiveReplyBody } from '../ai/autodraft'
import { slotListRowCopy } from '../ai/slot-offer'
import { zonesForAudienceLine, type AudienceLine } from '../ai/variant-line'
import { getBookingFrame, saveBookingFrame } from '../ai/schedule-session'
import { readCatalogVersion } from '../ai/turn-context'
import { sendOutboundMessageOp } from '../inbox/operations'
import type { OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import { getActiveProposalForConversation, getProposal } from '../proposals/proposals'
import { renderProposalInteractive } from '../proposals/render'
import { APPOINTMENT_PROPOSAL_VALIDITY_MS } from '../constants'
import { FOLLOWUP_ACTOR, FOLLOWUP_ACTOR_DISPLAY } from './post-booking'
import { IDLE_PROMPT_BODY } from './idle'

export const IDLE_RESUME_LEAD_IN = 'Retomando de onde paramos:'

export type IdleContinueResumePlan =
  | { mode: 'generic' }
  | {
      mode: 'process_choice'
      buttonId: string
      buttonTitle: string
    }
  | { mode: 'reoffer' }
  | { mode: 'reoffer_proposal'; proposalId: string }

export type IdleContinueChoiceResume = {
  buttonId: string
  buttonTitle?: string | null
}

function promptSentAt(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): number | null {
  const row = db.get<{ promptAt: number | null }>(
    `SELECT idle_prompt_sent_at AS promptAt FROM conversations
     WHERE tenant_id = ? AND id = ?`,
    tenantId,
    conversationId,
  )
  if (row?.promptAt != null) return row.promptAt
  const msg = db.get<{ created_at: number }>(
    `SELECT created_at FROM messages
     WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound' AND body = ?
     ORDER BY created_at DESC LIMIT 1`,
    tenantId,
    conversationId,
    IDLE_PROMPT_BODY,
  )
  return msg?.created_at ?? null
}

function interactiveTitleFromBody(body: string): string {
  return body.replace(/^\[(?:Lista|Botão)\]\s*/i, '').trim()
}

function patientOutboundBetween(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  afterMs: number,
  beforeMs: number,
): boolean {
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM messages
     WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'
       AND created_at > ? AND created_at < ?
       AND body != ?`,
    tenantId,
    conversationId,
    afterMs,
    beforeMs,
    IDLE_PROMPT_BODY,
  )
  return (row?.n ?? 0) > 0
}

function pendingOfferFresh(db: ClinicDb, tenantId: string, conversationId: string, nowMs: number): boolean {
  const frame = getBookingFrame(db, tenantId, conversationId)
  const pending = frame?.pending
  if (!pending?.options.length) return false
  const pendingMsg = db.get<{ created_at: number }>(
    `SELECT created_at FROM messages WHERE tenant_id = ? AND id = ?`,
    tenantId,
    pending.messageId,
  )
  return isPendingOfferFresh(pendingMsg?.created_at ?? null, nowMs)
}

function rebuildInteractiveFromPending(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): ChoiceInteractive | null {
  const frame = getBookingFrame(db, tenantId, conversationId)
  if (!frame?.pending?.options.length || !frame.serviceId) return null
  const catalogVersion = frame.catalogVersion || readCatalogVersion(db, tenantId)
  const slot = frame.pending.slot
  if (slot === 'horario') {
    return buildSlotChoiceInteractive({
      catalogVersion,
      slots: frame.pending.options.map((o) => {
        const bound = slotBindingFromChoice(o.key, o.label)
        const copy = bound ? slotListRowCopy(bound.date, bound.time) : null
        const description = copy?.description?.trim()
        return {
          key: o.key,
          label: copy?.title ?? o.label,
          ...(description ? { description } : {}),
        }
      }),
    }).interactive
  }
  if (slot === 'linha') return buildLineChoiceInteractive(catalogVersion).interactive
  if (slot === 'eco') return buildZoneEchoInteractive(catalogVersion).interactive
  if (slot === 'periodo') return buildPeriodDayInteractive(catalogVersion).interactive
  if (slot === 'variantes') {
    const services = listServices(db, tenantId).filter((s) => s.active)
    const svc = services.find((s) => s.id === frame.serviceId)
    if (!svc) return null
    const active = svc.zones.filter((z) => z.active)
    const scoped = zonesForAudienceLine(active, (frame.line as AudienceLine | null) ?? null)
    const byId = new Map(scoped.map((z) => [z.id, z]))
    const zones = frame.pending.options
      .filter((o) => o.key !== 'todas')
      .map((o) => {
        const z = byId.get(o.key)
        return z ? { id: z.id, name: z.name, label: o.label } : { id: o.key, name: o.label }
      })
    return buildVariantChoiceInteractive({ catalogVersion, zones }).interactive
  }
  return null
}

/** Decide o que fazer ao Prosseguir sem enviar a cópia genérica. */
export function planIdleContinueResume(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
): IdleContinueResumePlan {
  const nowMs = clock.nowMs()
  const promptAt = promptSentAt(db, tenantId, conversationId)
  const frame = getBookingFrame(db, tenantId, conversationId)

  if (promptAt != null) {
    const lastIn = db.get<{ body: string; created_at: number }>(
      `SELECT body, created_at FROM messages
       WHERE tenant_id = ? AND conversation_id = ? AND direction = 'inbound'
         AND created_at < ?
       ORDER BY created_at DESC LIMIT 1`,
      tenantId,
      conversationId,
      promptAt,
    )
    if (
      lastIn &&
      isInteractiveReplyBody(lastIn.body) &&
      !patientOutboundBetween(db, tenantId, conversationId, lastIn.created_at, promptAt) &&
      frame?.pending &&
      pendingOfferFresh(db, tenantId, conversationId, nowMs)
    ) {
      const title = interactiveTitleFromBody(lastIn.body)
      const matched = matchPendingChoice(title, frame.pending)
      if (matched.kind === 'match') {
        const catalogVersion = frame.catalogVersion || readCatalogVersion(db, tenantId)
        const slot = frame.pending.slot as ChoiceSlot
        const buttonId = encodeChoiceId(slot, catalogVersion, matched.key)
        const validated = validateChoiceAgainstFrame(
          db,
          tenantId,
          conversationId,
          buttonId,
          nowMs,
        )
        if (validated.ok) {
          return { mode: 'process_choice', buttonId, buttonTitle: matched.label }
        }
      }
    }
  }

  if (frame?.pending?.options.length && pendingOfferFresh(db, tenantId, conversationId, nowMs)) {
    if (rebuildInteractiveFromPending(db, tenantId, conversationId)) {
      return { mode: 'reoffer' }
    }
  }

  const proposal = getActiveProposalForConversation(db, tenantId, conversationId, clock)
  if (proposal) return { mode: 'reoffer_proposal', proposalId: proposal.id }

  return { mode: 'generic' }
}

export function sendIdleContinueReoffer(
  db: ClinicDb,
  caller: ClinicCaller,
  input: {
    tenantId: string
    conversationId: string
    clientRequestId: string
  },
  clock: Clock,
): { outbox: OutboxRow[]; duplicate: boolean } {
  const frame = getBookingFrame(db, input.tenantId, input.conversationId)
  const interactive = rebuildInteractiveFromPending(db, input.tenantId, input.conversationId)
  if (!frame?.pending || !interactive) {
    return { outbox: [], duplicate: false }
  }
  const offerMsg = db.get<{ body: string }>(
    `SELECT body FROM messages WHERE tenant_id = ? AND id = ?`,
    input.tenantId,
    frame.pending.messageId,
  )
  const lead = offerMsg?.body?.trim()
    ? `${IDLE_RESUME_LEAD_IN}\n${offerMsg.body.trim()}`
    : IDLE_RESUME_LEAD_IN
  const sent = sendOutboundMessageOp(
    db,
    caller,
    {
      conversationId: input.conversationId,
      body: lead,
      interactive: toSendInteractive(interactive) ?? undefined,
      clientRequestId: input.clientRequestId,
      authorClerkUserId: FOLLOWUP_ACTOR,
      authorDisplayName: FOLLOWUP_ACTOR_DISPLAY,
      afterPersist: (ctx) => {
        if (!frame.serviceId) return []
        saveBookingFrame(
          db,
          ctx.tenantId,
          ctx.conversationId,
          {
            serviceId: frame.serviceId,
            pending: { ...frame.pending!, messageId: ctx.messageId },
          },
          clock,
        )
        return []
      },
    },
    clock,
  )
  return { outbox: sent.outbox, duplicate: sent.value.duplicate }
}

export function sendIdleContinueProposalReoffer(
  db: ClinicDb,
  caller: ClinicCaller,
  input: {
    tenantId: string
    conversationId: string
    proposalId: string
    clientRequestId: string
  },
  clock: Clock,
): { outbox: OutboxRow[]; duplicate: boolean } {
  const proposal = getProposal(db, input.tenantId, input.proposalId)
  if (!proposal) return { outbox: [], duplicate: false }
  const validUntilMs = clock.nowMs() + APPOINTMENT_PROPOSAL_VALIDITY_MS
  const interactive = renderProposalInteractive(proposal, db, { validUntilMs, clock })
  const body = `${IDLE_RESUME_LEAD_IN}\n${interactive.body}`
  const sent = sendOutboundMessageOp(
    db,
    caller,
    {
      conversationId: input.conversationId,
      body,
      interactive: {
        buttons: interactive.buttons.map((b) => ({ id: b.id, title: b.title })),
      },
      clientRequestId: input.clientRequestId,
      authorClerkUserId: FOLLOWUP_ACTOR,
      authorDisplayName: FOLLOWUP_ACTOR_DISPLAY,
    },
    clock,
  )
  return { outbox: sent.outbox, duplicate: sent.value.duplicate }
}

export async function runIdleContinueChoiceResume(
  db: ClinicDb,
  caller: ClinicCaller,
  input: {
    tenantId: string
    conversationId: string
    resume: IdleContinueChoiceResume
    providerEventKey?: string | null
    capability?: boolean
  },
  clock: Clock,
): Promise<OutboxRow[]> {
  const key = input.providerEventKey ?? 'x'
  const choice = await handleChoiceOfferClick(
    db,
    caller,
    {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      buttonId: input.resume.buttonId,
      buttonTitle: input.resume.buttonTitle ?? null,
      providerEventKey: `idle-continue:${key}`,
      capability: input.capability !== false,
    },
    clock,
  )
  return choice.handled ? choice.outbox : []
}
