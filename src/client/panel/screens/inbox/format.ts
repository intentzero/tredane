import type { InboxConversation, InboxFilter } from '../../api'
import type { BadgeTone } from '../../states/Badge'

export function contactLabel(c: { displayName: string | null; waId: string }): string {
  if (c.displayName?.trim()) return c.displayName.trim()
  return maskPhone(c.waId)
}

export function maskPhone(waId: string): string {
  const digits = waId.replace(/\D/g, '')
  if (digits.length < 4) return waId
  const last = digits.slice(-4)
  return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} 9••••-${last}`
}

export function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '#'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
}

/**
 * Hora da última mensagem na lista (estilo WhatsApp, no fuso da clínica):
 * «agora», «N min» (< 1 h), «14:05» (hoje), «ontem», «seg.» (últimos 7 dias),
 * «12/10» (este ano) ou «12/10/25».
 */
export function relativeTime(ms: number | null, now = Date.now()): string {
  if (ms == null) return ''
  const diff = Math.max(0, now - ms)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min} min`
  const timeZone = getClinicTimezone()
  const day = civilDay(ms)
  if (day === civilDay(now)) {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(ms))
  }
  if (day === civilDay(now - 86_400_000)) return 'ontem'
  if (diff < 6 * 86_400_000) {
    return new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'short' }).format(new Date(ms))
  }
  const sameYear =
    new Intl.DateTimeFormat('en', { timeZone, year: 'numeric' }).format(new Date(ms)) ===
    new Intl.DateTimeFormat('en', { timeZone, year: 'numeric' }).format(new Date(now))
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    ...(sameYear ? {} : { year: '2-digit' as const }),
  }).format(new Date(ms))
}

export function statusLabel(status: InboxConversation['status']): string {
  switch (status) {
    case 'new':
      return 'Nova'
    case 'open':
      return 'Em atendimento'
    case 'closed':
      return 'Encerrada'
  }
}

export function statusTone(status: InboxConversation['status']): BadgeTone {
  switch (status) {
    case 'new':
      return 'new'
    case 'open':
      return 'open'
    case 'closed':
      return 'closed'
  }
}

export function filterLabel(filter: InboxFilter): string {
  switch (filter) {
    case 'all':
      return 'Todas'
    case 'new':
      return 'Novas'
    case 'mine':
      return 'Minhas'
    case 'unassigned':
      return 'Sem responsável'
    case 'closed':
      return 'Encerradas'
  }
}

export function assigneeLine(
  c: InboxConversation,
  viewerId: string | null,
): string {
  if (!c.assigneeClerkUserId) return 'Sem responsável'
  if (viewerId && c.assigneeClerkUserId === viewerId) {
    return c.assigneeDisplayName ? `Você` : 'Você'
  }
  return c.assigneeDisplayName ?? 'Membro da equipe'
}

export function previewLine(c: InboxConversation, viewerId: string | null): string {
  const preview = c.lastMessagePreview ?? ''
  if (c.lastMessageDirection === 'outbound') {
    const mine =
      viewerId && c.assigneeClerkUserId === viewerId ? 'Você' : c.assigneeDisplayName ?? 'Equipe'
    return `${mine}: ${preview}`
  }
  return preview
}

/** Rótulos §6.1 ux-ui.md — nunca expor raw deliveryState ao usuário. */
export function deliveryLabel(state: string): string {
  switch (state) {
    case 'pending':
      return 'Enviando…'
    case 'accepted':
      return 'Enviada'
    case 'delivered':
      return 'Entregue'
    case 'read':
      return 'Lida'
    case 'failed':
      return 'Não enviada'
    case 'unknown':
      return 'Verificando envio…'
    case 'received':
      return 'Recebida'
    default:
      return state
  }
}

/** Cor estável do avatar (1 a 4) a partir do nome, para distinguir pessoas de relance. */
export function avatarTone(label: string): 1 | 2 | 3 | 4 {
  let h = 0
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ((h % 4) + 1) as 1 | 2 | 3 | 4
}

import { getClinicTimezone } from '../../clinicTimezone'

function civilDay(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: getClinicTimezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms))
}

/** «Hoje», «Ontem» ou «27 de outubro», no fuso da clínica. */
export function dayLabel(ms: number, now: number = Date.now()): string {
  const day = civilDay(ms)
  if (day === civilDay(now)) return 'Hoje'
  if (day === civilDay(now - 86_400_000)) return 'Ontem'
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: getClinicTimezone(),
    day: 'numeric',
    month: 'long',
  }).format(new Date(ms))
}

export function sameDay(a: number, b: number): boolean {
  return civilDay(a) === civilDay(b)
}

/** «Você pode responder livremente até hoje às 12:33.» */
export function windowHint(closesAt: number | null, now: number = Date.now()): string | null {
  if (closesAt == null || closesAt <= now) return null
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: getClinicTimezone(),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(closesAt))
  const when = civilDay(closesAt) === civilDay(now) ? 'hoje' : 'amanhã'
  return `Você pode responder livremente até ${when} às ${time}.`
}
