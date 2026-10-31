/**
 * Escolhas da cliente nesta conversa (linha e zonas) — DEC-090 / detalhe DEC-078.
 * Só texto explícito inbound; a lista que a clínica ofereceu não escolhe a zona.
 */
import { explicitAudienceLine } from '../catalog/audience'
import type { ServiceZoneRow } from '../config/types'
import { zonesNamedInText } from '../config/zones'
import type { AudienceLine } from './variant-line'

/** «Tudo» / «todas» = todas as variantes activas do âmbito. */
export const ALL_ZONES_CHOICE =
  /\b(tudo|todas|todos|as\s+duas|as\s+tres|as\s+tr[eê]s|completo|completa)\b/i

function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Linha explícita mais recente (textos do mais novo para o mais antigo). */
export function audienceLineFromClientTexts(texts: readonly string[]): AudienceLine | null {
  for (const text of texts) {
    const line = explicitAudienceLine(text)
    if (line) return line
  }
  return null
}

function nameCitedTwice(zones: readonly { name: string }[]): boolean {
  const seen = new Set<string>()
  for (const zone of zones) {
    const key = zone.name.trim().toLocaleLowerCase('pt-BR')
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

/**
 * Zonas escolhidas pela cliente nos textos (mais novos primeiro).
 * «Tudo» devolve o âmbito inteiro. Nome ambíguo → ambiguous.
 */
export function zonesChosenInClientTexts(
  texts: readonly string[],
  zones: readonly ServiceZoneRow[],
): { zones: ServiceZoneRow[]; ambiguous: boolean } {
  if (zones.length === 0) return { zones: [], ambiguous: false }
  for (const text of texts) {
    if (ALL_ZONES_CHOICE.test(fold(text))) return { zones: [...zones], ambiguous: false }
    const found = zonesNamedInText(text, zones)
    if (found.length > 0) return { zones: found, ambiguous: nameCitedTwice(found) }
  }
  return { zones: [], ambiguous: false }
}
