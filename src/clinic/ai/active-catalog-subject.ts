/**
 * ActiveCatalogSubject — DEC-223.
 * Último serviço/variante referido na conversa para handlers fechados
 * (price, faq_catalog, pré-escolha CTA) quando o turno actual não nomeia.
 * Não autoriza marcar; não mistura com BookingFrame.
 */
import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'
import type { ScheduleAudienceLine } from './schedule-session'

export const ACTIVE_CATALOG_SUBJECT_TTL_MS = 24 * 60 * 60 * 1000

export type ActiveCatalogSubjectSource =
  | 'faq_offer'
  | 'faq_clarification'
  | 'price'
  | 'named_turn'
  | 'agenda_preselect'

export type ActiveCatalogSubject = {
  serviceId: string
  variantIds: string[]
  audienceLine: ScheduleAudienceLine | null
  source: ActiveCatalogSubjectSource
  catalogVersion: string
  updatedAt: number
}

export type ActiveCatalogSubjectPatch = {
  serviceId: string
  variantIds?: string[]
  audienceLine?: ScheduleAudienceLine | null
  source: ActiveCatalogSubjectSource
  catalogVersion?: string
}

type SubjectSql = {
  service_id: string
  variant_ids: string | null
  audience_line: string | null
  source: string
  catalog_version: string
  updated_at: number
}

function asVariantIds(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
  } catch {
    return []
  }
}

function asAudienceLine(raw: string | null): ScheduleAudienceLine | null {
  return raw === 'feminino' || raw === 'masculino' ? raw : null
}

function asSource(raw: string): ActiveCatalogSubjectSource | null {
  switch (raw) {
    case 'faq_offer':
    case 'faq_clarification':
    case 'price':
    case 'named_turn':
    case 'agenda_preselect':
      return raw
    default:
      return null
  }
}

function rowToSubject(row: SubjectSql): ActiveCatalogSubject | null {
  const source = asSource(row.source)
  if (!source || !row.service_id.trim()) return null
  return {
    serviceId: row.service_id,
    variantIds: asVariantIds(row.variant_ids),
    audienceLine: asAudienceLine(row.audience_line),
    source,
    catalogVersion: row.catalog_version ?? '',
    updatedAt: row.updated_at,
  }
}

/**
 * Lê o sujeito activo se ainda válido (TTL 24 h, ids no catálogo).
 * `nowMs` omitido → não aplica TTL (só catálogo).
 */
export function getActiveCatalogSubject(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  opts?: {
    nowMs?: number
    catalog?: {
      version: string
      serviceIds: ReadonlySet<string>
      variantIds: ReadonlySet<string>
    }
  },
): ActiveCatalogSubject | null {
  const row = db.get<SubjectSql>(
    `SELECT service_id, variant_ids, audience_line, source, catalog_version, updated_at
     FROM active_catalog_subjects
     WHERE tenant_id = ? AND conversation_id = ?`,
    tenantId,
    conversationId,
  )
  if (!row) return null
  const subject = rowToSubject(row)
  if (!subject) {
    clearActiveCatalogSubject(db, tenantId, conversationId)
    return null
  }
  if (opts?.nowMs != null && opts.nowMs - subject.updatedAt > ACTIVE_CATALOG_SUBJECT_TTL_MS) {
    clearActiveCatalogSubject(db, tenantId, conversationId)
    return null
  }
  const catalog = opts?.catalog
  if (catalog) {
    if (!catalog.serviceIds.has(subject.serviceId)) {
      clearActiveCatalogSubject(db, tenantId, conversationId)
      return null
    }
    const okVariants = subject.variantIds.filter((id) => catalog.variantIds.has(id))
    if (okVariants.length !== subject.variantIds.length) {
      if (okVariants.length === 0 && subject.variantIds.length > 0) {
        clearActiveCatalogSubject(db, tenantId, conversationId)
        return null
      }
      setActiveCatalogSubject(
        db,
        tenantId,
        conversationId,
        {
          serviceId: subject.serviceId,
          variantIds: okVariants,
          audienceLine: subject.audienceLine,
          source: subject.source,
          catalogVersion: catalog.version,
        },
        { nowMs: subject.updatedAt },
      )
      return {
        ...subject,
        variantIds: okVariants,
        catalogVersion: catalog.version,
      }
    }
    if (catalog.version && subject.catalogVersion && subject.catalogVersion !== catalog.version) {
      // Versão mudou mas ids ainda válidos — actualiza o carimbo.
      setActiveCatalogSubject(
        db,
        tenantId,
        conversationId,
        {
          serviceId: subject.serviceId,
          variantIds: subject.variantIds,
          audienceLine: subject.audienceLine,
          source: subject.source,
          catalogVersion: catalog.version,
        },
        { nowMs: subject.updatedAt },
      )
      return { ...subject, catalogVersion: catalog.version }
    }
  }
  return subject
}

function resolveNowMs(clockOrNow: Clock | { nowMs: number }): number {
  // Clock.nowMs é função; `{ nowMs: number }` é carimbo literal (revalidação).
  if (typeof (clockOrNow as Clock).nowMs === 'function') {
    return (clockOrNow as Clock).nowMs()
  }
  return (clockOrNow as { nowMs: number }).nowMs
}

export function setActiveCatalogSubject(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  patch: ActiveCatalogSubjectPatch,
  clockOrNow: Clock | { nowMs: number },
): ActiveCatalogSubject {
  const nowMs = resolveNowMs(clockOrNow)
  const serviceId = patch.serviceId.trim()
  if (!serviceId) {
    throw new Error('active_catalog_subject: serviceId obrigatório')
  }
  const variantIds = patch.variantIds ?? []
  const audienceLine =
    patch.audienceLine === undefined ? null : patch.audienceLine
  const catalogVersion = patch.catalogVersion ?? ''
  db.run(
    `INSERT INTO active_catalog_subjects (
       tenant_id, conversation_id, service_id, variant_ids, audience_line,
       source, catalog_version, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, conversation_id) DO UPDATE SET
       service_id = excluded.service_id,
       variant_ids = excluded.variant_ids,
       audience_line = excluded.audience_line,
       source = excluded.source,
       catalog_version = excluded.catalog_version,
       updated_at = excluded.updated_at`,
    tenantId,
    conversationId,
    serviceId,
    variantIds.length > 0 ? JSON.stringify(variantIds) : null,
    audienceLine,
    patch.source,
    catalogVersion,
    nowMs,
  )
  return {
    serviceId,
    variantIds,
    audienceLine,
    source: patch.source,
    catalogVersion,
    updatedAt: nowMs,
  }
}

export function clearActiveCatalogSubject(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): void {
  db.run(
    `DELETE FROM active_catalog_subjects WHERE tenant_id = ? AND conversation_id = ?`,
    tenantId,
    conversationId,
  )
}
