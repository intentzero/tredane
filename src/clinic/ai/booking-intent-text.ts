/**
 * Adaptador texto → polaridade de variantes (PR-D / #579).
 * Não grava o quadro: só classifica menções para o actualizador.
 *
 * D3: «não quero pernas, só axila» — a zona na negação não reentra.
 * Gramática completa (compare / mention_only / tirar / sem) fica diferida.
 */
import type { ServiceZoneRow } from '../config/types'

/** Só polaridade de pedido («não quero X»). «sem»/«tirar» ficam fora — FP altos. */
const NEGATION_CUE =
  /\bn[aã]o\s+(?:quero|preciso|gostaria|aceito)(?:\s+mais)?\b/iu

const SOLO_CUE = /\b(?:s[oó]|apenas)\b/iu

export type VariantPolarity = {
  /** Zona citada sob polaridade negativa («não quero pernas»). */
  negatedIds: string[]
  /** Zona citada positivamente («só axila», ou sem cue de negação). */
  positiveIds: string[]
  /** Frase tem «só» / «apenas» — o positivo substitui o conjunto. */
  solo: boolean
  /** Há cue de negação no texto. */
  hasNegation: boolean
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Índices no texto dobrado onde o nome da zona casa (palavra). */
function findZoneSpans(
  folded: string,
  zone: ServiceZoneRow,
): Array<{ start: number; end: number }> {
  const name = fold(zone.name.trim())
  if (name.length < 2) return []
  const re = new RegExp(
    `(?<![a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`,
    'g',
  )
  const spans: Array<{ start: number; end: number }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(folded)) != null) {
    spans.push({ start: m.index, end: m.index + m[0]!.length })
  }
  return spans
}

/**
 * Classifica por segmento (vírgula / ponto-e-vírgula).
 * «não quero só X» (só sob a negação) → negated, não solo.
 */
function segmentPolarity(segment: string): 'negated' | 'solo' | 'plain' {
  const soloIdx = segment.search(SOLO_CUE)
  const negIdx = segment.search(NEGATION_CUE)
  if (negIdx >= 0 && (soloIdx < 0 || soloIdx > negIdx)) return 'negated'
  if (soloIdx >= 0) return 'solo'
  return 'plain'
}

/**
 * Classifica menções de variante no turno: negadas vs positivas.
 * Zonas homónimas no âmbito já filtrado (linha) — o caller passa o pool correcto.
 */
export function classifyVariantPolarity(
  text: string,
  zones: readonly ServiceZoneRow[],
): VariantPolarity {
  const active = zones.filter((z) => z.active && z.name.trim().length >= 2)
  const folded = fold(text)
  const hasNegation = NEGATION_CUE.test(folded)
  const solo = SOLO_CUE.test(folded)
  const negated = new Set<string>()
  const positive = new Set<string>()

  // Partir em cláusulas: «não quero pernas» | «só axila».
  const segments = folded.split(/\s*[,;]+\s*/).filter(Boolean)
  const ordered = [...active].sort(
    (a, b) => fold(b.name).length - fold(a.name).length,
  )

  for (const segment of segments) {
    const pol = segmentPolarity(segment)
    const claimed = new Array<boolean>(segment.length).fill(false)
    for (const zone of ordered) {
      for (const span of findZoneSpans(segment, zone)) {
        let overlap = false
        for (let i = span.start; i < span.end; i++) {
          if (claimed[i]) {
            overlap = true
            break
          }
        }
        if (overlap) continue
        for (let i = span.start; i < span.end; i++) claimed[i] = true
        if (pol === 'negated') negated.add(zone.id)
        else if (pol === 'solo' || pol === 'plain') positive.add(zone.id)
      }
    }
  }

  // Sem vírgula: «não quero pernas só axila» — «só» após negação e após a
  // zona negada marca o positivo; «não quero só X» mantém X negado.
  if (segments.length <= 1 && (hasNegation || solo)) {
    negated.clear()
    positive.clear()
    const claimed = new Array<boolean>(folded.length).fill(false)
    const negAt = folded.search(NEGATION_CUE)
    for (const zone of ordered) {
      for (const span of findZoneSpans(folded, zone)) {
        let overlap = false
        for (let i = span.start; i < span.end; i++) {
          if (claimed[i]) {
            overlap = true
            break
          }
        }
        if (overlap) continue
        for (let i = span.start; i < span.end; i++) claimed[i] = true
        const before = folded.slice(Math.max(0, span.start - 48), span.start)
        const soloAt = before.search(SOLO_CUE)
        const negInBefore = before.search(NEGATION_CUE)
        // «só Y» depois da negação e sem a própria negação colada a Y → positivo.
        if (soloAt >= 0 && (negInBefore < 0 || soloAt > negInBefore) && negAt >= 0 && span.start > negAt) {
          // Se o «só» está imediatamente sob «não quero só» (sem zona entre neg e só),
          // a zona continua negada.
          const between = folded.slice(negAt, span.start)
          if (/n[aã]o\s+(?:quero|preciso|gostaria|aceito)(?:\s+mais)?\s+(?:so|apenas)\s*$/i.test(between.trimEnd())) {
            negated.add(zone.id)
          } else {
            positive.add(zone.id)
          }
        } else if (NEGATION_CUE.test(before)) {
          negated.add(zone.id)
        } else {
          positive.add(zone.id)
        }
      }
    }
  }

  return {
    negatedIds: [...negated],
    positiveIds: [...positive],
    solo,
    hasNegation,
  }
}

/**
 * Conjunto efectivo após polaridade (D3).
 * - Com «só»/«apenas» e positivos → só os positivos.
 * - Com negação → prior − negados, depois une positivos (se houver).
 * - Sem polaridade **ou sem zona casada** → null (parser habitual / leftover).
 */
export function resolvePolarityVariantIds(
  polarity: VariantPolarity,
  priorIds: readonly string[] | null,
): string[] | null {
  if (!polarity.hasNegation && !polarity.solo) return null
  // Cue sem zona («só amanhã», «quero tirar uma dúvida») → não engolir o turno.
  if (polarity.negatedIds.length === 0 && polarity.positiveIds.length === 0) {
    return null
  }
  if (polarity.solo && polarity.positiveIds.length > 0 && !polarity.hasNegation) {
    return [...polarity.positiveIds]
  }
  if (polarity.solo && polarity.positiveIds.length > 0 && polarity.hasNegation) {
    // «não quero X, só Y» — o solo dos positivos vence o conjunto.
    return [...polarity.positiveIds]
  }
  const prior = priorIds?.length ? [...priorIds] : []
  const next = prior.filter((id) => !polarity.negatedIds.includes(id))
  if (polarity.positiveIds.length > 0) {
    const seen = new Set(next)
    for (const id of polarity.positiveIds) {
      if (!seen.has(id)) {
        next.push(id)
        seen.add(id)
      }
    }
  }
  if (
    next.length === 0 &&
    polarity.negatedIds.length > 0 &&
    polarity.positiveIds.length === 0
  ) {
    return []
  }
  return next
}

/** Pedido de preço/duração — não deve seleccionar variante (D4). */
export function isCatalogInfoAsk(text: string): boolean {
  return (
    /\b(pre[cç]os?|custam?|valores?|quanto\s+(?:[eé]|fica|sai)|or[cç]amento)\b/i.test(
      text,
    ) || /\b(dura|dura[cç][aã]o|tempo|minutos)\b/i.test(text)
  )
}

/**
 * Afirmação curta de marcação após consulta de catálogo (ex. «Quero» / «Pode ser»).
 * Não inclui «não quero» (soft-decline / D3) nem pedido com zona/dia/hora.
 */
export function isShortBookingAffirm(text: string): boolean {
  return /^(sim|quero(?:\s+(?:marcar|agendar|sim))?|pode ser|pode marcar|pode agendar|pode|confirmo|ok|okay|beleza|blz|bora|fechado|combinado|isso|👍)[\s!.?]*$/iu.test(
    text.trim(),
  )
}
