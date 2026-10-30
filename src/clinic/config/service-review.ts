import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'
import { listEffectiveWeeklyWindows } from './availability'
import { listResources } from './resources'
import { listServices } from './services'
import { ensureClinicSettings } from './settings'
import { queryAvailability } from '../scheduling/query'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import { activeRoomsForService } from '../scheduling/query'

export type ServiceReviewItem = {
  serviceId: string
  serviceName: string
  active: boolean
  who: string[]
  whereLabel: string
  ready: boolean
  /** Motivo de bloqueio em português, gerado no servidor (DEC-085). */
  blockReason: string | null
  nextSlotStartsAt: number | null
  /** Atalho: secção da Clínica. */
  fix: {
    section: 'servico' | 'profissional' | 'sala' | 'horarios'
    entityId?: string
  }
}

export type ServiceReviewResult = {
  tenantId: string
  timezone: string
  asOf: number
  services: ServiceReviewItem[]
}

function addCivilDays(isoDate: string, days: number): string {
  const parts = isoDate.split('-').map(Number)
  const y = parts[0] ?? 0
  const m = parts[1] ?? 1
  const d = parts[2] ?? 1
  const utc = Date.UTC(y, m - 1, d) + days * 86_400_000
  const dt = new Date(utc)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/**
 * Conferir configuração (DEC-085 / M-52): por serviço, quem / onde / quando,
 * motivo de bloqueio e próximo horário — tudo no servidor, sem duplicar regras no cliente.
 */
export function reviewClinicServices(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): ServiceReviewResult {
  const asOf = clock.nowMs()
  const settings = ensureClinicSettings(db, tenantId, clock)
  const timezone = settings.timezone
  const today = clinicCivilDateFromUtc(timezone, asOf)
  const resources = listResources(db, tenantId, clock)
  const pros = resources.filter((r) => r.kind === 'professional')
  const services = listServices(db, tenantId).filter((s) => s.active)
  const windows = listEffectiveWeeklyWindows(db, tenantId)

  const out: ServiceReviewItem[] = []
  for (const service of services) {
    const who = pros
      .filter((p) => service.professionalIds.includes(p.id))
      .map((p) => ({ id: p.id, name: p.name, active: p.active }))
    const whoActive = who.filter((p) => p.active)
    const whoNames = whoActive.map((p) => p.name)

    let whereLabel = 'Sem espaço definido'
    if (service.roomRequirement.mode === 'rooms') {
      const rooms = activeRoomsForService(db, tenantId, service, clock)
      const listed = service.roomRequirement.resourceIds
        .map((id) => resources.find((r) => r.id === id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
      if (listed.length === 0) whereLabel = 'Nenhuma sala na lista'
      else if (rooms.length === 0) {
        whereLabel = listed.map((r) => `${r.name} (inativa)`).join(', ')
      } else {
        whereLabel = rooms.map((r) => r.name).sort((a, b) => a.localeCompare(b, 'pt-BR')).join(', ')
      }
    }

    let ready = true
    let blockReason: string | null = null
    let nextSlotStartsAt: number | null = null
    let fix: ServiceReviewItem['fix'] = { section: 'servico', entityId: service.id }

    if (whoActive.length === 0) {
      ready = false
      blockReason =
        who.length === 0
          ? 'Nenhuma profissional faz este serviço.'
          : 'As profissionais deste serviço estão inativas.'
      fix = { section: 'servico', entityId: service.id }
    } else if (service.roomRequirement.mode === 'rooms') {
      const rooms = activeRoomsForService(db, tenantId, service, clock)
      if (rooms.length === 0) {
        ready = false
        blockReason =
          'Todas as salas deste serviço estão inativas. Reative uma, escolha outra, ou passe a Sem espaço definido.'
        const first = service.roomRequirement.resourceIds[0]
        fix = first ? { section: 'sala', entityId: first } : { section: 'servico', entityId: service.id }
      }
    }

    if (ready) {
      const proIds = new Set(whoActive.map((p) => p.id))
      const hasHours = windows.some((w) => proIds.has(w.resourceId))
      if (!hasHours) {
        ready = false
        blockReason = 'As profissionais deste serviço estão sem horário.'
        fix = { section: 'horarios' }
      }
    }

    if (ready) {
      for (let i = 0; i < 14; i++) {
        const date = addCivilDays(today, i)
        const avail = queryAvailability(db, tenantId, { serviceId: service.id, date }, clock)
        if (avail.slots.length > 0) {
          nextSlotStartsAt = avail.slots[0]!.startsAt
          break
        }
      }
      if (nextSlotStartsAt == null) {
        ready = false
        blockReason =
          blockReason ??
          'Não há horário livre nos próximos 14 dias com as profissionais e salas deste serviço.'
        fix = { section: 'servico', entityId: service.id }
      }
    }

    out.push({
      serviceId: service.id,
      serviceName: service.name,
      active: service.active,
      who: whoNames,
      whereLabel,
      ready: ready && nextSlotStartsAt != null,
      blockReason: ready && nextSlotStartsAt != null ? null : blockReason,
      nextSlotStartsAt,
      fix,
    })
  }

  return { tenantId, timezone, asOf, services: out }
}
