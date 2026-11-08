/**
 * Friction flags mínimas no `ai.turn_decided` (session-analytics T2).
 * Sem corpo de mensagem; termo só como `termHash` (sha256 truncado do folded).
 * Flags: nao_encontrei, particle_as_zone, day_ask_ignored_locked_variant, mode_uma_todas.
 */
import { createHash } from 'node:crypto'
import type { BookingSessionStep } from './booking-session'

/** Flags T2 (desenho session-analytics §4.3). */
export type TurnFrictionFlagId =
  | 'nao_encontrei'
  | 'particle_as_zone'
  | 'day_ask_ignored_locked_variant'
  | 'mode_uma_todas'

export type TurnFrictionKind = 'zone' | 'catalog' | 'particle_suspected'

/** Entrada minimizada no payload `ai.turn_decided` (sem texto da cliente). */
export type TurnFrictionEvent = {
  flag: TurnFrictionFlagId
  kind?: TurnFrictionKind
  /** sha256 hex truncado (16) do termo folded — nunca o texto. */
  termHash?: string
  pendingSlotBefore?: string | null
  serviceId?: string
}

/**
 * Partículas / dias que em staging viraram «Não encontrei …» (tem/feira/disponível).
 * Espelha a fragilidade, não a stop-list completa de zonas.
 */
export const PARTICLE_FRICTION_WORDS: ReadonlySet<string> = new Set([
  'tem',
  'feira',
  'disponivel',
  'disponiveis',
])

export function foldFrictionTerm(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/** Hash estável do termo folded (16 hex). Vazio → undefined. */
export function frictionTermHash(term: string): string | undefined {
  const folded = foldFrictionTerm(term)
  if (!folded) return undefined
  return createHash('sha256').update(folded, 'utf8').digest('hex').slice(0, 16)
}

export function isParticleFrictionTerm(term: string): boolean {
  const folded = foldFrictionTerm(term)
  if (!folded) return false
  if (PARTICLE_FRICTION_WORDS.has(folded)) return true
  // «quarta feira» → tokens; qualquer token partícula conta.
  return folded.split(/[^a-z0-9]+/).some((w) => PARTICLE_FRICTION_WORDS.has(w))
}

/** Option-miss «Não encontrei {leftover}…» (zona). */
export function frictionForOptionMiss(leftover: string | null | undefined): TurnFrictionEvent[] {
  const raw = leftover?.trim() || null
  const hash = raw ? frictionTermHash(raw) : undefined
  if (raw && isParticleFrictionTerm(raw)) {
    return [
      { flag: 'nao_encontrei', kind: 'particle_suspected', termHash: hash },
      { flag: 'particle_as_zone', termHash: hash },
    ]
  }
  return [{ flag: 'nao_encontrei', kind: 'zone', ...(hash ? { termHash: hash } : {}) }]
}

/** Miss de catálogo elegível a DEC-141 (termo hashed). */
export function frictionForCatalogMiss(term: string | null | undefined): TurnFrictionEvent[] {
  const raw = term?.trim()
  if (!raw) return [{ flag: 'nao_encontrei', kind: 'catalog' }]
  const hash = frictionTermHash(raw)
  return [{ flag: 'nao_encontrei', kind: 'catalog', ...(hash ? { termHash: hash } : {}) }]
}

export function frictionModeUmaTodas(serviceId?: string | null): TurnFrictionEvent {
  return {
    flag: 'mode_uma_todas',
    ...(serviceId ? { serviceId } : {}),
  }
}

/**
 * Turno parece pergunta de dia/hora (sem precisar do texto no analytics).
 * Heurística alinhada aos bugs staging («tem horário na próxima quarta?»).
 */
export function turnLooksLikeDayOrTimeAsk(text: string): boolean {
  const folded = foldFrictionTerm(text)
  if (!folded) return false
  if (/\b(horario|horarios|disponivel|disponiveis|vaga|vagas)\b/.test(folded)) return true
  if (
    /\b(segunda|terca|quarta|quinta|sexta|sabado|domingo|amanha|hoje|semana)\b/.test(folded)
  ) {
    return true
  }
  if (/\b\d{1,2}\s*h(?:\d{2})?\b/.test(folded)) return true
  if (/\b\d{1,2}:\d{2}\b/.test(text)) return true
  return false
}

type FrameHint = {
  variantIds?: string[] | null
  pending?: { slot: string } | null
}

/**
 * Variante já travada + pergunta de dia/hora + sistema reabriu variant_ask ou limpou variantes.
 */
export function detectDayAskIgnoredLockedVariant(input: {
  frameBefore: FrameHint | null | undefined
  frameAfter: FrameHint | null | undefined
  turnLooksLikeDayAsk: boolean
}): TurnFrictionEvent | null {
  if (!input.turnLooksLikeDayAsk) return null
  const beforeIds = input.frameBefore?.variantIds
  if (!beforeIds?.length) return null
  const afterIds = input.frameAfter?.variantIds
  const cleared = !afterIds?.length
  const reopenedAsk = input.frameAfter?.pending?.slot === 'variantes'
  if (!cleared && !reopenedAsk) return null
  return {
    flag: 'day_ask_ignored_locked_variant',
    pendingSlotBefore: input.frameBefore?.pending?.slot ?? null,
  }
}

/** Dedup por (flag, termHash, kind). */
export function mergeFriction(
  ...lists: Array<TurnFrictionEvent[] | TurnFrictionEvent | null | undefined>
): TurnFrictionEvent[] {
  const out: TurnFrictionEvent[] = []
  const seen = new Set<string>()
  for (const list of lists) {
    if (!list) continue
    const items = Array.isArray(list) ? list : [list]
    for (const e of items) {
      const key = `${e.flag}|${e.kind ?? ''}|${e.termHash ?? ''}|${e.serviceId ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(e)
    }
  }
  return out
}

/** Garante que nenhum evento leva prosa / termo em claro. */
export function assertFrictionMinimized(events: readonly TurnFrictionEvent[]): void {
  for (const e of events) {
    const json = JSON.stringify(e)
    if (/"body"\s*:|"mensagem"\s*:|"leftover"\s*:|"term"\s*:/.test(json)) {
      throw new Error('ai.turn_decided.friction: chave de texto proibida')
    }
    if (e.termHash && (e.termHash.length > 64 || /\s/.test(e.termHash))) {
      throw new Error('ai.turn_decided.friction: termHash inválido')
    }
    if (e.serviceId && (e.serviceId.length > 80 || /\s/.test(e.serviceId))) {
      throw new Error('ai.turn_decided.friction: serviceId inválido')
    }
  }
}

export type { BookingSessionStep }
