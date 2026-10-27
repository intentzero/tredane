import type { OpportunityStage } from '../../api'
import { getClinicTimezone } from '../../clinicTimezone'

export const STAGE_ORDER: OpportunityStage[] = [
  'novo_contato',
  'em_atendimento',
  'horario_proposto',
  'agendado',
  'concluido',
  'perdido',
]

export const STAGE_LABELS: Record<OpportunityStage, string> = {
  novo_contato: 'Novo contato',
  em_atendimento: 'Em atendimento',
  horario_proposto: 'Horário proposto',
  agendado: 'Agendado',
  concluido: 'Concluído',
  perdido: 'Perdido',
}

/** Abas curtas no mobile (M-05). */
export const STAGE_TAB_LABELS: Record<OpportunityStage, string> = {
  novo_contato: 'Novo',
  em_atendimento: 'Em atendimento',
  horario_proposto: 'Horário proposto',
  agendado: 'Agendado',
  concluido: 'Concluído',
  perdido: 'Perdido',
}

export function contactLabel(displayName: string | null, waId: string): string {
  const name = displayName?.trim()
  if (name) return name
  if (waId.length >= 4) return `+${waId.slice(0, 2)} …${waId.slice(-4)}`
  return waId || 'Contato'
}

export function relativeTime(ms: number | null): string {
  if (ms == null) return '—'
  const delta = Date.now() - ms
  if (delta < 60_000) return 'agora'
  if (delta < 3_600_000) return `há ${Math.floor(delta / 60_000)} min`
  if (delta < 86_400_000) return `há ${Math.floor(delta / 3_600_000)} h`
  if (delta < 2 * 86_400_000) return 'ontem'
  return new Date(ms).toLocaleDateString('pt-BR', {
    timeZone: getClinicTimezone(),
    day: '2-digit',
    month: 'short',
  })
}

export function appointmentLine(
  startsAt: number | null | undefined,
  missing: boolean,
): string {
  if (missing || startsAt == null) return 'Sem horário marcado'
  return new Date(startsAt).toLocaleString('pt-BR', {
    timeZone: getClinicTimezone(),
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
