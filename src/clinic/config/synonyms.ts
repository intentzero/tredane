/**
 * Sinónimos / nomes populares por serviço e variante (DEC-110 / #421).
 * Só a owner grava (DEC-042 via clinic.config.write).
 * Alimentam a interpretação; respostas usam sempre o nome do catálogo.
 */
import { ValidationError } from '../errors'
import type { ClinicDb } from '../store'

/** Lista curta: no máximo 8 por serviço ou variante. */
export const SYNONYM_MAX_COUNT = 8
/** Cada sinónimo: 2–40 caracteres (após trim). */
export const SYNONYM_MIN_LENGTH = 2
export const SYNONYM_MAX_LENGTH = 40

export function foldSynonym(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function parseSynonymsJson(raw: string | null | undefined): string[] {
  if (raw == null || raw === '') return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export function serializeSynonyms(synonyms: readonly string[]): string {
  return JSON.stringify([...synonyms])
}

/**
 * Normaliza e valida a lista enviada pela ficha.
 * Remove vazios, corta espaços, rejeita comprimento/duplicados internos.
 */
export function normalizeSynonymList(input: unknown): string[] {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) {
    throw new ValidationError('invalid_synonyms', 'sinónimos devem ser uma lista de textos')
  }
  if (input.length > SYNONYM_MAX_COUNT) {
    throw new ValidationError(
      'synonym_list_too_long',
      `no máximo ${SYNONYM_MAX_COUNT} sinónimos`,
      { max: SYNONYM_MAX_COUNT },
    )
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== 'string') {
      throw new ValidationError('invalid_synonyms', 'cada sinónimo é um texto')
    }
    const text = raw.trim()
    if (!text) continue
    if (text.length < SYNONYM_MIN_LENGTH || text.length > SYNONYM_MAX_LENGTH) {
      throw new ValidationError(
        'invalid_synonym_length',
        `cada sinónimo tem entre ${SYNONYM_MIN_LENGTH} e ${SYNONYM_MAX_LENGTH} caracteres`,
        { synonym: text },
      )
    }
    const key = foldSynonym(text)
    if (seen.has(key)) {
      throw new ValidationError('duplicate_synonym', `sinónimo repetido: «${text}»`, {
        synonym: text,
      })
    }
    seen.add(key)
    out.push(text)
  }
  return out
}

export type CatalogNameClaim = {
  folded: string
  label: string
  /** serviceId dono do nome/sinónimo (ou da variante). */
  serviceId: string
  /** zoneId quando o nome é de variante; null = serviço. */
  zoneId: string | null
  /**
   * Nome canónico (dobrado) de quem reclama a palavra. Variantes do mesmo
   * serviço com o mesmo nome (Axila feminino / Axila masculino, DEC-079) são
   * a mesma opção na ficha e partilham sinónimos (DEC-176).
   */
  ownerFolded: string
}

/** Recolhe nomes e sinónimos do catálogo do tenant (para colisão). */
export function listCatalogNameClaims(db: ClinicDb, tenantId: string): CatalogNameClaim[] {
  const claims: CatalogNameClaim[] = []
  const services = db.all<{ id: string; name: string; synonyms_json: string | null }>(
    `SELECT id, name, synonyms_json FROM services WHERE tenant_id = ?`,
    tenantId,
  )
  for (const s of services) {
    const ownerFolded = foldSynonym(s.name)
    claims.push({
      folded: ownerFolded,
      label: s.name,
      serviceId: s.id,
      zoneId: null,
      ownerFolded,
    })
    for (const syn of parseSynonymsJson(s.synonyms_json)) {
      claims.push({
        folded: foldSynonym(syn),
        label: syn,
        serviceId: s.id,
        zoneId: null,
        ownerFolded,
      })
    }
  }
  const zones = db.all<{
    id: string
    service_id: string
    name: string
    synonyms_json: string | null
  }>(
    `SELECT id, service_id, name, synonyms_json FROM service_zones WHERE tenant_id = ?`,
    tenantId,
  )
  for (const z of zones) {
    const ownerFolded = foldSynonym(z.name)
    claims.push({
      folded: ownerFolded,
      label: z.name,
      serviceId: z.service_id,
      zoneId: z.id,
      ownerFolded,
    })
    for (const syn of parseSynonymsJson(z.synonyms_json)) {
      claims.push({
        folded: foldSynonym(syn),
        label: syn,
        serviceId: z.service_id,
        zoneId: z.id,
        ownerFolded,
      })
    }
  }
  return claims
}

/**
 * Recusa sinónimo que colide com nome/sinónimo de outro serviço ou variante.
 * O próprio alvo (serviço ou variante) pode repetir o próprio nome canónico
 * (é ignorado — não se grava como sinónimo).
 */
export function assertSynonymsNoCollision(input: {
  synonyms: readonly string[]
  /** Nome canónico do próprio alvo (serviço ou variante). */
  selfName: string
  selfServiceId: string
  selfZoneId: string | null
  claims: readonly CatalogNameClaim[]
}): string[] {
  const selfFold = foldSynonym(input.selfName)
  const kept: string[] = []
  for (const syn of input.synonyms) {
    const key = foldSynonym(syn)
    if (key === selfFold) continue
    const hit = input.claims.find((c) => {
      if (c.folded !== key) return false
      // Mesmo serviço + mesma variante (ou serviço): é o próprio — ok se for o nome.
      if (c.serviceId === input.selfServiceId && c.zoneId === input.selfZoneId) return false
      // DEC-176 — variante irmã (mesmo serviço, mesmo nome): a mesma opção, outro público.
      if (
        input.selfZoneId != null &&
        c.zoneId != null &&
        c.serviceId === input.selfServiceId &&
        c.ownerFolded === selfFold
      ) {
        return false
      }
      return true
    })
    if (hit) {
      const where =
        hit.zoneId != null
          ? `a variante «${hit.label}»`
          : `o serviço «${hit.label}»`
      throw new ValidationError(
        'synonym_collision',
        `«${syn}» já identifica ${where}. Escolha outro sinónimo.`,
        { synonym: syn, conflictingLabel: hit.label },
      )
    }
    kept.push(syn)
  }
  return kept
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** O texto cita o sinónimo como palavra inteira (igual a variantNameHit). */
export function textCitesSynonym(text: string, synonym: string): boolean {
  const n = foldSynonym(synonym)
  if (n.length < SYNONYM_MIN_LENGTH) return false
  const re = new RegExp(`(?<![a-z0-9])${escapeRegExp(n)}(?![a-z0-9])`)
  return re.test(foldSynonym(text))
}

/** True se o texto cita o nome ou algum sinónimo. */
export function textCitesNameOrSynonym(
  text: string,
  name: string,
  synonyms: readonly string[] | null | undefined,
): boolean {
  if (textCitesSynonym(text, name)) return true
  for (const syn of synonyms ?? []) {
    if (textCitesSynonym(text, syn)) return true
  }
  return false
}
