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
import { readComboSnapshot } from '../clinic/config/combos'
import { readZoneSnapshots } from '../clinic/config/zones'
import { clientWebFirstName } from './first-name'
import { hasPaidSignal } from './manage'

export type ClientWebClinicAppointment = {
  id: string
  serviceName: string
  startsAt: number
  endsAt: number
  serviceId: string
  professionalId: string
  professionalName: string
  hasPaidSignal: boolean
  /** Nomes das variantes na ordem do snapshot (vazio sem zonas). */
  zoneNames: string[]
  /** Nome do combo aplicado na visita, se houver. */
  comboName: string | null
  /**
   * Preço cotado na visita: combo → soma das zonas → preço da linha do serviço.
   * Null se alguma zona não tem preço ou o serviço não tem.
   */
  priceCents: number | null
}

export type ClientWebClinicState = {
  firstName: string | null
  timezone: string
  /** DEC-211: link do Google Business («Como chegar»); null sem link cadastrado. */
  locationUrl: string | null
  appointments: ClientWebClinicAppointment[]
}

/** Preço e rótulos da visita a partir dos snapshots (e fallback do catálogo sem zonas). */
export function visitCardFields(
  db: ClinicDb,
  tenantId: string,
  appointmentId: string,
  serviceId: string,
): Pick<ClientWebClinicAppointment, 'zoneNames' | 'comboName' | 'priceCents'> {
  const zones = readZoneSnapshots(db, tenantId, 'appointment', appointmentId)
  const combo = readComboSnapshot(db, tenantId, 'appointment', appointmentId)
  const zoneNames = zones.map((z) => z.name)
  const comboName = combo?.name ?? null
  if (combo) return { zoneNames, comboName, priceCents: combo.priceCents }
  if (zones.length > 0) {
    const prices = zones.map((z) => z.priceCents)
    const priceCents = prices.every((p) => p != null)
      ? prices.reduce<number>((n, p) => n + (p ?? 0), 0)
      : null
    return { zoneNames, comboName: null, priceCents }
  }
  const row = db.get<{ price_cents: number | null }>(
    'SELECT price_cents FROM services WHERE tenant_id = ? AND id = ?',
    tenantId,
    serviceId,
  )
  return { zoneNames: [], comboName: null, priceCents: row?.price_cents ?? null }
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
  const gb = db.get<{ google_business_url: string | null }>(
    'SELECT google_business_url FROM clinic_settings WHERE tenant_id = ?',
    input.tenantId,
  )
  const upcoming = loadUpcomingAppointments(db, input.tenantId, input.contactId, clock.nowMs(), 20)
  return {
    firstName: clientWebFirstName(contact.display_name),
    timezone: tz?.timezone ?? 'America/Sao_Paulo',
    locationUrl: gb?.google_business_url?.trim() || null,
    appointments: upcoming.map((a) => {
      const pro = db.get<{ name: string | null }>(
        'SELECT name FROM resources WHERE tenant_id = ? AND id = ?',
        input.tenantId,
        a.professionalId,
      )
      const visit = visitCardFields(db, input.tenantId, a.id, a.serviceId)
      return {
        id: a.id,
        serviceName: a.serviceName,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        serviceId: a.serviceId,
        professionalId: a.professionalId,
        professionalName: pro?.name?.trim() || 'Profissional',
        hasPaidSignal: hasPaidSignal(db, input.tenantId, a.id),
        zoneNames: visit.zoneNames,
        comboName: visit.comboName,
        priceCents: visit.priceCents,
      }
    }),
  }
}
