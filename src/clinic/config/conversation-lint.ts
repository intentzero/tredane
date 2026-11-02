/**
 * Lint de configuração para percursos sem saída na conversa (M7 / #418, DEC-112).
 * Avisos **informativos** na M-52: não alteram `ready` nem pausam a IA.
 */
import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'
import { listEffectiveWeeklyWindows } from './availability'
import { listResources } from './resources'
import { listServices } from './services'
import { activeRoomsForService } from '../scheduling/query'
import type { ServiceRow, WeeklyWindowRow } from './types'

export type ConversationLintCode =
  | 'no_professional'
  | 'line_without_variants'
  | 'percent_signal_without_price'
  | 'window_outside_hours'
  | 'room_without_hours'

export type ConversationLintFinding = {
  code: ConversationLintCode
  /** Frase em português para a owner (DEC-112). */
  message: string
}

export type ServiceConversationLint = {
  serviceId: string
  serviceName: string
  findings: ConversationLintFinding[]
}

const MSG: Record<ConversationLintCode, string> = {
  no_professional: 'Nenhuma profissional faz este serviço — a conversa não consegue marcar.',
  line_without_variants:
    'A linha pede variantes, mas nenhuma está ativa — a conversa não consegue marcar.',
  percent_signal_without_price:
    'Há sinal em percentagem sem preço nas variantes — a conversa não consegue fechar o valor.',
  window_outside_hours:
    'A janela deste serviço não cruza o expediente de nenhuma profissional — a conversa não encontra horário.',
  room_without_hours:
    'Este serviço pede sala, mas nenhuma sala ativa está disponível — a conversa não consegue marcar.',
}

function windowsOverlap(
  a: { dayOfWeek: number; startMinute: number; endMinute: number },
  b: { dayOfWeek: number; startMinute: number; endMinute: number },
): boolean {
  if (a.dayOfWeek !== b.dayOfWeek) return false
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute
}

function proWindowsForService(
  service: ServiceRow,
  pros: { id: string; active: boolean }[],
  windows: WeeklyWindowRow[],
): WeeklyWindowRow[] {
  const linked = new Set(
    service.professionalIds.length > 0
      ? service.professionalIds
      : pros.filter((p) => p.active).map((p) => p.id),
  )
  return windows.filter((w) => linked.has(w.resourceId))
}

/**
 * Percursos sem saída no grafo da clínica (DEC-112).
 * Não bloqueia a IA — só alimenta o aviso informativo na M-52.
 */
export function lintConversationPaths(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): ServiceConversationLint[] {
  const resources = listResources(db, tenantId, clock)
  const pros = resources.filter((r) => r.kind === 'professional')
  const windows = listEffectiveWeeklyWindows(db, tenantId)
  const services = listServices(db, tenantId).filter((s) => s.active)
  const out: ServiceConversationLint[] = []

  for (const service of services) {
    const findings: ConversationLintFinding[] = []
    const whoActive = pros.filter((p) => p.active && service.professionalIds.includes(p.id))

    if (whoActive.length === 0) {
      findings.push({ code: 'no_professional', message: MSG.no_professional })
    }

    if (service.variantKind?.trim()) {
      const activeZones = service.zones.filter((z) => z.active)
      if (activeZones.length === 0) {
        findings.push({ code: 'line_without_variants', message: MSG.line_without_variants })
      }
    }

    if (service.requiresSignal && service.signalKind === 'percent') {
      if (service.variantKind?.trim()) {
        const activeZones = service.zones.filter((z) => z.active)
        const unpriced = activeZones.filter((z) => z.priceCents == null || z.priceCents <= 0)
        if (activeZones.length > 0 && unpriced.length > 0) {
          findings.push({
            code: 'percent_signal_without_price',
            message: MSG.percent_signal_without_price,
          })
        }
      } else if (service.priceCents == null || service.priceCents <= 0) {
        findings.push({
          code: 'percent_signal_without_price',
          message: MSG.percent_signal_without_price,
        })
      }
    }

    const serviceWindows = service.weeklyWindows
    if (serviceWindows.length > 0 && whoActive.length > 0) {
      const proWins = proWindowsForService(service, pros, windows)
      const crosses = serviceWindows.some((sw) =>
        proWins.some((pw) => windowsOverlap(sw, pw)),
      )
      if (!crosses) {
        findings.push({ code: 'window_outside_hours', message: MSG.window_outside_hours })
      }
    }

    // DEC-075: salas não têm expediente. «Sala sem horário» (DEC-112) = sem sala
    // ativa utilizável no percurso da conversa.
    if (service.roomRequirement.mode === 'rooms') {
      const rooms = activeRoomsForService(db, tenantId, service, clock)
      if (rooms.length === 0) {
        findings.push({ code: 'room_without_hours', message: MSG.room_without_hours })
      }
    }

    if (findings.length > 0) {
      out.push({ serviceId: service.id, serviceName: service.name, findings })
    }
  }

  return out
}

/** Achados de um serviço (lista vazia = caminho ok). */
export function lintServiceConversationPath(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
  clock: Clock,
): ConversationLintFinding[] {
  return (
    lintConversationPaths(db, tenantId, clock).find((s) => s.serviceId === serviceId)?.findings
    ?? []
  )
}
