/**
 * Quando curto partilhado (DEC-174 WhatsApp Agendado + push de agendamento).
 * Sem ano, sem hora de fim, sem «em …-feira», sem IANA no texto.
 */
import { clinicCivilDateFromUtc } from './timezone'

const WEEKDAY_LABEL = [
  '',
  'segunda',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sábado',
  'domingo',
] as const

function weekdayOfCivil(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return js === 0 ? 7 : js
}

function hhmmInZone(timeZone: string, utcMs: number): string {
  const hhmm = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(utcMs))
  const match = hhmm.match(/(\d{1,2})\D(\d{2})/)
  return match ? `${match[1]!.padStart(2, '0')}:${match[2]}` : hhmm
}

/**
 * Forma: `terça 17/11 às 10:00` (relógio da clínica).
 * Sem «hoje»/«amanhã» — o push e a mensagem Agendado usam weekday+DD/MM.
 */
export function formatBookedWhenAt(timezone: string, startsAt: number): string {
  try {
    const civil = clinicCivilDateFromUtc(timezone, startsAt)
    const [, month, day] = civil.split('-')
    const weekday = WEEKDAY_LABEL[weekdayOfCivil(civil)] ?? ''
    const time = hhmmInZone(timezone, startsAt)
    return `${weekday} ${day}/${month} às ${time}`
  } catch {
    return new Date(startsAt).toISOString()
  }
}
