/**
 * Conjunto reservado ≈20 % dos casos L2/L3 (#417 · plano §6).
 * Nunca usado para ajustar prompt nem frases.
 *
 * Escolha estável por ID (hash), não aleatória por execução.
 */

import { P0_DIALOG_CASES } from '../dialogs/p0-cases'

/**
 * Fora do L2 por omissão:
 * - `coverageOnly` (outro teste)
 * - adaptador injectado (timeout / JSON fixo) — fixture L1, não modelo real
 * - `flow` (família FL-): hub e Flow são determinísticos, sem chamada ao modelo;
 *   entrariam no passRate/pass^N e no conjunto reservado sem medir o LLM
 */
const SKIP_L2 = new Set(
  P0_DIALOG_CASES.filter((c) => c.coverageOnly || c.adapter != null || c.flow).map((c) => c.id),
)

function stableHash(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h
}

/** Todos os IDs elegíveis para a bateria L2 (exclui coverageOnly). */
export function l2EligibleCaseIds(): string[] {
  return P0_DIALOG_CASES.filter((c) => !SKIP_L2.has(c.id)).map((c) => c.id)
}

/**
 * ~20 % reservados. Determinístico: os IDs cujo hash % 5 === 0.
 * Garante pelo menos 1 se houver ≥5 elegíveis.
 */
export function heldOutCaseIds(all: string[] = l2EligibleCaseIds()): Set<string> {
  const sorted = [...all].sort()
  const reserved = new Set<string>()
  for (const id of sorted) {
    if (stableHash(id) % 5 === 0) reserved.add(id)
  }
  const target = Math.max(1, Math.round(sorted.length * 0.2))
  if (reserved.size < target) {
    for (const id of sorted) {
      if (reserved.size >= target) break
      reserved.add(id)
    }
  }
  // Se sobrar demais (>25 %), corta pelos primeiros hashes.
  if (reserved.size > Math.ceil(sorted.length * 0.25) && sorted.length >= 8) {
    const ordered = sorted.filter((id) => reserved.has(id)).sort((a, b) => stableHash(a) - stableHash(b))
    return new Set(ordered.slice(0, target))
  }
  return reserved
}

export function partitionL2Cases(all: string[] = l2EligibleCaseIds()): {
  tune: string[]
  heldOut: string[]
} {
  const held = heldOutCaseIds(all)
  return {
    tune: all.filter((id) => !held.has(id)),
    heldOut: all.filter((id) => held.has(id)),
  }
}
