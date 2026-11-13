/**
 * DEC-180 — isenção durável do sinal no Contato (owner + atendente).
 * Diferente do «Confirmar sem sinal» pontual do Agendar (AC-51).
 */
import type { Clock } from '../../db/clock'
import { writeOperationalAudit } from '../audit'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { NotFoundError, ValidationError } from '../errors'
import { loadContactSummary } from '../inbox/conversations'
import type { ContactSummary } from '../inbox/types'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'

export const CONTACT_SIGNAL_WAIVE_REASONS = [
  'Cliente frequente',
  'Indicação da owner',
  'Pacote / cortesia',
  'Outro',
] as const

export type ContactSignalWaiveReason = (typeof CONTACT_SIGNAL_WAIVE_REASONS)[number]

export type SetContactSignalWaiveInput = {
  contactId: string
  waived: boolean
  /** Obrigatório ao ligar; chips Confirmados + Outro. */
  reason?: string | null
  actorClerkUserId: string
  actorDisplayName: string
}

export function setContactSignalWaiveOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: SetContactSignalWaiveInput,
  clock: Clock,
): { contact: ContactSummary } {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)

  const existing = loadContactSummary(db, meta.tenantId, input.contactId)
  if (!existing) {
    throw new NotFoundError('contact_not_found', 'Contato não encontrado nesta clínica')
  }

  const now = clock.nowMs()
  if (input.waived) {
    const reason = (input.reason ?? '').trim().slice(0, 200)
    if (!reason) {
      throw new ValidationError(
        'waive_reason_required',
        'Motivo obrigatório para dispensar o sinal',
      )
    }
    db.run(
      `UPDATE contacts
       SET signal_waived = 1,
           signal_waive_reason = ?,
           signal_waived_by_clerk_user_id = ?,
           signal_waived_by_display_name = ?,
           signal_waived_at = ?
       WHERE tenant_id = ? AND id = ?`,
      reason,
      input.actorClerkUserId,
      input.actorDisplayName,
      now,
      meta.tenantId,
      input.contactId,
    )
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: input.actorClerkUserId,
        action: 'contact.signal_waived',
        objectType: 'contact',
        objectId: input.contactId,
        detail: { reason },
      },
      clock,
    )
  } else {
    db.run(
      `UPDATE contacts
       SET signal_waived = 0,
           signal_waive_reason = NULL,
           signal_waived_by_clerk_user_id = NULL,
           signal_waived_by_display_name = NULL,
           signal_waived_at = NULL
       WHERE tenant_id = ? AND id = ?`,
      meta.tenantId,
      input.contactId,
    )
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: input.actorClerkUserId,
        action: 'contact.signal_waive_cleared',
        objectType: 'contact',
        objectId: input.contactId,
        detail: {},
      },
      clock,
    )
  }

  const contact = loadContactSummary(db, meta.tenantId, input.contactId)!
  return { contact }
}
