/**
 * Escolhas da cliente nesta conversa (linha e zonas) — DEC-090 / detalhe DEC-078.
 * O texto inbound escolhe a zona. A lista da clínica («temos», «qual zona») não.
 * A oferta já fechada («para axila e íntima») conta quando a cliente só aceita a hora.
 */
import { explicitAudienceLine } from '../catalog/audience'
import type { ServiceZoneRow } from '../config/types'
import { zonesNamedInText } from '../config/zones'
import type { AudienceLine } from './variant-line'

/**
 * «Tudo» / «todas» / «completo» = todas as variantes activas do âmbito.
 * «As duas» / «as três» só quando o âmbito tem mesmo esse número de nomes.
 * Com mais variantes, não puxa o resto do catálogo (DEC-078 / DEC-090).
 */
const WHOLE_CATALOG_CHOICE = /\b(tudo|todas|todos|completo|completa)\b/i
const COUNTED_CATALOG_CHOICE = /\bas\s+(duas|tres|tr[eê]s)\b/i
/** Lista para a cliente escolher. Não é o conjunto da visita. */
const ZONE_MENU =
  /\b(temos|opcoes|opcao)\b|\bqual\b[^?.!]{0,40}\b(zona|regiao|regioes)\b/i

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

function distinctZoneNames(zones: readonly { name: string }[]): number {
  const names = new Set<string>()
  for (const zone of zones) names.add(fold(zone.name))
  return names.size
}

function countedCatalogSize(text: string): number | null {
  const match = fold(text).match(COUNTED_CATALOG_CHOICE)
  if (!match) return null
  return match[1] === 'duas' ? 2 : 3
}

/** «Tudo» / «todas» / «completo» no texto da cliente. «As duas» não entra. */
export function claimsWholeCatalog(text: string): boolean {
  return WHOLE_CATALOG_CHOICE.test(fold(text))
}

/**
 * Zonas já fechadas na última fala da clínica («para axila e íntima»),
 * quando a cliente só aceita o horário. Uma lista («temos…», «qual zona») não escolhe.
 */
export function zonesOfferedToClient(
  text: string | null | undefined,
  zones: readonly ServiceZoneRow[],
): ServiceZoneRow[] {
  if (!text || zones.length === 0) return []
  if (ZONE_MENU.test(fold(text))) return []
  const named = zonesNamedInText(text, zones)
  if (named.length === 0 || nameCitedTwice(named)) return []
  return named
}

/**
 * Zonas escolhidas pela cliente nos textos (mais novos primeiro).
 * Nome explícito ganha de «tudo». «Tudo» devolve o âmbito inteiro.
 * «As duas» / «as três» só devolvem o âmbito quando ele tem esse tamanho.
 * Nome ambíguo → ambiguous.
 */
export function zonesChosenInClientTexts(
  texts: readonly string[],
  zones: readonly ServiceZoneRow[],
): { zones: ServiceZoneRow[]; ambiguous: boolean } {
  if (zones.length === 0) return { zones: [], ambiguous: false }
  for (const text of texts) {
    const found = zonesNamedInText(text, zones)
    if (found.length > 0) return { zones: found, ambiguous: nameCitedTwice(found) }
    const folded = fold(text)
    if (WHOLE_CATALOG_CHOICE.test(folded)) return { zones: [...zones], ambiguous: false }
    const counted = countedCatalogSize(text)
    if (counted != null && distinctZoneNames(zones) === counted) {
      return { zones: [...zones], ambiguous: false }
    }
  }
  return { zones: [], ambiguous: false }
}
