/**
 * Respostas de catálogo sem modelo: preço com duração, expediente com o vão,
 * quem faz e a sala, zona antes do horário, soma com o intervalo.
 */
import { formatBRL } from '../../ai/prompt'
import type { Clock } from '../../db/clock'
import { listEffectiveWeeklyWindows } from '../config/availability'
import { listResources } from '../config/resources'
import { listServices } from '../config/services'
import type { ServiceRow } from '../config/types'
import { zonesNamedInText } from '../config/zones'
import type { ClinicDb } from '../store'
import { formatOpeningHours } from './schedule-context'

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

/** Texto determinístico, ou null para seguir o modelo / a proposta. */
export function catalogReply(db: ClinicDb, tenantId: string, text: string, clock: Clock): string | null {
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

  if (!PRICE.test(body) && !(PERIOD.test(body) && !CLOCK.test(body))) return null

  const svc = targets.find((s) => s.zones.some((z) => z.active)) ?? targets[0]
  if (!svc) return null
  const active = svc.zones.filter((z) => z.active)
  const named = active.length > 0 ? zonesNamedInText(body, active) : []

  if (active.length > 0 && named.length === 0 && (PRICE.test(body) || (PERIOD.test(body) && !CLOCK.test(body)))) {
    const kind = svc.variantKindPlural?.trim() || svc.variantKind?.trim() || 'variante'
    const options = active.map((z) => z.name).join(', ')
    return `Para ${svc.name}, qual ${kind} você quer? Temos ${options}.`
  }

  if (PRICE.test(body) && named.length === 1) {
    const z = named[0]!
    const price = z.priceCents == null ? 'a equipe confirma o valor' : formatBRL(z.priceCents)
    return `${z.name} custa ${price} e dura ${z.durationMinutes} min.`
  }

  if (PRICE.test(body) && named.length >= 2) {
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

  if (!PRICE.test(body) && active.length === 0 && PERIOD.test(body) && !CLOCK.test(body)) return null
  return null
}
