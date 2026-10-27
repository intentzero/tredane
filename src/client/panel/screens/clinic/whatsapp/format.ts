/** «+551115336242» → «+55 11 1533-6242» (celular: «+55 11 91234-5678»). */
export function formatPhone(display: string | null | undefined): string {
  if (!display) return '—'
  const digits = display.replace(/\D/g, '')
  const br = digits.match(/^55(\d{2})(\d{4,5})(\d{4})$/)
  if (br) return `+55 ${br[1]} ${br[2]}-${br[3]}`
  return display
}

import { getClinicTimezone } from '../../../clinicTimezone'

/** «27/10 às 12:35»; com o ano quando não é o ano atual. */
export function formatWhen(
  ms: number | null | undefined,
  now: number = Date.now(),
): string {
  if (ms == null) return '—'
  try {
    const parts = new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: getClinicTimezone(),
    }).formatToParts(new Date(ms))
    const get = (t: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === t)?.value ?? ''
    const thisYear = new Intl.DateTimeFormat('pt-BR', {
      year: 'numeric',
      timeZone: getClinicTimezone(),
    }).format(new Date(now))
    const date = `${get('day')}/${get('month')}${get('year') === thisYear ? '' : `/${get('year')}`}`
    return `${date} às ${get('hour')}:${get('minute')}`
  } catch {
    return new Date(ms).toISOString()
  }
}

/** «por você» / «pela equipe do Tredane» / «por um responsável da clínica» — nunca o ID. */
export function connectedByLabel(
  actorId: string | null | undefined,
  viewerId: string | null | undefined,
): string {
  if (!actorId) return 'por um responsável da clínica'
  if (viewerId && actorId === viewerId) return 'por você'
  if (actorId.startsWith('system:')) return 'pela equipe do Tredane'
  return 'por um responsável da clínica'
}

export function historyLabel(action: string): string {
  switch (action) {
    case 'connected':
    case 'connected_replace':
    case 'reconnected_new_number':
      return 'Conectado'
    case 'reconnected':
      return 'Reconectado'
    case 'disconnected':
      return 'Desconectado'
    case 'interrupted':
      return 'Conexão interrompida'
    case 'replaced_released':
    case 'released_for_reconnect':
      return 'Número anterior liberado'
    case 'connect_rejected_phone_in_use':
      return 'Este número já está conectado a outra clínica'
    default:
      return action
  }
}

/** «lembrete_horario» → «Lembrete horario» (nome legível; o técnico fica pequeno embaixo). */
export function templateTitle(name: string): string {
  const text = name.replace(/[_-]+/g, ' ').trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : name
}

/** Status da Meta → palavra de recepcionista + tom do selo. */
export function templateStatus(status: string): {
  label: string
  tone: 'open' | 'wait' | 'bad' | 'closed'
} {
  switch (status.toUpperCase()) {
    case 'APPROVED':
      return { label: 'Aprovado', tone: 'open' }
    case 'PENDING':
    case 'IN_REVIEW':
    case 'IN_APPEAL':
      return { label: 'Em análise', tone: 'wait' }
    case 'REJECTED':
      return { label: 'Recusado', tone: 'bad' }
    case 'PAUSED':
    case 'DISABLED':
      return { label: 'Pausado', tone: 'closed' }
    default:
      return { label: 'Em análise', tone: 'wait' }
  }
}
