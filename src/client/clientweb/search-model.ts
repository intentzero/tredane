/**
 * Pesquisa de serviços, zonas e combos na página da cliente (DEC-200 / DEC-080).
 * Corre no navegador sobre o catálogo ativo: nome e sinónimos (DEC-110, nunca mostrados),
 * sem acentos, com plural leve. Sem rede e sem índice.
 */
import type { Catalog, CatalogCombo, CatalogService, CatalogZone, Line } from './api'
import { combosForLine, zonesForLine } from './booking-model'

/** Minúsculas, sem acentos e sem pontuação. */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Plural leve: «axilas» → «axila», «pernas» → «perna»; palavras curtas ficam. */
export function lightSingular(token: string): string {
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1)
  return token
}

function tokens(text: string): string[] {
  return foldText(text).split(' ').filter(Boolean).map(lightSingular)
}

/** Todas as palavras da pesquisa começam alguma palavra do alvo (nome ou sinónimo). */
export function matchesQuery(query: string, targets: readonly string[]): boolean {
  const q = tokens(query)
  if (q.length === 0) return false
  return targets.some((t) => {
    const words = tokens(t)
    return q.every((w) => words.some((x) => x.startsWith(w)))
  })
}

export type SearchGroup = {
  service: CatalogService
  /** Zonas que casaram (a pesquisa pode casar o serviço, as zonas, ou os dois). */
  zones: CatalogZone[]
  /** Combos que casaram pelo nome ou pelas zonas que incluem (DEC-080; mock C-10). */
  combos: CatalogCombo[]
  /** O próprio serviço casou (nome ou sinónimo). */
  serviceMatched: boolean
}

export type SearchResult = { groups: SearchGroup[]; count: number }

/** Resultados agrupados pelo serviço, só com o que serve à linha escolhida. */
export function searchCatalog(catalog: Catalog, services: CatalogService[], line: Line | null, query: string): SearchResult {
  void catalog
  const groups: SearchGroup[] = []
  for (const service of services) {
    const serviceMatched = matchesQuery(query, [service.name, ...service.synonyms])
    const visibleZones = zonesForLine(service, line)
    const zones = visibleZones.filter((z) => matchesQuery(query, [z.name, ...z.synonyms]))
    const zoneById = new Map(visibleZones.map((z) => [z.id, z]))
    const combos = combosForLine(service, line).filter((c) => {
      const memberNames = c.zoneIds.map((id) => zoneById.get(id)?.name).filter(Boolean) as string[]
      return matchesQuery(query, [c.name, ...memberNames])
    })
    if (serviceMatched || zones.length > 0 || combos.length > 0) {
      groups.push({ service, zones, combos, serviceMatched })
    }
  }
  const count = groups.reduce((n, g) => {
    const zoneHits = g.zones.length
    const comboHits = g.combos.length
    const serviceHit = g.serviceMatched ? 1 : 0
    if (zoneHits + comboHits === 0) return n + serviceHit
    return n + zoneHits + comboHits + (g.serviceMatched ? 1 : 0)
  }, 0)
  return { groups, count }
}

/** Filtra as zonas de um serviço pela pesquisa (campo «Procurar zona»). */
export function filterZones(zones: CatalogZone[], query: string): CatalogZone[] {
  return query.trim() ? zones.filter((z) => matchesQuery(query, [z.name, ...z.synonyms])) : zones
}

/** Filtra combos pelo nome ou pelos nomes das zonas que incluem. */
export function filterCombos(
  combos: CatalogCombo[],
  zones: CatalogZone[],
  query: string,
): CatalogCombo[] {
  if (!query.trim()) return combos
  const zoneById = new Map(zones.map((z) => [z.id, z]))
  return combos.filter((c) => {
    const memberNames = c.zoneIds.map((id) => zoneById.get(id)?.name).filter(Boolean) as string[]
    return matchesQuery(query, [c.name, ...memberNames])
  })
}

/**
 * Onde realçar o termo no texto mostrado: início e fim no texto original, sem acentos nem
 * maiúsculas. Realça só a primeira palavra que casa (plural leve incluído). `null` = não casa.
 */
export function highlightRange(text: string, query: string): [number, number] | null {
  const q = tokens(query)[0]
  if (!q) return null
  // Palavras do texto original com início e fim, para mapear de volta.
  const re = /[^\s]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const word = m[0]
    const folded = foldText(word)
    const singular = lightSingular(folded)
    if (singular.startsWith(q) || folded.startsWith(q)) {
      // O realce cobre o prefixo casado: tantos caracteres originais quantos tem q (acentos não mudam a contagem de letras).
      const len = Math.min(word.length, Math.max(q.length, 1))
      return [m.index, m.index + len]
    }
  }
  return null
}
