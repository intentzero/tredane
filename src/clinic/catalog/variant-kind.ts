/**
 * Nome do tipo das variantes no singular e no plural (DEC-079, texto livre).
 * O plural gravado vale; sem ele, sugere-se pelas regras comuns do português.
 */

export const VARIANT_KIND_MAX = 40

export type VariantKindSource = {
  variantKind?: string | null
  variantKindPlural?: string | null
}

export type VariantKindLabels = {
  singular: string
  plural: string
  /** «1 zona», «4 zonas». */
  count: (n: number) => string
}

export function suggestVariantKindPlural(singular: string): string {
  const word = singular.trim()
  if (!word) return ''
  const lower = word.toLocaleLowerCase('pt-BR')
  if (/ão$/.test(lower)) return `${word.slice(0, -2)}ões`
  if (/[aeou]l$/.test(lower)) return `${word.slice(0, -1)}is`
  if (/m$/.test(lower)) return `${word.slice(0, -1)}ns`
  if (/[rz]$/.test(lower)) return `${word}es`
  if (/s$/.test(lower)) return word
  return `${word}s`
}

export function variantKindLabels(
  svc: VariantKindSource,
  fallback = 'Variante',
): VariantKindLabels {
  const singular = svc.variantKind?.trim() || fallback
  const plural =
    svc.variantKindPlural?.trim() ||
    (svc.variantKind?.trim() ? suggestVariantKindPlural(singular) : suggestVariantKindPlural(fallback))
  const lowerS = singular.toLocaleLowerCase('pt-BR')
  const lowerP = plural.toLocaleLowerCase('pt-BR')
  return {
    singular,
    plural,
    count: (n) => `${n} ${n === 1 ? lowerS : lowerP}`,
  }
}
