/**
 * Leitura de estado da página web da cliente, dentro do Clinic DO (ADR-0018, só leitura).
 * Pura sobre `ClinicDb`, para ser testada sem Durable Object.
 *
 * Isolamento: o contacto tem de ser o da conversa da sessão. Qualquer outra combinação
 * devolve `null` (a rota responde 401) e nunca lê marcações de outro contacto.
 */
import type { Clock } from '../db/clock'
import type { ClinicDb } from '../clinic/store'
import { loadUpcomingAppointments } from '../clinic/ai/upcoming'
import { clientWebFirstName } from './first-name'
import { hasPaidSignal } from './manage'

export type ClientWebClinicState = {
  firstName: string | null
  timezone: string
  appointments: Array<{ id: string; serviceName: string; startsAt: number; endsAt: number; hasPaidSignal: boolean }>
}

/** O contacto tem de ser o da conversa da sessão, nesta clínica (ADR-0018 §4). */
export function sessionOwnsConversation(
  db: ClinicDb,
  input: { tenantId: string; contactId: string; conversationId: string },
): boolean {
  const conv = db.get<{ contact_id: string }>(
    'SELECT contact_id FROM conversations WHERE tenant_id = ? AND id = ?',
    input.tenantId,
    input.conversationId,
  )
  return Boolean(conv && conv.contact_id === input.contactId)
}

export function readClientWebState(
  db: ClinicDb,
  clock: Clock,
  input: { tenantId: string; contactId: string; conversationId: string },
): ClientWebClinicState | null {
  if (!sessionOwnsConversation(db, input)) return null
  const contact = db.get<{ display_name: string | null }>(
    'SELECT display_name FROM contacts WHERE tenant_id = ? AND id = ?',
    input.tenantId,
    input.contactId,
  )
  if (!contact) return null
  const tz = db.get<{ timezone: string }>(
    'SELECT timezone FROM clinic_settings WHERE tenant_id = ?',
    input.tenantId,
  )
  const upcoming = loadUpcomingAppointments(db, input.tenantId, input.contactId, clock.nowMs(), 20)
  return {
    firstName: clientWebFirstName(contact.display_name),
    timezone: tz?.timezone ?? 'America/Sao_Paulo',
    appointments: upcoming.map((a) => ({
      id: a.id,
      serviceName: a.serviceName,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      hasPaidSignal: hasPaidSignal(db, input.tenantId, a.id),
    })),
  }
}
