/**
 * S5 (#176 / DEC-061): clique autenticado Confirmar → book ou Pix uma vez.
 * Não confia em texto livre nem no LLM; só handoff de `handleProposalButtonClick`.
 */
import type { Clock } from '../../db/clock'
import type { PixProviderAdapter } from '../../pix/contract'
import { writeOperationalAudit } from '../audit'
import { AI_AUTOBOOK_ACTOR_ID, AI_AUTOBOOK_ACTOR_NAME } from '../ai/autobook'
import { checkConversationProtection } from '../ai/protection'
import { getContact } from '../contacts'
import { getService } from '../config/services'
import { quoteVisit, readZoneSnapshots, zoneSnapshotsDrifted } from '../config/zones'
import { getResource } from '../config/resources'
import {
  PROPOSAL_BOOK_CLIENT_REQUEST_PREFIX,
  PROPOSAL_PIX_CLIENT_REQUEST_PREFIX,
} from '../constants'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { ConflictError, ClinicError } from '../errors'
import { assertClinicSchemaReady } from '../migrations'
import type { OutboxRow } from '../outbox'
import { getPixChargeByIdempotencyKey } from '../pix/charges'
import { createSignalChargeAndSendOp } from '../pix/signal-charge'
import type { PixChargeRow } from '../pix/types'
import { findOpenOpportunityForConversation } from '../pipeline/opportunities'
import { confirmAppointmentOp } from '../scheduling/booking'
import type { AppointmentDetail } from '../scheduling/booking-types'
import { queryAvailability } from '../scheduling/query'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import { ensureClinicSettings } from '../config/settings'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import type { ProposalConfirmHandoff } from './buttons'
import {
  getProposal,
  markProposalConfirmed,
  markProposalForwarded,
  markProposalSlotRefused,
  markProposalTempoRefused,
} from './proposals'
import { evaluateServiceTempo, type ForecastAdapter } from '../tempo/evaluate'
import { readOpenMeteo } from '../tempo/open-meteo'
import { sendProposalResultMessageOp, type SendProposalResultOutcome } from './results'
import type { AppointmentProposalRow } from './types'

export function proposalBookClientRequestId(proposalId: string, version: number): string {
  return `${PROPOSAL_BOOK_CLIENT_REQUEST_PREFIX}${proposalId}:v${version}`
}

export function proposalPixClientRequestId(proposalId: string, version: number): string {
  return `${PROPOSAL_PIX_CLIENT_REQUEST_PREFIX}${proposalId}:v${version}`
}

const BUTTON_STAGE_NOTE = 'Compromisso confirmado pelo botão do WhatsApp'

function openOpportunityId(
  db: ClinicDb,
  tenantId: string,
  conversationId: string | null,
): string | null {
  if (!conversationId) return null
  return findOpenOpportunityForConversation(db, tenantId, conversationId)?.id ?? null
}

export type ExecuteProposalConfirmDenial =
  | 'capability_disabled'
  | 'protection'
  | 'authorization'
  | 'context_mismatch'
  | 'material_changed'
  | 'missing_professional'
  | 'pix_adapter_required'
  | 'not_confirm_handoff'

export type ExecuteProposalConfirmResult =
  | {
      status: 'booked'
      proposal: AppointmentProposalRow
      appointment: AppointmentDetail
      result: SendProposalResultOutcome
      outbox: OutboxRow[]
      idempotentReplay: boolean
    }
  | {
      status: 'slot_refused'
      proposal: AppointmentProposalRow
      result: SendProposalResultOutcome
      outbox: OutboxRow[]
      idempotentReplay: boolean
    }
  | {
      status: 'tempo_refused'
      proposal: AppointmentProposalRow
      result: SendProposalResultOutcome
      outbox: OutboxRow[]
      idempotentReplay: boolean
    }
  | {
      status: 'pix_signal'
      proposal: AppointmentProposalRow
      charge: PixChargeRow
      result: SendProposalResultOutcome
      outbox: OutboxRow[]
      idempotentReplay: boolean
    }
  | {
      status: 'denied'
      reason: ExecuteProposalConfirmDenial
      authorizationReason?: string
      proposal: AppointmentProposalRow | null
      result?: SendProposalResultOutcome
      outbox: OutboxRow[]
    }

export type ExecuteProposalConfirmInput = {
  handoff: ProposalConfirmHandoff
  /** Capacidade efetiva no momento do efeito (ligada, salvo pausa da owner). */
  capability: boolean
  providerEventKey?: string | null
  /** context.id da mensagem Meta (opcional; amarra ao send_provider_message_id). */
  contextMessageId?: string | null
  /** Remetente WhatsApp (wa_id / contact) para auditoria mínima. */
  senderContactId?: string | null
}

export type ExecuteProposalConfirmDeps = {
  /** Obrigatório quando a proposta exige sinal. */
  pixAdapter?: PixProviderAdapter
  /** Previsão do clique. Omisso = Open-Meteo. Testes injetam uma leitura fictícia. */
  forecast?: ForecastAdapter
}

function collectOutbox(
  ...parts: Array<OutboxRow[] | undefined>
): OutboxRow[] {
  const out: OutboxRow[] = []
  for (const p of parts) {
    if (p?.length) out.push(...p)
  }
  return out
}

function materialDrift(
  proposal: AppointmentProposalRow,
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): boolean {
  const service = getService(db, tenantId, proposal.serviceId)
  if (!service || !service.active) return true
  if (service.requiresSignal !== proposal.requiresSignal) return true
  const snaps = readZoneSnapshots(db, tenantId, 'proposal', proposal.id)
  if (snaps.length > 0) {
    if (zoneSnapshotsDrifted(db, tenantId, proposal.serviceId, snaps)) return true
    // DEC-080: combo criado, editado ou desativado muda o total sem mexer nas variantes.
    try {
      const live = quoteVisit(
        db,
        tenantId,
        service,
        snaps.map((z) => z.zoneId).filter((id): id is string => id != null),
      )
      if ((live.priceCents ?? null) !== (proposal.priceCents ?? null)) return true
    } catch {
      return true
    }
  } else if ((service.priceCents ?? null) !== (proposal.priceCents ?? null)) return true
  if ((service.signalKind ?? null) !== (proposal.signalKind ?? null)) return true
  if ((service.signalFixedCents ?? null) !== (proposal.signalFixedCents ?? null)) return true
  if ((service.signalPercent ?? null) !== (proposal.signalPercent ?? null)) return true
  if (snaps.length === 0 && service.durationMinutes !== proposal.durationMinutes) return true
  if (proposal.professionalId) {
    const pro = getResource(db, tenantId, proposal.professionalId, clock)
    if (!pro || pro.kind !== 'professional' || !pro.active) return true
  }
  if (service.tempoCeu !== proposal.tempoCeu) return true
  if (service.tempoTemperatura !== proposal.tempoTemperatura) return true
  if ((service.tempoCelsius ?? null) !== (proposal.tempoCelsius ?? null)) return true
  return false
}

/**
 * Proposta não guarda sala (S3); resolve na hora pelo caminho de disponibilidade.
 * Sem sala livre → null (tratado como conflito de vaga).
 */
function resolveRoomForProposal(
  db: ClinicDb,
  tenantId: string,
  proposal: AppointmentProposalRow,
  clock: Clock,
): string | null {
  const service = getService(db, tenantId, proposal.serviceId)
  if (!service || service.roomRequirement.mode === 'none') return null
  const settings = ensureClinicSettings(db, tenantId, clock)
  const date = clinicCivilDateFromUtc(settings.timezone, proposal.startsAt)
  const snaps = readZoneSnapshots(db, tenantId, 'proposal', proposal.id)
  const avail = queryAvailability(
    db,
    tenantId,
    {
      serviceId: proposal.serviceId,
      date,
      professionalId: proposal.professionalId ?? undefined,
      ...(snaps.length > 0 ? { durationMinutesOverride: proposal.durationMinutes } : {}),
      tempoMode: 'equipe',
    },
    clock,
  )
  const slot = avail.slots.find(
    (s) =>
      s.startsAt === proposal.startsAt &&
      (proposal.professionalId == null || s.professionalId === proposal.professionalId),
  )
  return slot?.roomResourceId ?? null
}

function writeAiBookedAudit(
  db: ClinicDb,
  input: {
    tenantId: string
    proposal: AppointmentProposalRow
    appointmentId: string | null
    chargeId: string | null
    providerEventKey?: string | null
    senderContactId?: string | null
    outcome: 'booked' | 'pix_signal'
  },
  clock: Clock,
): void {
  writeOperationalAudit(
    db,
    {
      tenantId: input.tenantId,
      actor: AI_AUTOBOOK_ACTOR_ID,
      action: 'appointment.ai_booked',
      objectType: input.appointmentId ? 'appointment' : 'appointment_proposal',
      objectId: input.appointmentId ?? input.proposal.id,
      detail: {
        proposalId: input.proposal.id,
        proposalVersion: input.proposal.version,
        conversationId: input.proposal.conversationId,
        contactId: input.proposal.contactId,
        senderContactId: input.senderContactId ?? input.proposal.contactId,
        providerEventKey: input.providerEventKey ?? null,
        appointmentId: input.appointmentId,
        chargeId: input.chargeId,
        outcome: input.outcome,
        marker: 'Marcado pela IA',
      },
    },
    clock,
  )
}

async function ensureResult(
  db: ClinicDb,
  caller: ClinicCaller,
  proposalId: string,
  resultKind: 'booked' | 'slot_refused' | 'pix_signal' | 'expired' | 'tempo_refused' | 'tempo_unconfirmed',
  clock: Clock,
): Promise<SendProposalResultOutcome> {
  return sendProposalResultMessageOp(
    db,
    caller,
    { proposalId, resultKind },
    clock,
  )
}

/**
 * Consome autorização válida e executa book ou Pix (DEC-047: sem hold).
 * Idempotente por proposta+versão. Texto livre nunca chega aqui.
 */
export async function executeProposalConfirmOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: ExecuteProposalConfirmInput,
  clock: Clock,
  deps: ExecuteProposalConfirmDeps = {},
): Promise<ExecuteProposalConfirmResult> {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)

  if (input.handoff.action !== 'confirm') {
    return {
      status: 'denied',
      reason: 'not_confirm_handoff',
      proposal: null,
      outbox: [],
    }
  }

  const auth = input.handoff.authorization
  let proposal =
    auth.proposal ??
    (auth.allowed ? auth.proposal : null) ??
    input.handoff.proposal

  // Replay após commit (queda antes do ack / reentrega): estado terminal primeiro.
  if (proposal) {
    const fresh = getProposal(db, meta.tenantId, proposal.id)
    if (fresh) proposal = fresh
  }

  if (proposal?.state === 'confirmada') {
    if (proposal.requiresSignal && !proposal.appointmentId) {
      const pixKey = proposalPixClientRequestId(proposal.id, proposal.version)
      const chargeRow = getPixChargeByIdempotencyKey(db, meta.tenantId, pixKey)
      const result = await ensureResult(db, caller, proposal.id, 'pix_signal', clock)
      return {
        status: 'pix_signal',
        proposal,
        charge: chargeRow ?? ({ id: '' } as PixChargeRow),
        result,
        outbox: collectOutbox('outbox' in result ? result.outbox : []),
        idempotentReplay: true,
      }
    }
    if (proposal.appointmentId && proposal.professionalId) {
      const roomResourceId = resolveRoomForProposal(db, meta.tenantId, proposal, clock)
      const booked = confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: proposalBookClientRequestId(proposal.id, proposal.version),
          serviceId: proposal.serviceId,
          professionalId: proposal.professionalId,
          roomResourceId,
          startsAt: proposal.startsAt,
          contactId: proposal.contactId,
          conversationId: proposal.conversationId,
          opportunityId: openOpportunityId(db, meta.tenantId, proposal.conversationId),
          actorClerkUserId: AI_AUTOBOOK_ACTOR_ID,
          actorDisplayName: AI_AUTOBOOK_ACTOR_NAME,
          appliedDurationMinutes: null,
          stageNote: BUTTON_STAGE_NOTE,
          zoneIds: readZoneSnapshots(db, meta.tenantId, 'proposal', proposal.id)
            .map((z) => z.zoneId)
            .filter((id): id is string => Boolean(id)),
        },
        clock,
      )
      const result = await ensureResult(db, caller, proposal.id, 'booked', clock)
      return {
        status: 'booked',
        proposal,
        appointment: booked.value,
        result,
        outbox: collectOutbox(booked.outbox, 'outbox' in result ? result.outbox : []),
        idempotentReplay: true,
      }
    }
  }

  if (proposal?.state === 'recusada_vaga') {
    const result = await ensureResult(db, caller, proposal.id, 'slot_refused', clock)
    return {
      status: 'slot_refused',
      proposal,
      result,
      outbox: collectOutbox('outbox' in result ? result.outbox : []),
      idempotentReplay: true,
    }
  }

  if (proposal?.state === 'recusada_tempo') {
    const kind = proposal.resultKind === 'tempo_unconfirmed' ? 'tempo_unconfirmed' : 'tempo_refused'
    const result = await ensureResult(db, caller, proposal.id, kind, clock)
    return {
      status: 'tempo_refused',
      proposal,
      result,
      outbox: collectOutbox('outbox' in result ? result.outbox : []),
      idempotentReplay: true,
    }
  }

  if (!input.capability) {
    return {
      status: 'denied',
      reason: 'capability_disabled',
      proposal,
      outbox: [],
    }
  }

  const conversationId =
    proposal?.conversationId ??
    (auth.allowed ? auth.proposal.conversationId : null)
  if (conversationId) {
    const guard = checkConversationProtection(db, meta.tenantId, conversationId)
    if (!guard.allowed) {
      return {
        status: 'denied',
        reason: 'protection',
        proposal,
        outbox: [],
      }
    }
  }

  if (!auth.allowed || !proposal) {
    let result: SendProposalResultOutcome | undefined
    const outbox: OutboxRow[] = []
    const denialReason = auth.allowed ? undefined : auth.reason
    if (proposal && (denialReason === 'expired' || denialReason === 'not_enviada')) {
      result = await ensureResult(db, caller, proposal.id, 'expired', clock)
      if ('outbox' in result) outbox.push(...result.outbox)
    }
    return {
      status: 'denied',
      reason: 'authorization',
      authorizationReason: denialReason,
      proposal,
      result,
      outbox,
    }
  }

  // Vínculo com a mensagem enviada (quando Meta envia context.id).
  if (
    input.contextMessageId &&
    proposal.sendProviderMessageId &&
    input.contextMessageId !== proposal.sendProviderMessageId
  ) {
    return {
      status: 'denied',
      reason: 'context_mismatch',
      proposal,
      outbox: [],
    }
  }

  if (materialDrift(proposal, db, meta.tenantId, clock)) {
    const forwarded = markProposalForwarded(db, meta.tenantId, proposal.id, clock)
    const result = await ensureResult(db, caller, proposal.id, 'expired', clock)
    return {
      status: 'denied',
      reason: 'material_changed',
      proposal: forwarded,
      result,
      outbox: collectOutbox('outbox' in result ? result.outbox : []),
    }
  }

  if (!proposal.professionalId) {
    const forwarded = markProposalForwarded(db, meta.tenantId, proposal.id, clock)
    return {
      status: 'denied',
      reason: 'missing_professional',
      proposal: forwarded,
      outbox: [],
    }
  }

  const contact = getContact(db, meta.tenantId, proposal.contactId)
  const contactLabel = contact?.displayName ?? proposal.beneficiaryName

  const tempo = await evaluateServiceTempo(
    db,
    meta.tenantId,
    { serviceId: proposal.serviceId, startsAt: proposal.startsAt },
    deps.forecast ?? { read: readOpenMeteo },
    clock,
  )
  if (tempo.outcome !== 'serve') {
    const refused = markProposalTempoRefused(db, meta.tenantId, proposal.id, clock)
    const kind = tempo.outcome === 'nao_serve' ? 'tempo_refused' : 'tempo_unconfirmed'
    const result = await ensureResult(db, caller, refused.id, kind, clock)
    return {
      status: 'tempo_refused',
      proposal: refused,
      result,
      outbox: collectOutbox('outbox' in result ? result.outbox : []),
      idempotentReplay: false,
    }
  }

  const roomResourceId = resolveRoomForProposal(db, meta.tenantId, proposal, clock)
  const service = getService(db, meta.tenantId, proposal.serviceId)
  if (service && service.roomRequirement.mode !== 'none' && !roomResourceId) {
    const refused = markProposalSlotRefused(db, meta.tenantId, proposal.id, clock)
    const result = await ensureResult(db, caller, refused.id, 'slot_refused', clock)
    return {
      status: 'slot_refused',
      proposal: refused,
      result,
      outbox: collectOutbox('outbox' in result ? result.outbox : []),
      idempotentReplay: false,
    }
  }

  if (proposal.requiresSignal) {
    if (!deps.pixAdapter) {
      return {
        status: 'denied',
        reason: 'pix_adapter_required',
        proposal,
        outbox: [],
      }
    }
    const chargeResult = await createSignalChargeAndSendOp(
      db,
      caller,
      {
        clientRequestId: proposalPixClientRequestId(proposal.id, proposal.version),
        conversationId: proposal.conversationId,
        contactId: proposal.contactId,
        opportunityId: openOpportunityId(db, meta.tenantId, proposal.conversationId),
        serviceId: proposal.serviceId,
        professionalId: proposal.professionalId,
        roomResourceId,
        startsAt: proposal.startsAt,
        actorClerkUserId: AI_AUTOBOOK_ACTOR_ID,
        authorDisplayName: AI_AUTOBOOK_ACTOR_NAME,
        zoneIds: readZoneSnapshots(db, meta.tenantId, 'proposal', proposal.id)
          .map((z) => z.zoneId)
          .filter((id): id is string => Boolean(id)),
      },
      clock,
      { adapter: deps.pixAdapter },
    )
    const confirmed = markProposalConfirmed(
      db,
      meta.tenantId,
      proposal.id,
      clock,
      null,
    )
    writeAiBookedAudit(
      db,
      {
        tenantId: meta.tenantId,
        proposal: confirmed,
        appointmentId: null,
        chargeId: chargeResult.charge.id,
        providerEventKey: input.providerEventKey,
        senderContactId: input.senderContactId,
        outcome: 'pix_signal',
      },
      clock,
    )
    const result = await ensureResult(db, caller, confirmed.id, 'pix_signal', clock)
    return {
      status: 'pix_signal',
      proposal: confirmed,
      charge: chargeResult.charge,
      result,
      outbox: collectOutbox(
        chargeResult.outbox,
        'outbox' in result ? result.outbox : [],
      ),
      idempotentReplay: Boolean(chargeResult.idempotentReplay),
    }
  }

  try {
    const booked = confirmAppointmentOp(
      db,
      caller,
      {
        clientRequestId: proposalBookClientRequestId(proposal.id, proposal.version),
        serviceId: proposal.serviceId,
        professionalId: proposal.professionalId,
        roomResourceId,
        startsAt: proposal.startsAt,
        contactId: proposal.contactId,
        conversationId: proposal.conversationId,
        opportunityId: openOpportunityId(db, meta.tenantId, proposal.conversationId),
        contactLabel,
        actorClerkUserId: AI_AUTOBOOK_ACTOR_ID,
        actorDisplayName: AI_AUTOBOOK_ACTOR_NAME,
        appliedDurationMinutes: null,
        stageNote: BUTTON_STAGE_NOTE,
        zoneIds: readZoneSnapshots(db, meta.tenantId, 'proposal', proposal.id)
          .map((z) => z.zoneId)
          .filter((id): id is string => Boolean(id)),
      },
      clock,
    )
    const confirmed = markProposalConfirmed(
      db,
      meta.tenantId,
      proposal.id,
      clock,
      booked.value.id,
    )
    writeAiBookedAudit(
      db,
      {
        tenantId: meta.tenantId,
        proposal: confirmed,
        appointmentId: booked.value.id,
        chargeId: null,
        providerEventKey: input.providerEventKey,
        senderContactId: input.senderContactId,
        outcome: 'booked',
      },
      clock,
    )
    const result = await ensureResult(db, caller, confirmed.id, 'booked', clock)
    return {
      status: 'booked',
      proposal: confirmed,
      appointment: booked.value,
      result,
      outbox: collectOutbox(booked.outbox, 'outbox' in result ? result.outbox : []),
      idempotentReplay: Boolean(booked.idempotentReplay),
    }
  } catch (err) {
    if (err instanceof ConflictError && err.code === 'appointment_conflict') {
      const refused = markProposalSlotRefused(db, meta.tenantId, proposal.id, clock)
      const result = await ensureResult(db, caller, refused.id, 'slot_refused', clock)
      return {
        status: 'slot_refused',
        proposal: refused,
        result,
        outbox: collectOutbox('outbox' in result ? result.outbox : []),
        idempotentReplay: false,
      }
    }
    if (err instanceof ClinicError) throw err
    throw err
  }
}
