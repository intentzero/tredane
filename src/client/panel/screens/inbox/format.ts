import type { InboxConversation, InboxFilter } from '../../api'

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

export function relativeTime(ms: number | null, now = Date.now()): string {
  if (ms == null) return ''
  const diff = Math.max(0, now - ms)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min} min`
  const hours = Math.floor(min / 60)
  if (hours < 24) {
    const d = new Date(ms)
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }
  const days = Math.floor(hours / 24)
  if (days === 1) return 'ontem'
  if (days < 7) {
    return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
  }
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
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

export function statusClass(status: InboxConversation['status']): string {
  switch (status) {
    case 'new':
      return 'inbox-badge inbox-badge-new'
    case 'open':
      return 'inbox-badge inbox-badge-open'
    case 'closed':
      return 'inbox-badge inbox-badge-closed'
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
