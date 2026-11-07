/**
 * DEC-145 — modo de variantes por serviço: uma ou várias por atendimento.
 * Default `varias` preserva depilação (eco DEC-137, atalho «tudo»).
 * Não se infere do rótulo «tipo»/«zona».
 */

export const VARIANT_SELECTIONS = ['uma', 'varias'] as const
export type VariantSelection = (typeof VARIANT_SELECTIONS)[number]

/** Default de linhas existentes e de serviços novos sem escolha. */
export const DEFAULT_VARIANT_SELECTION: VariantSelection = 'varias'

export function isVariantSelection(value: unknown): value is VariantSelection {
  return value === 'uma' || value === 'varias'
}

export function normalizeVariantSelection(value: unknown): VariantSelection {
  return isVariantSelection(value) ? value : DEFAULT_VARIANT_SELECTION
}

/** `varias` = combinação, eco DEC-137, «tudo». `uma` = exactamente uma. */
export function allowsMultipleVariants(mode: VariantSelection | null | undefined): boolean {
  return normalizeVariantSelection(mode) === 'varias'
}
