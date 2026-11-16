/**
 * DEC-061: texto livre («sim», «confirmo», 👍) não marca. Com proposta aberta,
 * reoferta só o botão Confirmar (DEC-061, Paulo 16/11/2026).
 */
import type { Clock } from '../../db/clock'
import { extractTimes, norm } from '../ai/nlu/temporal'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller, workerCaller } from '../envelopes'
import { sendOutboundMessageOp } from '../inbox/operations'
import type { ChoiceInteractiveButtons } from '../ai/choice-offer'
import { messagingWindowForConversation } from '../inbox/window'
import { assertClinicSchemaReady } from '../migrations'
import type { OutboxRow } from '../outbox'
import { APPOINTMENT_PROPOSAL_VALIDITY_MS } from '../constants'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import { localHHMM } from '../ai/slot-offer'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import { queryAvailability } from '../scheduling/query'
import { expireProposalIfNeeded, getProposal } from './proposals'
import { renderProposalInteractive } from './render'
import type { AppointmentProposalRow } from './types'

const AFFIRM_CORE =
  /\b(sim|pode ser|pode marcar|pode agendar|pode|confirmo|confirmado|confirmar|confirma|fechado|combinado|isso|ok|okay|perfeito|beleza|blz|otimo|bora|marca|marcar|serve|fica bom|esta otimo|ta bom|ta otimo|certo)\b/

const RESCHEDULE = /\b(reagend\w*|remarc\w*|desmarc\w*|cancel\w*|mudar|trocar|adiar)\b/
const HESITATION_PHRASE =
  /\b(vou ver|vou pensar|talvez|nao sei|depois eu vejo|mais tarde)\b/

export const PROPOSAL_CONFIRM_NUDGE_LEAD = 'Para confirmar, toca em Confirmar 👇'

/** Resposta curta de confirmação com proposta `enviada` aberta — não marca (DEC-061). */
export function isProposalAffirmativeText(text: string): boolean {
  const raw = text.trim()
  if (!raw) return false
  const withEmoji = raw.replace(/[👍👌✅🙂😊]+/gu, ' ok ')
  const c = norm(withEmoji)
    .replace(/\b(obrigad[oa]|valeu|brigad[oa]|obg|minha filha|deus te abençoe|amém|ame)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!c || c.length > 72) return false
  if (RESCHEDULE.test(c) || HESITATION_PHRASE.test(c)) return false
  if (/\?/.test(raw)) return false
  const times = [...extractTimes(raw)]
  if (times.length > 1) return false
  if (!AFFIRM_CORE.test(c)) return false
  return true
}

export type ReofferProposalOnAffirmInput = {
  open: AppointmentProposalRow | null | undefined
  turnText: string
  swap?: unknown
  zoneEcho?: 'skip' | 'confirm' | 'correct' | undefined
  turnServiceId?: string | null
  turnDate?: string | null
  turnTime?: string | null
  tz: string
}

export type ReofferProposalOnRepeatedSlotInput = {
  open: AppointmentProposalRow | null | undefined
  turnText: string
  turnServiceId?: string | null
  turnDate?: string | null
  turnTime?: string | null
  tz: string
}

/** Cliente repete o horário já proposto («12 e 30») sem ser afirmação curta — lab S09b. */
export function shouldReofferProposalOnRepeatedSlot(
  input: ReofferProposalOnRepeatedSlotInput,
): input is ReofferProposalOnRepeatedSlotInput & { open: AppointmentProposalRow } {
  const open = input.open
  if (!open || open.confirmSuspended) return false
  if (open.state !== 'enviada' && open.state !== 'envio_pendente' && open.state !== 'envio_incerto') {
    return false
  }
  if (isProposalAffirmativeText(input.turnText)) return false
  if (input.turnServiceId && input.turnServiceId !== open.serviceId) return false
  const propDate = clinicCivilDateFromUtc(input.tz, open.startsAt)
  const propTime = localHHMM(input.tz, open.startsAt)
  const turnTimes = [...extractTimes(input.turnText)]
  if (turnTimes.length !== 1 || turnTimes[0] !== propTime) return false
  if (input.turnDate && input.turnDate !== propDate) return false
  if (input.turnTime && input.turnTime !== propTime) return false
  return true
}

export function shouldReofferProposalOnAffirmText(
  input: ReofferProposalOnAffirmInput,
): input is ReofferProposalOnAffirmInput & { open: AppointmentProposalRow } {
  const open = input.open
  if (!open || open.state !== 'enviada' || open.confirmSuspended) return false
  if (input.swap || input.zoneEcho === 'correct' || input.zoneEcho === 'confirm') return false
  if (!isProposalAffirmativeText(input.turnText)) return false
  if (input.turnServiceId && input.turnServiceId !== open.serviceId) return false
  const propDate = clinicCivilDateFromUtc(input.tz, open.startsAt)
  const propTime = localHHMM(input.tz, open.startsAt)
  const turnTimes = [...extractTimes(input.turnText)]
  if (turnTimes.length === 1 && turnTimes[0] !== propTime) return false
  if (input.turnDate && input.turnDate !== propDate) return false
  if (input.turnTime && input.turnTime !== propTime) return false
  return true
}

export function proposalConfirmNudgeClientRequestId(
  proposalId: string,
  version: number,
  inboundKey: string,
): string {
  return `proposal.confirm_nudge:${proposalId}:v${version}:${inboundKey}`
}

function proposalSlotStillBookable(
  db: ClinicDb,
  tenantId: string,
  proposal: AppointmentProposalRow,
  clock: Clock,
): boolean {
  const date = clinicCivilDateFromUtc(proposal.timezone, proposal.startsAt)
  const want = localHHMM(proposal.timezone, proposal.startsAt)
  const team = queryAvailability(
    db,
    tenantId,
    {
      serviceId: proposal.serviceId,
      date,
      ...(proposal.professionalId ? { professionalId: proposal.professionalId } : {}),
    },
    clock,
  )
  return team.slots.some((s) => localHHMM(proposal.timezone, s.startsAt) === want)
}

export type SendProposalConfirmNudgeResult =
  | {
      status: 'queued'
      lead: string
      interactive: ChoiceInteractiveButtons
      outbox: OutboxRow[]
      duplicate: boolean
    }
  | { status: 'skipped_closed_window' }
  | { status: 'skipped_no_proposal' }

export function sendProposalConfirmNudgeOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: {
    proposal: AppointmentProposalRow
    conversationId: string
    clientRequestId: string
  },
  clock: Clock,
): SendProposalConfirmNudgeResult {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const fresh =
    expireProposalIfNeeded(db, meta.tenantId, input.proposal.id, clock) ??
    getProposal(db, meta.tenantId, input.proposal.id)
  if (!fresh || fresh.state !== 'enviada' || fresh.confirmSuspended) {
    return { status: 'skipped_no_proposal' }
  }
  if (!proposalSlotStillBookable(db, meta.tenantId, fresh, clock)) {
    return { status: 'skipped_no_proposal' }
  }

  const window = messagingWindowForConversation(
    db,
    meta.tenantId,
    input.conversationId,
    clock.nowMs(),
  )
  if (!window.open) return { status: 'skipped_closed_window' }

  const validUntilMs = fresh.expiresAt ?? clock.nowMs() + APPOINTMENT_PROPOSAL_VALIDITY_MS
  const interactive = renderProposalInteractive(fresh, db, { validUntilMs, clock })
  const confirmButtons = interactive.buttons.filter((b) => b.action === 'confirm')
  if (confirmButtons.length !== 1) {
    return { status: 'skipped_no_proposal' }
  }
  const sendCaller = caller.actorId
    ? caller
    : workerCaller(meta.tenantId, 'system:proposal-nudge')

  const sent = sendOutboundMessageOp(
    db,
    sendCaller,
    {
      conversationId: input.conversationId,
      body: PROPOSAL_CONFIRM_NUDGE_LEAD,
      clientRequestId: input.clientRequestId,
      authorClerkUserId: 'system:proposal-nudge',
      authorDisplayName: 'IA',
      interactive: {
        buttons: confirmButtons.map((b) => ({ id: b.id, title: b.title })),
      },
    },
    clock,
  )

  const buttons = confirmButtons.map((b) => ({ id: b.id, title: b.title }))
  return {
    status: 'queued',
    lead: PROPOSAL_CONFIRM_NUDGE_LEAD,
    interactive: { mode: 'buttons', buttons },
    outbox: sent.outbox,
    duplicate: sent.value.duplicate,
  }
}