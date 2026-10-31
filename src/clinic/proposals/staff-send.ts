/**
 * Atendente envia proposta versionada pelo Agendar (DEC-061, 31/10/2026).
 * Não cria compromisso nem muda etapa — só o clique em Confirmar no WhatsApp marca.
 */
import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { ValidationError } from '../errors'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import { createProposal } from './proposals'
import { sendProposalToWhatsAppOp, type SendProposalResult } from './send'
import type { AppointmentProposalRow, CreateAppointmentProposalInput } from './types'

export type CreateAndSendStaffProposalInput = CreateAppointmentProposalInput & {
  /** Idempotência de UI; a proposta em si deduplica por factos materiais. */
  clientRequestId?: string
}

export type CreateAndSendStaffProposalResult = {
  proposal: AppointmentProposalRow
  sendStatus: SendProposalResult['status']
  /** Outbox a fanout no Clinic DO (vazio no memory gateway se já drenado). */
  outbox: SendProposalResult['outbox']
  /** Sempre false neste caminho — o botão da cliente é que marca. */
  appointmentCreated: false
}

/**
 * Monta (ou reutiliza) a proposta e envia interactive com botões.
 * Janela 24 h fechada → handoff à equipe (mesmo comportamento S4).
 */
export function createAndSendStaffProposalOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: CreateAndSendStaffProposalInput,
  clock: Clock,
): CreateAndSendStaffProposalResult {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)

  if (!input.contactId?.trim() || !input.conversationId?.trim()) {
    throw new ValidationError(
      'proposal_requires_conversation',
      'É preciso contato e conversa para enviar a proposta pelo WhatsApp',
    )
  }
  if (!input.serviceId?.trim()) {
    throw new ValidationError('missing_service', 'serviceId é obrigatório')
  }
  if (!Number.isFinite(input.startsAt) || input.startsAt <= 0) {
    throw new ValidationError('invalid_starts_at', 'startsAt inválido')
  }

  void input.clientRequestId

  const proposal = createProposal(
    db,
    meta.tenantId,
    {
      contactId: input.contactId.trim(),
      conversationId: input.conversationId.trim(),
      serviceId: input.serviceId.trim(),
      professionalId: input.professionalId ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      durationMinutes: input.durationMinutes,
      zoneIds: input.zoneIds,
      beneficiaryKind: input.beneficiaryKind,
      beneficiaryName: input.beneficiaryName,
      signalConditionsText: input.signalConditionsText,
    },
    clock,
  )

  const send = sendProposalToWhatsAppOp(db, caller, { proposalId: proposal.id }, clock)
  return {
    proposal: send.proposal,
    sendStatus: send.status,
    outbox: send.outbox,
    appointmentCreated: false,
  }
}
