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

/**
 * Singular provável a partir do plural (DEC-176): «Zonas» → «Zona»,
 * «Opções» → «Opção». Só para sugerir quando os dois campos ficam iguais.
 */
export function suggestVariantKindSingular(plural: string): string {
  const word = plural.trim()
  if (!word) return ''
  const lower = word.toLocaleLowerCase('pt-BR')
  if (/ões$/.test(lower)) return `${word.slice(0, -3)}ão`
  if (/ns$/.test(lower)) return `${word.slice(0, -2)}m`
  if (/éis$/.test(lower)) return `${word.slice(0, -3)}el`
  if (/[aeo]is$/.test(lower)) return `${word.slice(0, -2)}l`
  if (/[rz]es$/.test(lower)) return word.slice(0, -2)
  if (/s$/.test(lower)) return word.slice(0, -1)
  return word
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
