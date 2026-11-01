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
import { listEffectiveWeeklyWindows } from '../config/availability'
import { listResources } from '../config/resources'
import { listServices } from '../config/services'
import { ensureClinicSettings } from '../config/settings'
import type { ClinicDb } from '../store'
import { TEMPO_REFUSED_PHRASE, TEMPO_UNCONFIRMED_PHRASE } from '../proposals/render'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import { queryAvailability } from '../scheduling/query'
import { memoAdapter, queryAutomaticAvailability } from '../tempo/automatic'
import { evaluateServiceTempo, type ForecastAdapter } from '../tempo/evaluate'
import { readOpenMeteo } from '../tempo/open-meteo'
import { extractTimes } from './autobook'

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

/**
 * Faixas do expediente sem unir o almoço. 09:00–12:00 e 13:00–18:00 ficam as duas.
 * Sobreposição no mesmo dia junta-se; um vão no meio permanece.
 */
export function formatOpeningHours(
  windows: readonly { dayOfWeek: number; startMinute: number; endMinute: number }[],
): string[] {
  const byDow = new Map<number, { start: number; end: number }[]>()
  for (const w of windows) {
    const list = byDow.get(w.dayOfWeek) ?? []
    list.push({ start: w.startMinute, end: w.endMinute })
    byDow.set(w.dayOfWeek, list)
  }
  const lines: string[] = []
  for (let dow = 1; dow <= 7; dow++) {
    const name = WEEKDAYS[dow]!
    const raw = byDow.get(dow)
    if (!raw || raw.length === 0) {
      lines.push(`${name}: fechado`)
      continue
    }
    const sorted = [...raw].sort((a, b) => a.start - b.start || a.end - b.end)
    const merged: { start: number; end: number }[] = []
    for (const span of sorted) {
      const last = merged[merged.length - 1]
      if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
      else merged.push({ start: span.start, end: span.end })
    }
    lines.push(`${name}: ${merged.map((h) => `${hhmm(h.start)}–${hhmm(h.end)}`).join(' e ')}`)
  }
  return lines
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

/** Escolhe serviços citados nas mensagens; senão, os primeiros activos.
 * Com `serviceIdInPlay` (#411), restringe ao serviço do funil. */
export function pickServicesForSlots(
  services: Array<{ id: string; name: string }>,
  recentTexts: string[],
  serviceIdInPlay?: string | null,
): Array<{ id: string; name: string }> {
  if (serviceIdInPlay) {
    const hit = services.find((s) => s.id === serviceIdInPlay)
    if (hit) return [hit]
  }
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

export async function buildClinicAiContext(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  opts: {
    clinicName?: string | null
    contactId: string
    recentTexts: string[]
    forecast?: ForecastAdapter
    /** #411: reusa settings/catálogo e restringe horários ao serviço em jogo. */
    turn?: {
      settings: import('../config/types').ClinicSettingsRow
      catalog: { services: import('../config/types').ServiceRow[]; resources: import('../config/types').ResourceRow[] }
      serviceIdInPlay: string | null
    }
  },
): Promise<AiClinicContext> {
  const settings = opts.turn?.settings ?? ensureClinicSettings(db, tenantId, clock)
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
  const resources = opts.turn?.catalog.resources ?? listResources(db, tenantId, clock)
  const proIds = new Set(
    resources.filter((r) => r.kind === 'professional').map((r) => r.id),
  )
  const windows = listEffectiveWeeklyWindows(db, tenantId).filter((w) => proIds.has(w.resourceId))
  const openingHours = formatOpeningHours(
    windows.map((w) => ({
      dayOfWeek: w.dayOfWeek,
      startMinute: w.startMinute,
      endMinute: w.endMinute,
    })),
  )

  const active = opts.turn?.catalog.services ?? listServices(db, tenantId).filter((s) => s.active)
  const chosen = pickServicesForSlots(active, opts.recentTexts, opts.turn?.serviceIdInPlay)
  const mentioned = extractTimes(opts.recentTexts.join('\n'))
  const tempoNotes = new Set<string>()
  const forecast = memoAdapter(opts.forecast ?? { read: readOpenMeteo })
  const freeSlots: AiFreeSlotDay[] = []
  for (const svc of chosen) {
    for (let i = 0; i < AI_FREE_SLOT_DAYS; i++) {
      const date = addDays(today, i)
      let times: string[] = []
      try {
        const preview = queryAvailability(db, tenantId, { serviceId: svc.id, date }, clock)
        const r = await queryAutomaticAvailability(
          db,
          tenantId,
          { serviceId: svc.id, date },
          clock,
          forecast,
        )
        if (!r.schedulingAllowed) continue
        if (mentioned.size > 0) {
          const kept = new Set(r.slots.map((slot) => slot.startsAt))
          for (const slot of preview.slots) {
            if (slot.startsAt <= now) continue
            const label = formatClinicTime(tz, slot.startsAt)
            if (!mentioned.has(label) || kept.has(slot.startsAt)) continue
            const verdict = await evaluateServiceTempo(
              db,
              tenantId,
              { serviceId: svc.id, startsAt: slot.startsAt },
              forecast,
              clock,
            )
            if (verdict.outcome === 'nao_serve') tempoNotes.add(TEMPO_REFUSED_PHRASE)
            if (verdict.outcome === 'indisponivel') tempoNotes.add(TEMPO_UNCONFIRMED_PHRASE)
          }
        }
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
  const tempoNote = [
    tempoNotes.has(TEMPO_REFUSED_PHRASE) ? TEMPO_REFUSED_PHRASE : null,
    tempoNotes.has(TEMPO_UNCONFIRMED_PHRASE) ? TEMPO_UNCONFIRMED_PHRASE : null,
  ].filter((phrase): phrase is string => phrase != null).join(' ') || null

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
    googleBusinessUrl: settings.googleBusinessUrl || null,
    timezone: tz,
    nowLabel,
    today,
    openingHours: windows.length > 0 ? openingHours : [],
    freeSlots,
    tempoNote,
    upcomingAppointments,
    reschedulePolicy: settings.reschedulePolicy || null,
    cancellationPolicy: settings.signalCancellationPolicy || null,
    virtualAttendantName: settings.virtualAttendantName || null,
    virtualAttendantGender: settings.virtualAttendantGender,
  }
}
