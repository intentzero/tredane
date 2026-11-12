/**
 * Persistência D1 das amostras de revisão (DEC-159).
 * Sync AdminDb (testes) e D1 async (produção).
 */
import { newId } from '../db/admin/ids'
import type { AdminDb } from '../db/admin/store'
import { REVIEW_SAMPLE_TTL_MS } from './constants'
import type {
  ReviewSampleDetail,
  ReviewSampleListItem,
  ReviewSampleSnapshot,
} from './types'

type SampleRow = {
  id: string
  tenant_id: string
  tenant_name: string | null
  conversation_id: string
  contact_id: string | null
  contact_wa_id: string | null
  contact_display_name: string | null
  flag_source: string
  flag_reason: string | null
  client_comment: string | null
  flagged_at: number
  copied_at: number
  expires_at: number
  message_count: number
  last_message_at: number | null
  last_message_preview: string | null
}

type MessageRow = {
  id: string
  sample_id: string
  message_id: string
  seq: number
  direction: string
  body: string
  created_at: number
  delivery_state: string | null
  author_clerk_user_id: string | null
  author_display_name: string | null
}

function mapSample(row: SampleRow): ReviewSampleListItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    contactWaId: row.contact_wa_id,
    contactDisplayName: row.contact_display_name,
    flagSource: row.flag_source,
    flagReason: row.flag_reason,
    clientComment: row.client_comment ?? null,
    flaggedAt: row.flagged_at,
    copiedAt: row.copied_at,
    expiresAt: row.expires_at,
    messageCount: row.message_count,
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview,
  }
}

export function upsertReviewSampleSync(
  db: AdminDb,
  snapshot: ReviewSampleSnapshot,
  nowMs: number,
): { sampleId: string; created: boolean } {
  const expiresAt = nowMs + REVIEW_SAMPLE_TTL_MS
  const existing = db.get<{ id: string }>(
    `SELECT id FROM review_samples WHERE tenant_id = ? AND conversation_id = ?`,
    snapshot.tenantId,
    snapshot.conversationId,
  )
  const sampleId = existing?.id ?? newId('rsamp')
  const created = !existing

  if (existing) {
    db.run(`DELETE FROM review_sample_messages WHERE sample_id = ?`, sampleId)
    db.run(
      `UPDATE review_samples SET
        tenant_name = ?, contact_id = ?, contact_wa_id = ?, contact_display_name = ?,
        flag_source = ?, flag_reason = ?, client_comment = ?, flagged_at = ?, copied_at = ?,
        expires_at = ?, message_count = ?, last_message_at = ?, last_message_preview = ?
       WHERE id = ?`,
      snapshot.tenantName,
      snapshot.contactId,
      snapshot.contactWaId,
      snapshot.contactDisplayName,
      snapshot.flagSource,
      snapshot.flagReason,
      snapshot.clientComment,
      snapshot.flaggedAt,
      nowMs,
      expiresAt,
      snapshot.messages.length,
      snapshot.lastMessageAt,
      snapshot.lastMessagePreview,
      sampleId,
    )
  } else {
    db.run(
      `INSERT INTO review_samples (
        id, tenant_id, tenant_name, conversation_id, contact_id, contact_wa_id,
        contact_display_name, flag_source, flag_reason, client_comment, flagged_at,
        copied_at, expires_at, message_count, last_message_at, last_message_preview
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sampleId,
      snapshot.tenantId,
      snapshot.tenantName,
      snapshot.conversationId,
      snapshot.contactId,
      snapshot.contactWaId,
      snapshot.contactDisplayName,
      snapshot.flagSource,
      snapshot.flagReason,
      snapshot.clientComment,
      snapshot.flaggedAt,
      nowMs,
      expiresAt,
      snapshot.messages.length,
      snapshot.lastMessageAt,
      snapshot.lastMessagePreview,
    )
  }

  for (let i = 0; i < snapshot.messages.length; i++) {
    const m = snapshot.messages[i]!
    db.run(
      `INSERT INTO review_sample_messages (
        id, sample_id, message_id, seq, direction, body, created_at,
        delivery_state, author_clerk_user_id, author_display_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId('rsmsg'),
      sampleId,
      m.messageId,
      i,
      m.direction,
      m.body,
      m.createdAt,
      m.deliveryState,
      m.authorClerkUserId,
      m.authorDisplayName,
    )
  }

  return { sampleId, created }
}

export async function upsertReviewSampleD1(
  d1: D1Database,
  snapshot: ReviewSampleSnapshot,
  nowMs: number,
): Promise<{ sampleId: string; created: boolean }> {
  const expiresAt = nowMs + REVIEW_SAMPLE_TTL_MS
  const existing = await d1
    .prepare(
      `SELECT id FROM review_samples WHERE tenant_id = ? AND conversation_id = ?`,
    )
    .bind(snapshot.tenantId, snapshot.conversationId)
    .first<{ id: string }>()
  const sampleId = existing?.id ?? newId('rsamp')
  const created = !existing

  const stmts: D1PreparedStatement[] = []
  if (existing) {
    stmts.push(
      d1.prepare(`DELETE FROM review_sample_messages WHERE sample_id = ?`).bind(sampleId),
      d1
        .prepare(
          `UPDATE review_samples SET
            tenant_name = ?, contact_id = ?, contact_wa_id = ?, contact_display_name = ?,
            flag_source = ?, flag_reason = ?, client_comment = ?, flagged_at = ?, copied_at = ?,
            expires_at = ?, message_count = ?, last_message_at = ?, last_message_preview = ?
           WHERE id = ?`,
        )
        .bind(
          snapshot.tenantName,
          snapshot.contactId,
          snapshot.contactWaId,
          snapshot.contactDisplayName,
          snapshot.flagSource,
          snapshot.flagReason,
          snapshot.clientComment,
          snapshot.flaggedAt,
          nowMs,
          expiresAt,
          snapshot.messages.length,
          snapshot.lastMessageAt,
          snapshot.lastMessagePreview,
          sampleId,
        ),
    )
  } else {
    stmts.push(
      d1
        .prepare(
          `INSERT INTO review_samples (
            id, tenant_id, tenant_name, conversation_id, contact_id, contact_wa_id,
            contact_display_name, flag_source, flag_reason, client_comment, flagged_at,
            copied_at, expires_at, message_count, last_message_at, last_message_preview
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          sampleId,
          snapshot.tenantId,
          snapshot.tenantName,
          snapshot.conversationId,
          snapshot.contactId,
          snapshot.contactWaId,
          snapshot.contactDisplayName,
          snapshot.flagSource,
          snapshot.flagReason,
          snapshot.clientComment,
          snapshot.flaggedAt,
          nowMs,
          expiresAt,
          snapshot.messages.length,
          snapshot.lastMessageAt,
          snapshot.lastMessagePreview,
        ),
    )
  }

  for (let i = 0; i < snapshot.messages.length; i++) {
    const m = snapshot.messages[i]!
    stmts.push(
      d1
        .prepare(
          `INSERT INTO review_sample_messages (
            id, sample_id, message_id, seq, direction, body, created_at,
            delivery_state, author_clerk_user_id, author_display_name
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          newId('rsmsg'),
          sampleId,
          m.messageId,
          i,
          m.direction,
          m.body,
          m.createdAt,
          m.deliveryState,
          m.authorClerkUserId,
          m.authorDisplayName,
        ),
    )
  }

  await d1.batch(stmts)
  return { sampleId, created }
}

export function listReviewSamplesSync(
  db: AdminDb,
  opts: {
    before?: number | null
    limit?: number
    tenantId?: string | null
    source?: string | null
    nowMs: number
  },
): { items: ReviewSampleListItem[]; nextBefore: number | null } {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100)
  const clauses = [`expires_at > ?`]
  const params: Array<string | number | null> = [opts.nowMs]
  if (opts.tenantId) {
    clauses.push(`tenant_id = ?`)
    params.push(opts.tenantId)
  }
  if (opts.source) {
    clauses.push(`flag_source = ?`)
    params.push(opts.source)
  }
  if (opts.before != null) {
    clauses.push(`flagged_at < ?`)
    params.push(opts.before)
  }
  params.push(limit + 1)
  const rows = db.all<SampleRow>(
    `SELECT * FROM review_samples
     WHERE ${clauses.join(' AND ')}
     ORDER BY flagged_at DESC
     LIMIT ?`,
    ...params,
  )
  const page = rows.slice(0, limit)
  const nextBefore =
    rows.length > limit && page.length > 0 ? page[page.length - 1]!.flagged_at : null
  return { items: page.map(mapSample), nextBefore }
}

export async function listReviewSamplesD1(
  d1: D1Database,
  opts: {
    before?: number | null
    limit?: number
    tenantId?: string | null
    source?: string | null
    nowMs: number
  },
): Promise<{ items: ReviewSampleListItem[]; nextBefore: number | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100)
  const clauses = [`expires_at > ?`]
  const params: unknown[] = [opts.nowMs]
  if (opts.tenantId) {
    clauses.push(`tenant_id = ?`)
    params.push(opts.tenantId)
  }
  if (opts.source) {
    clauses.push(`flag_source = ?`)
    params.push(opts.source)
  }
  if (opts.before != null) {
    clauses.push(`flagged_at < ?`)
    params.push(opts.before)
  }
  params.push(limit + 1)
  const result = await d1
    .prepare(
      `SELECT * FROM review_samples
       WHERE ${clauses.join(' AND ')}
       ORDER BY flagged_at DESC
       LIMIT ?`,
    )
    .bind(...params)
    .all<SampleRow>()
  const rows = result.results ?? []
  const page = rows.slice(0, limit)
  const nextBefore =
    rows.length > limit && page.length > 0 ? page[page.length - 1]!.flagged_at : null
  return { items: page.map(mapSample), nextBefore }
}

export function getReviewSampleSync(
  db: AdminDb,
  sampleId: string,
  nowMs: number,
): ReviewSampleDetail | null {
  const row = db.get<SampleRow>(
    `SELECT * FROM review_samples WHERE id = ? AND expires_at > ?`,
    sampleId,
    nowMs,
  )
  if (!row) return null
  const messages = db.all<MessageRow>(
    `SELECT * FROM review_sample_messages WHERE sample_id = ? ORDER BY seq ASC`,
    sampleId,
  )
  return {
    ...mapSample(row),
    messages: messages.map((m) => ({
      id: m.id,
      messageId: m.message_id,
      seq: m.seq,
      direction: m.direction,
      body: m.body,
      createdAt: m.created_at,
      deliveryState: m.delivery_state,
      authorClerkUserId: m.author_clerk_user_id,
      authorDisplayName: m.author_display_name,
    })),
  }
}

export async function getReviewSampleD1(
  d1: D1Database,
  sampleId: string,
  nowMs: number,
): Promise<ReviewSampleDetail | null> {
  const row = await d1
    .prepare(`SELECT * FROM review_samples WHERE id = ? AND expires_at > ?`)
    .bind(sampleId, nowMs)
    .first<SampleRow>()
  if (!row) return null
  const msgResult = await d1
    .prepare(
      `SELECT * FROM review_sample_messages WHERE sample_id = ? ORDER BY seq ASC`,
    )
    .bind(sampleId)
    .all<MessageRow>()
  const messages = msgResult.results ?? []
  return {
    ...mapSample(row),
    messages: messages.map((m) => ({
      id: m.id,
      messageId: m.message_id,
      seq: m.seq,
      direction: m.direction,
      body: m.body,
      createdAt: m.created_at,
      deliveryState: m.delivery_state,
      authorClerkUserId: m.author_clerk_user_id,
      authorDisplayName: m.author_display_name,
    })),
  }
}

export function purgeExpiredReviewSamplesSync(
  db: AdminDb,
  nowMs: number,
): { deleted: number } {
  const before = db.get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM review_samples WHERE expires_at <= ?`,
    nowMs,
  )
  db.run(`DELETE FROM review_samples WHERE expires_at <= ?`, nowMs)
  return { deleted: before?.c ?? 0 }
}

export async function purgeExpiredReviewSamplesD1(
  d1: D1Database,
  nowMs: number,
): Promise<{ deleted: number }> {
  const before = await d1
    .prepare(`SELECT COUNT(*) AS c FROM review_samples WHERE expires_at <= ?`)
    .bind(nowMs)
    .first<{ c: number }>()
  await d1
    .prepare(`DELETE FROM review_samples WHERE expires_at <= ?`)
    .bind(nowMs)
    .run()
  return { deleted: before?.c ?? 0 }
}

export function deleteReviewSamplesForConversationSync(
  db: AdminDb,
  tenantId: string,
  conversationId: string,
): void {
  db.run(
    `DELETE FROM review_samples WHERE tenant_id = ? AND conversation_id = ?`,
    tenantId,
    conversationId,
  )
}

export async function deleteReviewSamplesForConversationD1(
  d1: D1Database,
  tenantId: string,
  conversationId: string,
): Promise<void> {
  await d1
    .prepare(
      `DELETE FROM review_samples WHERE tenant_id = ? AND conversation_id = ?`,
    )
    .bind(tenantId, conversationId)
    .run()
}

export function deleteReviewSamplesForTenantSync(db: AdminDb, tenantId: string): void {
  db.run(`DELETE FROM review_samples WHERE tenant_id = ?`, tenantId)
}

export async function deleteReviewSamplesForTenantD1(
  d1: D1Database,
  tenantId: string,
): Promise<void> {
  await d1
    .prepare(`DELETE FROM review_samples WHERE tenant_id = ?`)
    .bind(tenantId)
    .run()
}
