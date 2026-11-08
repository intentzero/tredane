/**
 * Gate cross-cutting do turno de marcação (DEC-C4 / arquitectura P1).
 *
 * Ordem fixa **antes** de pending answer / slot fillers / zone leftover:
 *   handoff (fora — autodraft) → restart → exit A/B → reject C
 *   → ask_info (preço|duração) → confusão (DEC-151, classificada; realização noutro sítio)
 *
 * Classificação aqui; realização de `ask_info` mid-funnel em `ask-info-realize`
 * (stack park/resume) via `tryAiAutoBook`. Política vive no acto; `sayAct` só redige.
 * **Proposto → em progresso**.
 */
import { isCatalogInfoAsk, CATALOG_PRICE_ASK } from './booking-intent-text'
import {
  classifySensitive,
  hasRestartRequest,
  hasSlotRejectRequest,
  hasSoftDeclineRequest,
  isExplicitAbandonText,
  type SensitiveHit,
} from './nlu/sensitive'

export type AskInfoTopic = 'price' | 'duration'

/**
 * Acto cross-cutting classificado no início do motor de turno.
 * `none` = seguir para obrigação pendente / fillers.
 */
export type CrossCuttingAct =
  | { kind: 'restart'; hits: SensitiveHit[] }
  | { kind: 'exit_ab'; hits: SensitiveHit[]; explicit: boolean }
  | { kind: 'reject_c'; hits: SensitiveHit[] }
  | { kind: 'ask_info'; topic: AskInfoTopic; hits: SensitiveHit[] }
  | { kind: 'none'; hits: SensitiveHit[] }

export type ClassifyCrossCuttingInput = {
  text: string
  /** Hits pré-computados (evita reclassificar). Omisso = `classifySensitive(text)`. */
  hits?: SensitiveHit[]
}

function askInfoTopic(text: string): AskInfoTopic | null {
  if (!isCatalogInfoAsk(text)) return null
  // «quanto tempo dura» casa `quanto` em CATALOG_PRICE_ASK — preferir duração
  // quando há sinal de tempo e não há preço explícito (custa/valor/tabela).
  const durationCue = /\b(dura|dura[cç][aã]o|tempo|minutos)\b/i.test(text)
  const explicitPrice = /\b(pre[cç]os?|custam?|valor(es)?|or[cç]amento|tabela)\b/i.test(text)
  if (durationCue && !explicitPrice) return 'duration'
  if (CATALOG_PRICE_ASK.test(text) || explicitPrice) return 'price'
  return 'duration'
}

/**
 * Classifica o acto cross-cutting do turno (texto).
 * Não grava o quadro e não redige — só decide a ordem de política.
 */
export function classifyCrossCuttingAct(input: ClassifyCrossCuttingInput): CrossCuttingAct {
  const hits = input.hits ?? classifySensitive(input.text)
  if (hasRestartRequest(hits)) return { kind: 'restart', hits }
  if (hasSoftDeclineRequest(hits)) {
    return { kind: 'exit_ab', hits, explicit: isExplicitAbandonText(input.text) }
  }
  if (hasSlotRejectRequest(hits)) return { kind: 'reject_c', hits }
  const topic = askInfoTopic(input.text)
  if (topic) return { kind: 'ask_info', topic, hits }
  return { kind: 'none', hits }
}

/** True se o gate barrou fillers (restart / saída / reject / ask_info). */
export function isCrossCuttingInterrupt(act: CrossCuttingAct): boolean {
  return act.kind !== 'none'
}
