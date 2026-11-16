import type {
  AdminTenantRow,
  AdminTenantStatus,
  ChannelStatus,
  ClinicHealth,
  HealthSituation,
  SupportItem,
  SupportPerson,
  SupportState,
} from './api'

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

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
const TIME = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
const DAY = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })

/** «14:12» se for hoje, senão «16/11 14:12» (fuso do operador). */
export function formatReading(ms: number, nowMs = Date.now()): string {
  const d = new Date(ms)
  return DAY.format(d) === DAY.format(new Date(nowMs)) ? TIME.format(d) : DATE_TIME.format(d).replace(',', '')
}

export const SITUATION_LABEL: Record<HealthSituation, string> = {
  critical: 'Crítico',
  attention: 'Atenção',
  normal: 'Normal',
  no_data: 'Sem dados',
  inactive: 'Inativa',
}

export const SITUATION_TONE: Record<HealthSituation, PillTone> = {
  critical: 'bad',
  attention: 'warn',
  normal: 'ok',
  no_data: 'neutral',
  inactive: 'neutral',
}

export const ALERT_LABEL: Record<string, string> = {
  'outbox.stale': 'Envios pendentes acima do limiar',
  'outbound.uncertain': 'Envios com estado incerto',
  'ai.failure': 'Jobs de IA falhados na última hora',
  'schema.mismatch': 'Schema fora de versão',
}

/** Motivos legíveis por que uma clínica precisa de atenção (alertas + sinais de falha). */
export function healthReasons(c: ClinicHealth): string[] {
  const out: string[] = []
  if (c.whatsapp.status === 'error') out.push('WhatsApp interrompido pela Meta')
  for (const a of c.alerts) out.push(`${ALERT_LABEL[a.kind] ?? a.kind}${a.value !== null ? ` (${a.value})` : ''}`)
  const n = c.counts
  if (n?.failedOutbox) out.push(`${n.failedOutbox} envio(s) falhado(s)`)
  if (n?.uncertainOutbound && !c.alerts.some((a) => a.kind === 'outbound.uncertain')) {
    out.push(`${n.uncertainOutbound} envio(s) com estado incerto`)
  }
  if (n?.llmJobsFailed1h && !c.alerts.some((a) => a.kind === 'ai.failure')) {
    out.push(`${n.llmJobsFailed1h} job(s) de IA falhado(s) na última hora`)
  }
  return out
}

export const SUPPORT_LABEL: Record<SupportState, string> = {
  awaiting_owner: 'Aguarda owner',
  approved: 'Aprovado',
  active: 'Ativa',
  session_expired: 'Expirou',
  ended: 'Encerrada',
  revoked: 'Revogada',
  rejected: 'Rejeitado',
  request_expired: 'Pedido expirou',
  cancelled: 'Cancelado',
}

export const SUPPORT_TONE: Record<SupportState, PillTone> = {
  awaiting_owner: 'warn',
  approved: 'ok',
  active: 'info',
  session_expired: 'neutral',
  ended: 'neutral',
  revoked: 'bad',
  rejected: 'bad',
  request_expired: 'neutral',
  cancelled: 'neutral',
}

/** Estados em que o pedido ainda anda (filtro «Abertos»). */
export const SUPPORT_OPEN: readonly SupportState[] = ['awaiting_owner', 'approved', 'active']

export const personLabel = (p: SupportPerson | null): string => p?.displayName || p?.email || p?.clerkUserId || '—'

/** «18 min», «2 h», «21 h» — arredonda para cima nos minutos e para baixo nas horas. */
export function formatSpan(ms: number): string {
  const min = Math.ceil(ms / 60_000)
  if (min < 60) return `${Math.max(1, min)} min`
  return `${Math.floor(ms / 3_600_000)} h`
}

/** Linha secundária do estado: quem decidiu ou quem encerrou, e quando. */
export function supportDetail(i: SupportItem): string | null {
  if (i.state === 'approved' || i.state === 'rejected') {
    return i.decider ? `por ${personLabel(i.decider)}${i.decidedAt ? `, ${formatReading(i.decidedAt)}` : ''}` : null
  }
  if (i.state === 'revoked') return i.revokedBy ? `por ${personLabel(i.revokedBy)}` : null
  if (i.state === 'ended') return 'pelo operador'
  return null
}

/** Prazo ou duração conforme o estado. */
export function supportTiming(i: SupportItem): string {
  if (i.state === 'awaiting_owner' && i.remainingMs !== null) return `expira em ${formatSpan(i.remainingMs)}`
  if (i.state === 'active' && i.remainingMs !== null) return `restam ${formatSpan(i.remainingMs)}`
  if (i.durationMs !== null) return formatSpan(i.durationMs)
  return '—'
}
