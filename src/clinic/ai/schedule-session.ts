/**
 * Sessão de agendamento da conversa: serviço, linha, dia e período.
 * Não é atributo do contacto e não se infere pelo nome, pelo histórico nem por marcações.
 */
import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'

export type ScheduleAudienceLine = 'feminino' | 'masculino'

export type ScheduleDayLabel =
  | 'hoje'
  | 'amanhã'
  | 'depois de amanhã'
  | 'segunda'
  | 'terça'
  | 'quarta'
  | 'quinta'
  | 'sexta'
  | 'sábado'
  | 'domingo'

export type SchedulePeriod = 'manha' | 'tarde' | 'noite'

export type ScheduleSession = {
  serviceId: string
  audienceLine: ScheduleAudienceLine | null
  dayLabel: ScheduleDayLabel | null
  period: SchedulePeriod | null
}

/** Campo omitido mantém o valor já gravado. `null` limpa. Trocar o serviço limpa a linha. */
export type ScheduleSessionPatch = {
  serviceId: string
  audienceLine?: ScheduleAudienceLine | null
  dayLabel?: ScheduleDayLabel | null
  period?: SchedulePeriod | null
}

type SessionSql = {
  service_id: string
  audience_line: string | null
  day_label: string | null
  period: string | null
}

const DAY_LABELS = new Set<ScheduleDayLabel>([
  'hoje',
  'amanhã',
  'depois de amanhã',
  'segunda',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sábado',
  'domingo',
])

function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function asLine(value: string | null): ScheduleAudienceLine | null {
  return value === 'feminino' || value === 'masculino' ? value : null
}

function asDay(value: string | null): ScheduleDayLabel | null {
  return value != null && DAY_LABELS.has(value as ScheduleDayLabel) ? (value as ScheduleDayLabel) : null
}

function asPeriod(value: string | null): SchedulePeriod | null {
  return value === 'manha' || value === 'tarde' || value === 'noite' ? value : null
}

/**
 * Dia e período ditos numa frase. Dois dias ou dois períodos ficam de fora.
 * «mais tarde» não é o período da tarde.
 */
export function scheduleFactsFromText(text: string): {
  dayLabel?: ScheduleDayLabel
  period?: SchedulePeriod
} {
  let scan = fold(text)
  const days: ScheduleDayLabel[] = []
  if (/\bdepois de amanha\b/.test(scan)) {
    days.push('depois de amanhã')
    scan = scan.replace(/\bdepois de amanha\b/g, ' ')
  }
  const dayRules: Array<[RegExp, ScheduleDayLabel]> = [
    [/\bamanha\b/, 'amanhã'],
    [/\bhoje\b/, 'hoje'],
    [/\bsegunda\b/, 'segunda'],
    [/\bterca\b/, 'terça'],
    [/\bquarta\b/, 'quarta'],
    [/\bquinta\b/, 'quinta'],
    [/\bsexta\b/, 'sexta'],
    [/\bsabado\b/, 'sábado'],
    [/\bdomingo\b/, 'domingo'],
  ]
  for (const [re, label] of dayRules) {
    if (re.test(scan)) days.push(label)
  }
  const forPeriod = fold(text).replace(/\bmais tarde\b/g, ' ')
  const periods: SchedulePeriod[] = []
  if (/\bmanha\b/.test(forPeriod)) periods.push('manha')
  if (/\btarde\b/.test(forPeriod)) periods.push('tarde')
  if (/\bnoite\b/.test(forPeriod)) periods.push('noite')
  const out: { dayLabel?: ScheduleDayLabel; period?: SchedulePeriod } = {}
  if (days.length === 1) out.dayLabel = days[0]
  if (periods.length === 1) out.period = periods[0]
  return out
}

export function getScheduleSession(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): ScheduleSession | null {
  const row = db.get<SessionSql>(
    `SELECT service_id, audience_line, day_label, period FROM schedule_sessions
     WHERE tenant_id = ? AND conversation_id = ?`,
    tenantId,
    conversationId,
  )
  if (!row) return null
  return {
    serviceId: row.service_id,
    audienceLine: asLine(row.audience_line),
    dayLabel: asDay(row.day_label),
    period: asPeriod(row.period),
  }
}

export function saveScheduleSession(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  patch: ScheduleSessionPatch,
  clock: Clock,
): void {
  const existing = getScheduleSession(db, tenantId, conversationId)
  const serviceChanged = existing != null && existing.serviceId !== patch.serviceId
  const audienceLine =
    patch.audienceLine !== undefined ? patch.audienceLine : serviceChanged ? null : (existing?.audienceLine ?? null)
  const dayLabel = patch.dayLabel !== undefined ? patch.dayLabel : (existing?.dayLabel ?? null)
  const period = patch.period !== undefined ? patch.period : (existing?.period ?? null)
  const now = clock.nowMs()
  db.run(
    `INSERT INTO schedule_sessions (
       tenant_id, conversation_id, service_id, audience_line, day_label, period, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, conversation_id) DO UPDATE SET
       service_id = excluded.service_id,
       audience_line = excluded.audience_line,
       day_label = excluded.day_label,
       period = excluded.period,
       updated_at = excluded.updated_at`,
    tenantId,
    conversationId,
    patch.serviceId,
    audienceLine,
    dayLabel,
    period,
    now,
  )
}

/** Grava a linha explícita, ou null enquanto a pergunta ainda não foi respondida. Mantém dia e período. */
export function saveScheduleLine(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  serviceId: string,
  audienceLine: ScheduleAudienceLine | null,
  clock: Clock,
): void {
  saveScheduleSession(db, tenantId, conversationId, { serviceId, audienceLine }, clock)
}
