/**
 * Contexto de agenda/clínica para o rascunho da IA (aprovado por Paulo, 27/10/2026).
 * Leitura pura: consulta horários livres reais; nunca cria compromisso nem reserva.
 */
import type { Clock } from '../../db/clock'
import type {
  AiClinicContext,
  AiFreeSlotDay,
  AiUpcomingAppointment,
} from '../../ai/types'
import { listWeeklyWindows } from '../config/availability'
import { listResources } from '../config/resources'
import { listServices } from '../config/services'
import { ensureClinicSettings } from '../config/settings'
import type { ClinicDb } from '../store'
import { queryAvailability } from '../scheduling/query'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'

export const AI_FREE_SLOT_DAYS = 7
export const AI_FREE_SLOT_MAX_SERVICES = 3
export const AI_FREE_SLOT_MAX_PER_DAY = 12
/** Espaçamento mínimo entre horários listados (min), para não inundar o contexto. */
export const AI_FREE_SLOT_SPACING_MIN = 30

const WEEKDAYS = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

export function formatClinicTime(timeZone: string, utcMs: number): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(utcMs))
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}

function dayLabel(date: string, offset: number, dow: number): string {
  const [, m, d] = date.split('-')
  const rel = offset === 0 ? 'hoje, ' : offset === 1 ? 'amanhã, ' : ''
  return `${rel}${WEEKDAYS[dow]}-feira ${d}/${m}`.replace('sábado-feira', 'sábado').replace('domingo-feira', 'domingo')
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = domingo
  return js === 0 ? 7 : js
}

/** Escolhe serviços citados nas mensagens; senão, os primeiros activos. */
export function pickServicesForSlots(
  services: Array<{ id: string; name: string }>,
  recentTexts: string[],
): Array<{ id: string; name: string }> {
  const hay = norm(recentTexts.join(' \n '))
  // Pontua por palavras do nome citadas (ex.: «depilação masculina» > «depilação feminina»).
  const mentioned = services
    .map((s, i) => {
      const words = norm(s.name).split(/[^a-z0-9]+/).filter((w) => w.length >= 4)
      const hits = words.filter((w) => hay.includes(w)).length
      return { s, i, score: words.length ? hits / words.length : 0 }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.s)
  const list = mentioned.length > 0 ? mentioned : services
  return list.slice(0, AI_FREE_SLOT_MAX_SERVICES)
}

function thin(mins: number[]): number[] {
  const out: number[] = []
  for (const m of [...new Set(mins)].sort((a, b) => a - b)) {
    if (out.length === 0 || m - out[out.length - 1]! >= AI_FREE_SLOT_SPACING_MIN) out.push(m)
    if (out.length >= AI_FREE_SLOT_MAX_PER_DAY) break
  }
  return out
}

export function buildClinicAiContext(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  opts: {
    clinicName?: string | null
    contactId: string
    recentTexts: string[]
  },
): AiClinicContext {
  const settings = ensureClinicSettings(db, tenantId, clock)
  const tz = settings.timezone || 'America/Sao_Paulo'
  const now = clock.nowMs()
  const today = clinicCivilDateFromUtc(tz, now)

  const nowLabel = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(now))

  // Horário de funcionamento = união das janelas semanais dos profissionais
  // (salas/equipamentos não têm expediente — decisão 28/10/2026).
  const proIds = new Set(
    listResources(db, tenantId, clock)
      .filter((r) => r.kind === 'professional')
      .map((r) => r.id),
  )
  const windows = listWeeklyWindows(db, tenantId).filter((w) => proIds.has(w.resourceId))
  const byDow = new Map<number, { start: number; end: number }>()
  for (const w of windows) {
    const cur = byDow.get(w.dayOfWeek)
    byDow.set(w.dayOfWeek, {
      start: Math.min(cur?.start ?? w.startMinute, w.startMinute),
      end: Math.max(cur?.end ?? w.endMinute, w.endMinute),
    })
  }
  const openingHours: string[] = []
  for (let dow = 1; dow <= 7; dow++) {
    const h = byDow.get(dow)
    const name = WEEKDAYS[dow]!
    openingHours.push(h ? `${name}: ${hhmm(h.start)}–${hhmm(h.end)}` : `${name}: fechado`)
  }

  const active = listServices(db, tenantId).filter((s) => s.active)
  const chosen = pickServicesForSlots(active, opts.recentTexts)
  const freeSlots: AiFreeSlotDay[] = []
  for (const svc of chosen) {
    for (let i = 0; i < AI_FREE_SLOT_DAYS; i++) {
      const date = addDays(today, i)
      let times: string[] = []
      try {
        const r = queryAvailability(db, tenantId, { serviceId: svc.id, date }, clock)
        if (!r.schedulingAllowed) continue
        const mins = r.slots
          .filter((s) => s.startsAt > now)
          .map((s) => {
            const t = formatClinicTime(tz, s.startsAt)
            const [hh, mm] = t.split(':').map(Number) as [number, number]
            return hh * 60 + mm
          })
        times = thin(mins).map(hhmm)
      } catch {
        // Serviço sem recurso utilizável etc.: sem horários para ele.
        continue
      }
      if (times.length === 0) continue
      freeSlots.push({
        serviceName: svc.name,
        date,
        dayLabel: dayLabel(date, i, weekdayOf(date)),
        times,
      })
    }
  }

  const appts = db.all<{ starts_at: number; service_name: string | null }>(
    `SELECT a.starts_at AS starts_at, s.name AS service_name
     FROM appointments a
     LEFT JOIN services s ON s.tenant_id = a.tenant_id AND s.id = a.service_id
     WHERE a.tenant_id = ? AND a.contact_id = ? AND a.status = 'confirmed' AND a.starts_at > ?
     ORDER BY a.starts_at LIMIT 5`,
    tenantId,
    opts.contactId,
    now,
  )
  const upcomingAppointments: AiUpcomingAppointment[] = appts.map((a) => {
    const date = clinicCivilDateFromUtc(tz, a.starts_at)
    const [, m, d] = date.split('-')
    return {
      serviceName: a.service_name ?? 'Atendimento',
      when: `${WEEKDAYS[weekdayOf(date)]} ${d}/${m} às ${formatClinicTime(tz, a.starts_at)}`,
    }
  })

  return {
    name: opts.clinicName?.trim() || null,
    address: settings.clinicAddress || null,
    timezone: tz,
    nowLabel,
    today,
    openingHours: windows.length > 0 ? openingHours : [],
    freeSlots,
    upcomingAppointments,
    reschedulePolicy: settings.reschedulePolicy || null,
    cancellationPolicy: settings.signalCancellationPolicy || null,
  }
}
