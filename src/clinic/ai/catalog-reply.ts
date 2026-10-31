/**
 * Respostas de catálogo sem modelo: preço com duração, expediente com o vão,
 * quem faz e a sala, zona antes do horário, soma com o intervalo.
 */
import { formatBRL } from '../../ai/prompt'
import type { Clock } from '../../db/clock'
import { currentClientTurnText, explicitAudienceLine } from '../catalog/audience'
import { listEffectiveWeeklyWindows } from '../config/availability'
import { listResources } from '../config/resources'
import { listServices } from '../config/services'
import type { ServiceRow } from '../config/types'
import { zonesNamedInText } from '../config/zones'
import { listMessages } from '../inbox/messages'
import type { ClinicDb } from '../store'
import { formatOpeningHours } from './schedule-context'
import { getScheduleSession, saveScheduleLine, type ScheduleSession } from './schedule-session'
import {
  audienceLineQuestion,
  needsAudienceLine,
  variantListQuestion,
  zonesForAudienceLine,
} from './variant-line'

const HOURS = /\b(hor[aá]rio de funcionamento|que horas (voc[eê]s )?(abrem|funcionam|atendem)|at[eé] que horas)\b/i
const WHO = /\b(quem faz|quem atende|qual sala|em qual sala)\b/i
const PRICE = /\b(pre[cç]o|custa|valor|quanto)\b/i
const PERIOD = /\b(amanh[aã]|hoje|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|manh[aã]|tarde|noite)\b/i
const CLOCK = /\b(\d{1,2}[:h]\d{2}|\d{3,4}|[aà]s\s+\d{1,2})\b/i

function roomNames(db: ClinicDb, tenantId: string, service: ServiceRow, clock: Clock): string[] {
  if (service.roomRequirement.mode !== 'rooms') return []
  const resources = listResources(db, tenantId, clock)
  return service.roomRequirement.resourceIds
    .map((id) => resources.find((r) => r.id === id)?.name)
    .filter((n): n is string => Boolean(n))
}

function proNames(db: ClinicDb, tenantId: string, service: ServiceRow, clock: Clock): string[] {
  const resources = listResources(db, tenantId, clock)
  return service.professionalIds
    .map((id) => resources.find((r) => r.id === id)?.name)
    .filter((n): n is string => Boolean(n))
}

function poolFor(services: ServiceRow[], text: string): ServiceRow[] {
  const named = services.filter((s) => text.toLowerCase().includes(s.name.trim().toLowerCase()))
  if (named.length > 0) return named
  return services.length === 1 ? services : services
}

function namedServices(services: ServiceRow[], text: string): ServiceRow[] {
  const folded = text.toLowerCase()
  return services.filter((service) => {
    const name = service.name.trim().toLowerCase()
    return name.length > 0 && folded.includes(name)
  })
}

function serviceForVariants(
  services: ServiceRow[],
  source: string,
  session: ScheduleSession | null,
  fallback: ServiceRow | undefined,
): ServiceRow | undefined {
  const named = namedServices(services, source)
  if (named.length > 0) return named.find((service) => service.zones.some((zone) => zone.active)) ?? named[0]
  if (session) {
    const held = services.find((service) => service.id === session.serviceId)
    if (held) return held
  }
  return fallback
}

function clientSource(db: ClinicDb, tenantId: string, body: string, conversationId?: string): string {
  if (!conversationId) return body
  const { messages } = listMessages(db, tenantId, { conversationId, limit: 40 })
  const turn = currentClientTurnText(messages.map((message) => ({ direction: message.direction, body: message.body })))
  return turn.trim() || body
}

/** Texto determinístico, ou null para seguir o modelo / a proposta. */
export function catalogReply(
  db: ClinicDb,
  tenantId: string,
  text: string,
  clock: Clock,
  opts: { conversationId?: string } = {},
): string | null {
  const body = text.trim()
  if (!body) return null
  const services = listServices(db, tenantId).filter((s) => s.active)
  if (HOURS.test(body) && !PRICE.test(body)) {
    const pros = new Set(
      listResources(db, tenantId, clock)
        .filter((r) => r.kind === 'professional')
        .map((r) => r.id),
    )
    const lines = formatOpeningHours(
      listEffectiveWeeklyWindows(db, tenantId)
        .filter((w) => pros.has(w.resourceId))
        .map((w) => ({ dayOfWeek: w.dayOfWeek, startMinute: w.startMinute, endMinute: w.endMinute })),
    )
    return `Funcionamos assim:\n${lines.join('\n')}`
  }

  const source = clientSource(db, tenantId, body, opts.conversationId)
  const session = opts.conversationId ? getScheduleSession(db, tenantId, opts.conversationId) : null
  const explicit = explicitAudienceLine(source)
  const targets = poolFor(services, body)
  const who = WHO.test(body)
  if (who) {
    const lines = targets.map((s) => {
      const people = proNames(db, tenantId, s, clock)
      const rooms = roomNames(db, tenantId, s, clock)
      const whoText = people.length > 0 ? people.join(', ') : 'a equipe confirma quem atende'
      const where = rooms.length > 0 ? rooms.join(' ou ') : 'sem sala definida'
      return `${s.name}: ${whoText}, na ${where}.`
    })
    return lines.join('\n')
  }

  const fallback = targets.find((service) => service.zones.some((zone) => zone.active)) ?? targets[0]
  const svc = serviceForVariants(services, source, session, fallback)
  if (opts.conversationId && svc && explicit && (session?.serviceId !== svc.id || session.audienceLine !== explicit)) {
    saveScheduleLine(db, tenantId, opts.conversationId, svc.id, explicit, clock)
  }

  const asksPrice = PRICE.test(source)
  const openPeriod = PERIOD.test(source) && !CLOCK.test(source)
  const lineOnly = explicit != null && !asksPrice && !PERIOD.test(source) && !CLOCK.test(source)
  if (!asksPrice && !openPeriod && !lineOnly) return null

  if (!svc) return null
  const active = svc.zones.filter((zone) => zone.active)
  const carried = session?.serviceId === svc.id ? session.audienceLine : null
  const line = needsAudienceLine(active) ? (explicit ?? carried) : null
  const scoped = needsAudienceLine(active) ? zonesForAudienceLine(active, line) : active
  const named = scoped.length > 0 ? zonesNamedInText(source, scoped) : []

  if (active.length > 0 && needsAudienceLine(active) && !line) {
    if (opts.conversationId && (!session || session.serviceId !== svc.id || session.audienceLine != null)) {
      saveScheduleLine(db, tenantId, opts.conversationId, svc.id, null, clock)
    }
    return audienceLineQuestion(svc.name)
  }

  if (active.length > 0 && named.length === 0 && (asksPrice || openPeriod || lineOnly)) {
    const pool = scoped.length > 0 ? scoped : active
    return variantListQuestion(svc.name, svc.variantKind, pool)
  }

  if (asksPrice && named.length === 1) {
    const z = named[0]!
    const price = z.priceCents == null ? 'a equipe confirma o valor' : formatBRL(z.priceCents)
    return `${z.name} custa ${price} e dura ${z.durationMinutes} min.`
  }

  if (asksPrice && named.length >= 2) {
    const genders = new Set(named.map((z) => z.audience))
    if (genders.has('feminino') && genders.has('masculino')) {
      return 'Masculino e feminino não entram na mesma visita. Escolha um conjunto compatível.'
    }
    const minutes = named.reduce((n, z) => n + z.durationMinutes, 0)
    const missing = named.some((z) => z.priceCents == null)
    const cents = named.reduce((n, z) => n + (z.priceCents ?? 0), 0)
    const price = missing ? 'a equipe confirma o valor' : formatBRL(cents)
    const buffer =
      svc.bufferMinutes > 0
        ? ` O intervalo de ${svc.bufferMinutes} min ocupa a agenda depois do atendimento.`
        : ''
    return `Juntas, ficam ${price} e ${minutes} min de atendimento.${buffer}`
  }

  if (!asksPrice && active.length === 0 && openPeriod) return null
  return null
}
