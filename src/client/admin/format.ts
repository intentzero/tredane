import type { AdminTenantRow, AdminTenantStatus, ChannelStatus } from './api'

/** Estado mostrado ao operador. «Em configuração» não existe no D1: é ativa sem nenhuma owner ativa. */
export type TenantDisplayState = 'active' | 'onboarding' | 'suspended' | 'pending_deletion'

export function tenantDisplayState(t: Pick<AdminTenantRow, 'status' | 'ownerCount'>): TenantDisplayState {
  if (t.status === 'suspended') return 'suspended'
  if (t.status === 'pending_deletion') return 'pending_deletion'
  return t.ownerCount === 0 ? 'onboarding' : 'active'
}

export const STATE_LABEL: Record<TenantDisplayState, string> = {
  active: 'Ativa',
  onboarding: 'Em configuração',
  suspended: 'Suspensa',
  pending_deletion: 'Exclusão pendente',
}

export const STATE_TONE: Record<TenantDisplayState, PillTone> = {
  active: 'ok',
  onboarding: 'info',
  suspended: 'warn',
  pending_deletion: 'bad',
}

export type PillTone = 'ok' | 'warn' | 'bad' | 'neutral' | 'info'

export const CHANNEL_LABEL: Record<ChannelStatus, string> = {
  connected: 'Ligado',
  pending: 'Pendente',
  error: 'Erro',
  not_connected: 'Não ligado',
  not_configured: 'Não configurado',
}

export const CHANNEL_TONE: Record<ChannelStatus, PillTone> = {
  connected: 'ok',
  pending: 'warn',
  error: 'bad',
  not_connected: 'neutral',
  not_configured: 'neutral',
}

const DATE = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

export function formatDate(ms: number): string {
  return DATE.format(new Date(ms))
}

/** Sem acentos e em minúsculas, para a busca por nome. */
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export type StateFilter = 'all' | TenantDisplayState

export const FILTERS: ReadonlyArray<{ id: StateFilter; label: string }> = [
  { id: 'all', label: 'Todas' },
  { id: 'active', label: 'Ativas' },
  { id: 'onboarding', label: 'Em configuração' },
  { id: 'suspended', label: 'Suspensas' },
  { id: 'pending_deletion', label: 'Exclusão pendente' },
]

export function isDeleted(status: AdminTenantStatus): boolean {
  return status === 'pending_deletion'
}
