/**
 * Termos não reconhecidos → sugestão de sinónimo à owner (DEC-141, realiza o
 * Em aberto da DEC-110).
 *
 * Quando a resposta de catálogo diz «"{termo}" eu não encontrei por aqui»
 * (CF-34), o termo fica registado por clínica. O painel mostra-o à owner com o
 * serviço provável; ela grava como sinónimo ou descarta. O sistema nunca grava
 * sozinho e não deriva verbos: o serviço provável é só uma pré-seleção no
 * painel, nunca entra na interpretação.
 *
 * Dados: só o termo (eco do `catalogMissHint`), contagem e datas. Sem conversa,
 * contato nem texto da mensagem. Fica no SQLite da clínica; não vai a telemetria.
 */
import type { Clock } from '../../db/clock'
import { newId } from '../ids'
import { NotFoundError, ValidationError } from '../errors'
import type { ClinicDb } from '../store'
import { getService, listServices } from './services'
import {
  assertSynonymsNoCollision,
  foldSynonym,
  listCatalogNameClaims,
  normalizeSynonymList,
  serializeSynonyms,
  SYNONYM_MAX_LENGTH,
  SYNONYM_MIN_LENGTH,
} from './synonyms'
import type { ServiceRow } from './types'

/** Termos com mais palavras do que isto não viram sugestão (frase, não nome). */
export const UNMATCHED_TERM_MAX_WORDS = 3
/** Quantas sugestões abertas o painel mostra. */
export const UNMATCHED_TERM_LIST_LIMIT = 20
/** Prefixo comum mínimo para propor um serviço provável («depila…»). */
const PROBABLE_MIN_PREFIX = 5

export type UnmatchedTermStatus = 'aberto' | 'gravado' | 'descartado'

export type UnmatchedTermSuggestion = {
  id: string
  term: string
  hits: number
  firstSeenAt: number
  lastSeenAt: number
  /** Serviço activo mais provável (pré-seleção no painel), ou null. */
  suggestedServiceId: string | null
}

type UnmatchedTermSql = {
  id: string
  term: string
  term_folded: string
  hits: number
  status: UnmatchedTermStatus
  first_seen_at: number
  last_seen_at: number
}

function words(folded: string): string[] {
  return folded.split(/[^a-z0-9]+/).filter((w) => w.length >= 3)
}

function cleanTerm(raw: string): string | null {
  const term = raw.trim().replace(/\s+/g, ' ')
  if (term.length < SYNONYM_MIN_LENGTH || term.length > SYNONYM_MAX_LENGTH) return null
  if (term.split(' ').length > UNMATCHED_TERM_MAX_WORDS) return null
  return term
}

/**
 * Regista (ou soma) um termo que não casou nenhum serviço. Silencioso: um termo
 * inválido ou que já identifica algo no catálogo não é registado. Um termo
 * descartado pela owner continua descartado (só conta).
 */
export function recordUnmatchedTerm(
  db: ClinicDb,
  tenantId: string,
  rawTerm: string | null | undefined,
  clock: Clock,
): void {
  if (!rawTerm) return
  const term = cleanTerm(rawTerm)
  if (!term) return
  const folded = foldSynonym(term)
  if (listCatalogNameClaims(db, tenantId).some((c) => c.folded === folded)) return
  const now = clock.nowMs()
  db.run(
    `INSERT INTO unmatched_terms (tenant_id, id, term, term_folded, hits, status, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, 1, 'aberto', ?, ?)
     ON CONFLICT(tenant_id, term_folded) DO UPDATE SET
       hits = hits + 1,
       last_seen_at = excluded.last_seen_at,
       status = CASE WHEN status = 'gravado' THEN 'aberto' ELSE status END`,
    tenantId,
    newId('umt'),
    term,
    folded,
    now,
    now,
  )
}

function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i++
  return i
}

/**
 * Serviço activo com o maior prefixo comum entre uma palavra do termo e uma
 * palavra do nome, das variantes ou dos sinónimos («depilar» ~ «Depilação»).
 * Empate ou prefixo curto → null (a owner escolhe). Só pré-seleção visual.
 */
export function probableServiceFor(
  term: string,
  services: readonly ServiceRow[],
): string | null {
  const termWords = words(foldSynonym(term))
  if (termWords.length === 0) return null
  let best = 0
  let bestIds: string[] = []
  for (const service of services) {
    if (!service.active) continue
    const names = [
      service.name,
      ...(service.synonyms ?? []),
      ...service.zones.filter((z) => z.active).flatMap((z) => [z.name, ...(z.synonyms ?? [])]),
    ]
    const serviceWords = names.flatMap((n) => words(foldSynonym(n)))
    let score = 0
    for (const tw of termWords) {
      for (const sw of serviceWords) score = Math.max(score, commonPrefix(tw, sw))
    }
    if (score > best) {
      best = score
      bestIds = [service.id]
    } else if (score === best && score > 0) {
      bestIds.push(service.id)
    }
  }
  if (best < PROBABLE_MIN_PREFIX || bestIds.length !== 1) return null
  return bestIds[0]!
}

/** Sugestões abertas, mais frequentes primeiro. Esconde as que já casam o catálogo. */
export function listUnmatchedTermSuggestions(
  db: ClinicDb,
  tenantId: string,
): UnmatchedTermSuggestion[] {
  const rows = db.all<UnmatchedTermSql>(
    `SELECT id, term, term_folded, hits, status, first_seen_at, last_seen_at
       FROM unmatched_terms
      WHERE tenant_id = ? AND status = 'aberto'
      ORDER BY hits DESC, last_seen_at DESC, id
      LIMIT ?`,
    tenantId,
    UNMATCHED_TERM_LIST_LIMIT * 2,
  )
  const claims = new Set(listCatalogNameClaims(db, tenantId).map((c) => c.folded))
  const services = listServices(db, tenantId)
  return rows
    .filter((row) => !claims.has(row.term_folded))
    .slice(0, UNMATCHED_TERM_LIST_LIMIT)
    .map((row) => ({
      id: row.id,
      term: row.term,
      hits: row.hits,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      suggestedServiceId: probableServiceFor(row.term, services),
    }))
}

function getOpenTerm(db: ClinicDb, tenantId: string, id: string): UnmatchedTermSql {
  const row = db.get<UnmatchedTermSql>(
    `SELECT id, term, term_folded, hits, status, first_seen_at, last_seen_at
       FROM unmatched_terms WHERE tenant_id = ? AND id = ?`,
    tenantId,
    id,
  )
  if (!row) throw new NotFoundError('unmatched_term_not_found', 'termo não encontrado')
  if (row.status !== 'aberto') {
    throw new ValidationError('unmatched_term_resolved', 'este termo já foi tratado')
  }
  return row
}

/**
 * A owner grava o termo como sinónimo do serviço escolhido (DEC-042 na rota).
 * Mesmas regras da ficha: até 8, 2–40 caracteres, sem colisão com outro serviço.
 * Chamar dentro de transação.
 */
export function acceptUnmatchedTerm(
  db: ClinicDb,
  tenantId: string,
  input: { id: string; serviceId: string; actor: string },
  clock: Clock,
): { term: string; service: ServiceRow } {
  const row = getOpenTerm(db, tenantId, input.id)
  const service = getService(db, tenantId, input.serviceId)
  if (!service) {
    throw new NotFoundError('service_not_found', `serviço ${input.serviceId} não encontrado`)
  }
  const normalized = normalizeSynonymList([...(service.synonyms ?? []), row.term])
  const kept = assertSynonymsNoCollision({
    synonyms: normalized,
    selfName: service.name,
    selfServiceId: service.id,
    selfZoneId: null,
    claims: listCatalogNameClaims(db, tenantId),
  })
  const now = clock.nowMs()
  // A versão do catálogo compilado é o MAX(updated_at): sobe sempre, mesmo no
  // mesmo milissegundo, para o próximo turno já ler o sinónimo novo.
  const latest =
    db.get<{ m: number | null }>(
      `SELECT MAX(updated_at) AS m FROM services WHERE tenant_id = ?`,
      tenantId,
    )?.m ?? 0
  db.run(
    `UPDATE services SET synonyms_json = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`,
    serializeSynonyms(kept),
    Math.max(now, latest + 1),
    tenantId,
    service.id,
  )
  db.run(
    `UPDATE unmatched_terms
        SET status = 'gravado', resolved_at = ?, resolved_by = ?, resolved_service_id = ?
      WHERE tenant_id = ? AND id = ?`,
    now,
    input.actor,
    service.id,
    tenantId,
    row.id,
  )
  return { term: row.term, service: getService(db, tenantId, service.id)! }
}

/** A owner descarta: o termo deixa de aparecer, mesmo que volte a ser usado. */
export function dismissUnmatchedTerm(
  db: ClinicDb,
  tenantId: string,
  input: { id: string; actor: string },
  clock: Clock,
): { term: string } {
  const row = getOpenTerm(db, tenantId, input.id)
  db.run(
    `UPDATE unmatched_terms
        SET status = 'descartado', resolved_at = ?, resolved_by = ?
      WHERE tenant_id = ? AND id = ?`,
    clock.nowMs(),
    input.actor,
    tenantId,
    row.id,
  )
  return { term: row.term }
}
