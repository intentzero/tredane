/**
 * FAQ / conhecimento institucional da clínica (DEC-185).
 * Só a owner publica (DEC-042 via clinic.config.write). Resposta modo A:
 * texto aprovado, sem LLM. Limites: ~15 published, ≤500 chars/resposta.
 */
import type { Clock } from '../../db/clock'
import { newId } from '../ids'
import { NotFoundError, ValidationError } from '../errors'
import type { ClinicDb } from '../store'

export const KNOWLEDGE_MAX_PUBLISHED = 15
export const KNOWLEDGE_MAX_ANSWER_CHARS = 500
export const KNOWLEDGE_MAX_QUESTION_CHARS = 200
export const KNOWLEDGE_MAX_CUE_CHARS = 80
export const KNOWLEDGE_MAX_CUES = 12
export const KNOWLEDGE_MAX_CATEGORY_NAME = 60
export const KNOWLEDGE_SIGNAL_SOURCE_KEY = 'signal_policy'
export const KNOWLEDGE_SIGNAL_CATEGORY_NAME = 'Pagamento'
export const KNOWLEDGE_SIGNAL_QUESTION = 'Qual a política do sinal / Pix?'

export type KnowledgeEntryStatus = 'draft' | 'published'

export type KnowledgeCategory = {
  id: string
  name: string
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export type KnowledgeEntry = {
  id: string
  categoryId: string
  categoryName: string
  question: string
  answer: string
  matchCues: string[]
  status: KnowledgeEntryStatus
  sourceKey: string | null
  version: number
  createdAt: number
  updatedAt: number
  publishedAt: number | null
}

type CategorySql = {
  id: string
  name: string
  name_folded: string
  sort_order: number
  created_at: number
  updated_at: number
}

type EntrySql = {
  id: string
  category_id: string
  category_name: string
  question: string
  answer: string
  match_cues_json: string
  status: KnowledgeEntryStatus
  source_key: string | null
  version: number
  created_at: number
  updated_at: number
  published_at: number | null
}

export function foldKnowledgeText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function parseCues(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((c): c is string => typeof c === 'string')
  } catch {
    return []
  }
}

function normalizeCues(input: unknown): string[] {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) {
    throw new ValidationError('invalid_match_cues', 'matchCues deve ser uma lista')
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== 'string') {
      throw new ValidationError('invalid_match_cues', 'cada cue deve ser texto')
    }
    const cue = raw.trim().replace(/\s+/g, ' ')
    if (!cue) continue
    if (cue.length > KNOWLEDGE_MAX_CUE_CHARS) {
      throw new ValidationError(
        'match_cue_too_long',
        `cada cue tem no máximo ${KNOWLEDGE_MAX_CUE_CHARS} caracteres`,
      )
    }
    const folded = foldKnowledgeText(cue)
    if (seen.has(folded)) continue
    seen.add(folded)
    out.push(cue)
    if (out.length > KNOWLEDGE_MAX_CUES) {
      throw new ValidationError(
        'too_many_match_cues',
        `no máximo ${KNOWLEDGE_MAX_CUES} cues por entrada`,
      )
    }
  }
  return out
}

function mapCategory(row: CategorySql): KnowledgeCategory {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapEntry(row: EntrySql): KnowledgeEntry {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    question: row.question,
    answer: row.answer,
    matchCues: parseCues(row.match_cues_json),
    status: row.status,
    sourceKey: row.source_key,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  }
}

export function listKnowledgeCategories(
  db: ClinicDb,
  tenantId: string,
): KnowledgeCategory[] {
  const rows = db.all<CategorySql>(
      `SELECT id, name, name_folded, sort_order, created_at, updated_at
       FROM clinic_knowledge_categories
       WHERE tenant_id = ?
       ORDER BY sort_order ASC, name COLLATE NOCASE ASC`,
      tenantId,
    )
  return rows.map(mapCategory)
}

export function listKnowledgeEntries(
  db: ClinicDb,
  tenantId: string,
  opts?: { status?: KnowledgeEntryStatus },
): KnowledgeEntry[] {
  const rows = opts?.status
    ? db.all<EntrySql>(
      `SELECT e.id, e.category_id, c.name AS category_name, e.question, e.answer,
                  e.match_cues_json, e.status, e.source_key, e.version,
                  e.created_at, e.updated_at, e.published_at
           FROM clinic_knowledge_entries e
           JOIN clinic_knowledge_categories c
             ON c.tenant_id = e.tenant_id AND c.id = e.category_id
           WHERE e.tenant_id = ? AND e.status = ?
           ORDER BY e.updated_at DESC`,
      tenantId, opts.status,
    )
    : db.all<EntrySql>(
      `SELECT e.id, e.category_id, c.name AS category_name, e.question, e.answer,
                  e.match_cues_json, e.status, e.source_key, e.version,
                  e.created_at, e.updated_at, e.published_at
           FROM clinic_knowledge_entries e
           JOIN clinic_knowledge_categories c
             ON c.tenant_id = e.tenant_id AND c.id = e.category_id
           WHERE e.tenant_id = ?
           ORDER BY e.updated_at DESC`,
      tenantId,
    )
  return rows.map(mapEntry)
}

function countPublished(db: ClinicDb, tenantId: string, exceptId?: string): number {
  if (exceptId) {
    const row = db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM clinic_knowledge_entries
         WHERE tenant_id = ? AND status = 'published' AND id != ?`,
      tenantId, exceptId,
    )
    return row?.n ?? 0
  }
  const row = db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM clinic_knowledge_entries
       WHERE tenant_id = ? AND status = 'published'`,
      tenantId,
    )
  return row?.n ?? 0
}

function getCategoryRow(
  db: ClinicDb,
  tenantId: string,
  id: string,
): CategorySql | undefined {
  return db.get<CategorySql>(
      `SELECT id, name, name_folded, sort_order, created_at, updated_at
       FROM clinic_knowledge_categories WHERE tenant_id = ? AND id = ?`,
      tenantId, id,
    )
}

function getEntryRow(db: ClinicDb, tenantId: string, id: string): EntrySql | undefined {
  return db.get<EntrySql>(
      `SELECT e.id, e.category_id, c.name AS category_name, e.question, e.answer,
              e.match_cues_json, e.status, e.source_key, e.version,
              e.created_at, e.updated_at, e.published_at
       FROM clinic_knowledge_entries e
       JOIN clinic_knowledge_categories c
         ON c.tenant_id = e.tenant_id AND c.id = e.category_id
       WHERE e.tenant_id = ? AND e.id = ?`,
      tenantId, id,
    )
}

export function upsertKnowledgeCategory(
  db: ClinicDb,
  tenantId: string,
  input: { id?: string; name: string; sortOrder?: number },
  clock: Clock,
): KnowledgeCategory {
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (!name) {
    throw new ValidationError('category_name_required', 'o nome da categoria é obrigatório')
  }
  if (name.length > KNOWLEDGE_MAX_CATEGORY_NAME) {
    throw new ValidationError(
      'category_name_too_long',
      `o nome tem no máximo ${KNOWLEDGE_MAX_CATEGORY_NAME} caracteres`,
    )
  }
  const folded = foldKnowledgeText(name)
  const now = clock.nowMs()
  if (input.id) {
    const existing = getCategoryRow(db, tenantId, input.id)
    if (!existing) throw new NotFoundError('category_not_found', 'categoria não encontrada')
    const clash = db.get<{ id: string }>(
      `SELECT id FROM clinic_knowledge_categories
         WHERE tenant_id = ? AND name_folded = ? AND id != ?`,
      tenantId, folded, input.id,
    )
    if (clash) {
      throw new ValidationError('category_name_taken', 'já existe uma categoria com este nome')
    }
    const sortOrder =
      typeof input.sortOrder === 'number' ? input.sortOrder : existing.sort_order
    db.run(
      `UPDATE clinic_knowledge_categories
       SET name = ?, name_folded = ?, sort_order = ?, updated_at = ?
       WHERE tenant_id = ? AND id = ?`,
      name,
      folded,
      sortOrder,
      now,
      tenantId,
      input.id,
    )
    return mapCategory(getCategoryRow(db, tenantId, input.id)!)
  }
  const clash = db.get<{ id: string }>(
      `SELECT id FROM clinic_knowledge_categories WHERE tenant_id = ? AND name_folded = ?`,
      tenantId, folded,
    )
  if (clash) {
    throw new ValidationError('category_name_taken', 'já existe uma categoria com este nome')
  }
  const id = newId('kncat')
  const sortOrder = typeof input.sortOrder === 'number' ? input.sortOrder : 0
  db.run(
    `INSERT INTO clinic_knowledge_categories
       (tenant_id, id, name, name_folded, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    tenantId,
    id,
    name,
    folded,
    sortOrder,
    now,
    now,
  )
  return mapCategory(getCategoryRow(db, tenantId, id)!)
}

export function deleteKnowledgeCategory(
  db: ClinicDb,
  tenantId: string,
  id: string,
): { ok: true; id: string } {
  const existing = getCategoryRow(db, tenantId, id)
  if (!existing) throw new NotFoundError('category_not_found', 'categoria não encontrada')
  const used = db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM clinic_knowledge_entries
       WHERE tenant_id = ? AND category_id = ?`,
      tenantId, id,
    )
  if ((used?.n ?? 0) > 0) {
    throw new ValidationError(
      'category_has_entries',
      'apague ou mova as entradas desta categoria antes de a apagar',
    )
  }
  db.run(`DELETE FROM clinic_knowledge_categories WHERE tenant_id = ? AND id = ?`, tenantId, id)
  return { ok: true, id }
}

export type UpsertKnowledgeEntryInput = {
  id?: string
  categoryId: string
  question: string
  answer: string
  matchCues?: unknown
  status?: KnowledgeEntryStatus
  sourceKey?: string | null
}

export function upsertKnowledgeEntry(
  db: ClinicDb,
  tenantId: string,
  input: UpsertKnowledgeEntryInput,
  actor: string,
  clock: Clock,
): KnowledgeEntry {
  const category = getCategoryRow(db, tenantId, input.categoryId)
  if (!category) throw new NotFoundError('category_not_found', 'categoria não encontrada')

  const question = input.question.trim().replace(/\s+/g, ' ')
  if (!question) {
    throw new ValidationError('question_required', 'a pergunta é obrigatória')
  }
  if (question.length > KNOWLEDGE_MAX_QUESTION_CHARS) {
    throw new ValidationError(
      'question_too_long',
      `a pergunta tem no máximo ${KNOWLEDGE_MAX_QUESTION_CHARS} caracteres`,
    )
  }
  const answer = input.answer.trim()
  if (!answer) {
    throw new ValidationError('answer_required', 'a resposta é obrigatória')
  }
  if (answer.length > KNOWLEDGE_MAX_ANSWER_CHARS) {
    throw new ValidationError(
      'answer_too_long',
      `a resposta tem no máximo ${KNOWLEDGE_MAX_ANSWER_CHARS} caracteres`,
    )
  }
  const cues = normalizeCues(input.matchCues)
  const status: KnowledgeEntryStatus =
    input.status === 'published' || input.status === 'draft' ? input.status : 'draft'
  const now = clock.nowMs()

  if (status === 'published') {
    const published = countPublished(db, tenantId, input.id)
    if (published >= KNOWLEDGE_MAX_PUBLISHED) {
      throw new ValidationError(
        'published_limit',
        `no máximo ${KNOWLEDGE_MAX_PUBLISHED} entradas publicadas no piloto`,
      )
    }
  }

  if (input.id) {
    const existing = getEntryRow(db, tenantId, input.id)
    if (!existing) throw new NotFoundError('entry_not_found', 'entrada não encontrada')
    const publishedAt =
      status === 'published'
        ? existing.published_at ?? now
        : null
    db.run(
      `UPDATE clinic_knowledge_entries
       SET category_id = ?, question = ?, answer = ?, match_cues_json = ?,
           status = ?, version = version + 1, updated_by = ?, updated_at = ?,
           published_at = ?
       WHERE tenant_id = ? AND id = ?`,
      input.categoryId,
      question,
      answer,
      JSON.stringify(cues),
      status,
      actor,
      now,
      publishedAt,
      tenantId,
      input.id,
    )
    return mapEntry(getEntryRow(db, tenantId, input.id)!)
  }

  const id = newId('knent')
  const sourceKey =
    input.sourceKey === undefined || input.sourceKey === null || !input.sourceKey.trim()
      ? null
      : input.sourceKey.trim()
  db.run(
    `INSERT INTO clinic_knowledge_entries
       (tenant_id, id, category_id, question, answer, match_cues_json, status,
        source_key, version, created_by, updated_by, created_at, updated_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    tenantId,
    id,
    input.categoryId,
    question,
    answer,
    JSON.stringify(cues),
    status,
    sourceKey,
    actor,
    actor,
    now,
    now,
    status === 'published' ? now : null,
  )
  return mapEntry(getEntryRow(db, tenantId, id)!)
}

export function deleteKnowledgeEntry(
  db: ClinicDb,
  tenantId: string,
  id: string,
): { ok: true; id: string } {
  const existing = getEntryRow(db, tenantId, id)
  if (!existing) throw new NotFoundError('entry_not_found', 'entrada não encontrada')
  // DEC-185 §6: a entrada da política de sinal é gerida pelo sync DEC-180 — não apagar à mão.
  if (existing.source_key === KNOWLEDGE_SIGNAL_SOURCE_KEY) {
    throw new ValidationError(
      'signal_policy_locked',
      'a política de sinal sincroniza-se em Recebimento; não se apaga aqui',
    )
  }
  db.run(`DELETE FROM clinic_knowledge_entries WHERE tenant_id = ? AND id = ?`, tenantId, id)
  return { ok: true, id }
}

/**
 * Recuperação estruturada (DEC-185): melhor entrada published cujo cue/pergunta
 * casa no texto da cliente. Sem RAG.
 */
export function matchPublishedKnowledge(
  db: ClinicDb,
  tenantId: string,
  text: string,
): KnowledgeEntry | null {
  const folded = foldKnowledgeText(text)
  if (!folded || folded.length < 3) return null
  const published = listKnowledgeEntries(db, tenantId, { status: 'published' }).slice(
    0,
    KNOWLEDGE_MAX_PUBLISHED,
  )
  let best: { entry: KnowledgeEntry; score: number } | null = null
  for (const entry of published) {
    const cues = [
      ...entry.matchCues.map(foldKnowledgeText),
      foldKnowledgeText(entry.question),
    ].filter((c) => c.length >= 3)
    // Preferir cues curtos distintivos; a pergunta completa só conta se vários tokens casam.
    for (const cue of entry.matchCues.map(foldKnowledgeText).filter((c) => c.length >= 3)) {
      const re = new RegExp(
        `(?<![a-z0-9])${cue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`,
        'i',
      )
      if (re.test(folded)) {
        const score = cue.length * 10
        if (!best || score > best.score) best = { entry, score }
      }
    }
    // Fallback: ≥2 tokens significativos da pergunta (≥4 chars) presentes.
    const qTokens = foldKnowledgeText(entry.question)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4)
    if (qTokens.length >= 2) {
      const hits = qTokens.filter((t) =>
        new RegExp(
          `(?<![a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`,
          'i',
        ).test(folded),
      )
      if (hits.length >= Math.min(2, qTokens.length)) {
        const score = hits.join('').length
        if (!best || score > best.score) best = { entry, score }
      }
    }
    void cues
  }
  return best?.entry ?? null
}

/**
 * Garante categoria «Pagamento» e entrada published/draft da política de sinal (DEC-180/183).
 * `source_key = signal_policy` para upsert idempotente.
 */
export function syncSignalPolicyKnowledgeEntry(
  db: ClinicDb,
  tenantId: string,
  input: { policyText: string; enabled: boolean },
  actor: string,
  clock: Clock,
): KnowledgeEntry | null {
  const answer = input.policyText.trim().slice(0, KNOWLEDGE_MAX_ANSWER_CHARS)
  const now = clock.nowMs()
  let category = listKnowledgeCategories(db, tenantId).find(
    (c) => foldKnowledgeText(c.name) === foldKnowledgeText(KNOWLEDGE_SIGNAL_CATEGORY_NAME),
  )
  if (!category) {
    category = upsertKnowledgeCategory(
      db,
      tenantId,
      { name: KNOWLEDGE_SIGNAL_CATEGORY_NAME, sortOrder: 10 },
      clock,
    )
  }

  const existing = db.get<{ id: string }>(
      `SELECT e.id FROM clinic_knowledge_entries e
       WHERE e.tenant_id = ? AND e.source_key = ?`,
      tenantId, KNOWLEDGE_SIGNAL_SOURCE_KEY,
    )

  const status: KnowledgeEntryStatus =
    input.enabled && answer.length > 0 ? 'published' : 'draft'
  const cues = [
    'sinal',
    'pix',
    'cancelar',
    'remarcar',
    'adiantar',
    'política do sinal',
    'pagar antes',
    'pagamento antecipado',
    'tenho de pagar',
    'preciso pagar',
  ]

  if (existing) {
    if (!answer) {
      db.run(
        `UPDATE clinic_knowledge_entries
         SET status = 'draft', answer = '', updated_by = ?, updated_at = ?, published_at = NULL
         WHERE tenant_id = ? AND id = ?`,
        actor,
        now,
        tenantId,
        existing.id,
      )
      return getEntryRow(db, tenantId, existing.id)
        ? mapEntry(getEntryRow(db, tenantId, existing.id)!)
        : null
    }
    // Publicar pode falhar no teto — nesse caso fica draft com o texto.
    try {
      return upsertKnowledgeEntry(
        db,
        tenantId,
        {
          id: existing.id,
          categoryId: category.id,
          question: KNOWLEDGE_SIGNAL_QUESTION,
          answer,
          matchCues: cues,
          status,
        },
        actor,
        clock,
      )
    } catch (err) {
      if (err instanceof ValidationError && err.code === 'published_limit') {
        return upsertKnowledgeEntry(
          db,
          tenantId,
          {
            id: existing.id,
            categoryId: category.id,
            question: KNOWLEDGE_SIGNAL_QUESTION,
            answer,
            matchCues: cues,
            status: 'draft',
          },
          actor,
          clock,
        )
      }
      throw err
    }
  }

  if (!answer) return null
  try {
    return upsertKnowledgeEntry(
      db,
      tenantId,
      {
        categoryId: category.id,
        question: KNOWLEDGE_SIGNAL_QUESTION,
        answer,
        matchCues: cues,
        status,
        sourceKey: KNOWLEDGE_SIGNAL_SOURCE_KEY,
      },
      actor,
      clock,
    )
  } catch (err) {
    if (err instanceof ValidationError && err.code === 'published_limit') {
      return upsertKnowledgeEntry(
        db,
        tenantId,
        {
          categoryId: category.id,
          question: KNOWLEDGE_SIGNAL_QUESTION,
          answer,
          matchCues: cues,
          status: 'draft',
          sourceKey: KNOWLEDGE_SIGNAL_SOURCE_KEY,
        },
        actor,
        clock,
      )
    }
    throw err
  }
}
