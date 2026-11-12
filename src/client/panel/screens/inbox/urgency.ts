import type { InboxConversation } from '../../api'

/**
 * DEC-162 (Paulo, 11/11/2026): a lista de Conversas agrupa por urgência.
 * - «Sem responsável»: conversa aberta (não encerrada) sem ninguém atribuído.
 * - «Esperando sua resposta»: com responsável e a última mensagem é da cliente.
 * - «Em dia»: o resto (a equipe respondeu por último, ou encerrada).
 *
 * Em aberto (DEC-162): para o Responsável, «Esperando sua resposta» mostra
 * todas as atribuídas, não só as dele, até a regra ser decidida.
 */
export type UrgencyGroup = 'unassigned' | 'waiting' | 'ok'

export const URGENCY_ORDER: UrgencyGroup[] = ['unassigned', 'waiting', 'ok']

export function urgencyGroup(c: InboxConversation): UrgencyGroup {
  if (c.status !== 'closed' && !c.assigneeClerkUserId) return 'unassigned'
  if (c.status !== 'closed' && c.lastMessageDirection === 'inbound') return 'waiting'
  return 'ok'
}

export function urgencyGroupLabel(group: UrgencyGroup): string {
  switch (group) {
    case 'unassigned':
      return 'Sem responsável'
    case 'waiting':
      return 'Esperando sua resposta'
    case 'ok':
      return 'Em dia'
  }
}

/** Agrupa mantendo a ordem da API dentro de cada grupo; omite grupos vazios. */
export function groupByUrgency(
  list: InboxConversation[],
): Array<{ group: UrgencyGroup; items: InboxConversation[] }> {
  const buckets: Record<UrgencyGroup, InboxConversation[]> = { unassigned: [], waiting: [], ok: [] }
  for (const c of list) buckets[urgencyGroup(c)].push(c)
  return URGENCY_ORDER.filter((g) => buckets[g].length > 0).map((g) => ({ group: g, items: buckets[g] }))
}

/** A cliente falou por último e ninguém respondeu: mostrar a espera em vez da data. */
export function isWaitingOnTeam(c: InboxConversation): boolean {
  return c.status !== 'closed' && c.lastMessageDirection === 'inbound' && c.lastMessageAt != null
}

/**
 * «espera há N» — formato curto (Em aberto na DEC-162; proposta: min, h, d).
 */
export function waitingLabel(since: number, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - since) / 60_000))
  if (min < 1) return 'espera agora'
  if (min < 60) return `espera há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `espera há ${h} h`
  return `espera há ${Math.floor(h / 24)} d`
}
