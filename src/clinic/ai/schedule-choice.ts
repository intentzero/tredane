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

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1
      j += 1
      continue
    }
    edits += 1
    if (edits > 1) return false
    if (a.length === b.length) {
      i += 1
      j += 1
    } else if (a.length > b.length) i += 1
    else j += 1
  }
  if (i < a.length || j < b.length) edits += 1
  return edits <= 1
}

/**
 * Uma palavra longa do texto está a uma letra do nome do serviço.
 * «bronzeamento» casa «Brinzeamento». Nomes curtos ou de várias palavras não entram.
 */
export function citesServiceName(text: string, name: string): boolean {
  const words = fold(name)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3)
  if (words.length !== 1 || words[0]!.length < 8) return false
  const target = words[0]!
  const tokens = fold(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 8)
  return tokens.some((token) => token !== target && editDistanceAtMostOne(token, target))
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
