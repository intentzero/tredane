/**
 * TEL-05 / M-04 — regras puras do redesenho do Agendar (Proposto, Paulo 27/10/2026).
 * DEC-051–058 Confirmados (card t1868s7504) (docs/product/agendar-em-aberto.md).
 */
import type { AvailabilitySlot } from '../../api'
import type { PanelRoute } from '../../routes'
import { formatSlotTime } from './format'

export type ScheduleContext = {
  conversationId?: string
  contactId?: string
  opportunityId?: string
  alertId?: string
  /** Dia civil pré-escolhido (vem da Agenda). */
  date?: string
}

/** Horizonte do «Ver calendário» (DEC-054 Confirmado: 60 dias no MVP). */
export const CALENDAR_HORIZON_DAYS = 60
/** Horizonte do «Próximo livre» (DEC-055 Confirmado: 14 dias). */
export const NEXT_FREE_HORIZON_DAYS = 14
/** Dias visíveis na grade (5 colunas). */
export const DAY_GRID_SIZE = 5

/** Motivos rápidos para «Confirmar sem sinal» (DEC-047). Lista fixa no staging. */
export const WAIVE_REASONS = ['Paciente frequente', 'Pagará na clínica', 'Outro'] as const

export function slotKey(s: Pick<AvailabilitySlot, 'startsAt' | 'professionalId' | 'roomResourceId'>): string {
  return `${s.startsAt}:${s.professionalId}:${s.roomResourceId ?? ''}`
}

/**
 * Um botão por hora: com «Qualquer», várias profissionais/salas podem ter o
 * mesmo início; fica a primeira opção devolvida pela API (DEC-056 Confirmado: sala só na revisão e no rodapé).
 */
export function uniqueTimes(slots: AvailabilitySlot[]): AvailabilitySlot[] {
  const seen = new Set<number>()
  const out: AvailabilitySlot[] = []
  for (const s of [...slots].sort((a, b) => a.startsAt - b.startsAt)) {
    if (seen.has(s.startsAt)) continue
    seen.add(s.startsAt)
    out.push(s)
  }
  return out
}

/** «2 de 3» / «último lugar» para horário em sala compartilhada; null em sala de 1 lugar. */
export function seatsLabel(slot: Pick<AvailabilitySlot, 'roomCapacity' | 'roomSeatsFree'>): string | null {
  const cap = slot.roomCapacity ?? null
  const free = slot.roomSeatsFree ?? null
  if (cap == null || cap <= 1 || free == null) return null
  return free === 1 ? 'último lugar' : `${free} de ${cap}`
}

/** Manhã = antes de 12:00 no fuso da clínica; Tarde = 12:00 em diante. */
export function splitByPeriod(
  slots: AvailabilitySlot[],
  timeZone: string,
): { manha: AvailabilitySlot[]; tarde: AvailabilitySlot[] } {
  const manha: AvailabilitySlot[] = []
  const tarde: AvailabilitySlot[] = []
  for (const s of slots) {
    const hour = Number(formatSlotTime(s.startsAt, timeZone).slice(0, 2))
    ;(hour < 12 ? manha : tarde).push(s)
  }
  return { manha, tarde }
}

/** Até `count` horários livres mais próximos do horário perdido (a05). */
export function nearestAlternatives(
  slots: AvailabilitySlot[],
  lostStartsAt: number,
  count = 2,
): number[] {
  return uniqueTimes(slots)
    .filter((s) => s.startsAt !== lostStartsAt)
    .sort((a, b) => Math.abs(a.startsAt - lostStartsAt) - Math.abs(b.startsAt - lostStartsAt))
    .slice(0, count)
    .map((s) => s.startsAt)
}

/** Janela de 5 dias que contém o dia escolhido. */
export function visibleDays(all: string[], selected: string, size = DAY_GRID_SIZE): string[] {
  const idx = all.indexOf(selected)
  if (idx < size) return all.slice(0, size)
  const start = Math.min(idx - Math.floor(size / 2), all.length - size)
  return all.slice(start, start + size)
}

/** «+55 11 98765-4321» a partir do wa_id; outro formato volta como veio. */
export function formatWaId(waId: string | null | undefined): string {
  if (!waId) return ''
  const d = waId.replace(/\D/g, '')
  if (d.length === 13 && d.startsWith('55')) {
    return `+55 ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`
  }
  if (d.length === 12 && d.startsWith('55')) {
    return `+55 ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`
  }
  return `+${d}`
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]!.charAt(0)
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : ''
  return (first + last).toUpperCase()
}

export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? ''
}

export function formatBrl(cents: number): string {
  const reais = Math.trunc(cents / 100)
  const rest = Math.abs(cents % 100).toString().padStart(2, '0')
  return `R$ ${reais.toLocaleString('pt-BR')},${rest}`
}

/** Prazo do Pix (settings da clínica; padrão do servidor 2 h). */
export function formatDeadline(seconds: number): string {
  if (seconds % 3600 === 0) {
    const h = seconds / 3600
    return `${h} h`
  }
  if (seconds >= 3600) {
    return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`
  }
  return `${Math.round(seconds / 60)} min`
}

/** Texto inicial (editável) do aviso de confirmação — REQ-033. */
export function defaultConfirmationMessage(input: {
  contactName: string | null
  serviceName: string
  professionalName: string
  whenLabel: string
  /** Frase fixa da sala (capacidade, card t1892s7600); nunca nº de vagas. */
  roomSharedNotice?: string | null
}): string {
  const name = firstName(input.contactName)
  const greet = name ? `Oi, ${name}!` : 'Olá!'
  const notice = input.roomSharedNotice?.trim()
  return `${greet} Seu horário de ${input.serviceName.toLowerCase()} com ${input.professionalName} está confirmado para ${input.whenLabel}.${notice ? ` ${notice}` : ''} Qualquer coisa, é só responder aqui.`
}

/** Voltar regressa à tela de origem (conversa, acompanhamento ou agenda). */
export function originRoute(tenantId: string, ctx: ScheduleContext): PanelRoute {
  if (ctx.conversationId) {
    return {
      kind: 'area',
      area: 'conversas',
      tenantId,
      section: 'thread',
      conversationId: ctx.conversationId,
    }
  }
  if (ctx.opportunityId) {
    return {
      kind: 'area',
      area: 'acompanhamento',
      tenantId,
      section: 'detalhe',
      opportunityId: ctx.opportunityId,
    }
  }
  return { kind: 'area', area: 'agenda', tenantId, section: 'dia' }
}

export function originLabel(ctx: ScheduleContext): string {
  if (ctx.conversationId) return 'da conversa'
  if (ctx.opportunityId) return 'do acompanhamento'
  return 'da agenda'
}

/**
 * DEC-053 (Confirmado, card t1868s7504): com conversa vinculada, o aviso pelo
 * WhatsApp vem LIGADO dentro da janela de 24 h; fora dela (ou sem conversa) vem
 * desligado e a tela explica porquê.
 */
export function defaultNotify(
  hasConversation: boolean,
  window24: { open: boolean } | null | undefined,
): boolean {
  return hasConversation && window24?.open === true
}
