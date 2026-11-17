/**
 * Persistência e claim/apply/fail dos jobs LLM (DEC-188).
 * Espelha o padrão outbound: claim com lease → efeito externo → apply/fail.
 */
import type { Clock } from '../../db/clock'
import { newId } from '../ids'
import type { ClinicDb } from '../store'
import type { LlmJobPurpose, LlmQueueMessage } from './llm-queue-types'
import { LLM_CLAIM_STALE_MS } from './llm-queue-types'

export type LlmJobState = 'queued' | 'claimed' | 'done' | 'failed' | 'stale'

export type LlmJobRow = {
  id: string
  tenantId: string
  conversationId: string
  messageId: string
  purpose: LlmJobPurpose
  state: LlmJobState
  idempotencyKey: string
  frameVersion: number
  snapshotJson: string
  resultJson: string | null
  errorCode: string | null
  claimedAt: number | null
  createdAt: number
  updatedAt: number
}

type JobSql = {
  id: string
  tenant_id: string
  conversation_id: string
  message_id: string
  purpose: string
  state: string
  idempotency_key: string
  frame_version: number
  snapshot_json: string
  result_json: string | null
  error_code: string | null
  claimed_at: number | null
  created_at: number
  updated_at: number
}

function mapJob(r: JobSql): LlmJobRow {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    conversationId: r.conversation_id,
    messageId: r.message_id,
    purpose: r.purpose as LlmJobPurpose,
    state: r.state as LlmJobState,
    idempotencyKey: r.idempotency_key,
    frameVersion: r.frame_version,
    snapshotJson: r.snapshot_json,
    resultJson: r.result_json,
    errorCode: r.error_code,
    claimedAt: r.claimed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function llmJobIdempotencyKey(input: {
  conversationId: string
  messageId: string
  purpose: LlmJobPurpose
}): string {
  return `llm:${input.purpose}:${input.conversationId}:${input.messageId}`
}

export function getLlmJob(db: ClinicDb, tenantId: string, jobId: string): LlmJobRow | null {
  const r = db.get<JobSql>(
    `SELECT * FROM llm_jobs WHERE tenant_id = ? AND id = ?`,
    tenantId,
    jobId,
  )
  return r ? mapJob(r) : null
}

export function getLlmJobByIdempotency(
  db: ClinicDb,
  tenantId: string,
  idempotencyKey: string,
): LlmJobRow | null {
  const r = db.get<JobSql>(
    `SELECT * FROM llm_jobs WHERE tenant_id = ? AND idempotency_key = ?`,
    tenantId,
    idempotencyKey,
  )
  return r ? mapJob(r) : null
}



export function hasOpenLlmJobForConversation(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): boolean {
  const r = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM llm_jobs
     WHERE tenant_id = ? AND conversation_id = ? AND state IN ('queued', 'claimed')`,
    tenantId,
    conversationId,
  )
  return Number(r?.n ?? 0) > 0
}

export type CreateLlmJobInput = {
  conversationId: string
  messageId: string
  purpose: LlmJobPurpose
  frameVersion: number
  snapshot: unknown
}

export type CreateLlmJobResult = {
  job: LlmJobRow
  queueMessage: LlmQueueMessage
  created: boolean
}

/** Insere ou reutiliza job idempotente ainda aberto/done. */
export function createLlmJob(
  db: ClinicDb,
  tenantId: string,
  input: CreateLlmJobInput,
  clock: Clock,
): CreateLlmJobResult {
  const idempotencyKey = llmJobIdempotencyKey(input)
  const existing = getLlmJobByIdempotency(db, tenantId, idempotencyKey)
  if (existing) {
    return {
      job: existing,
      created: false,
      queueMessage: {
        source: 'llm_job',
        tenantId,
        jobId: existing.id,
        conversationId: existing.conversationId,
        messageId: existing.messageId,
        purpose: existing.purpose,
        idempotencyKey: existing.idempotencyKey,
      },
    }
  }
  const now = clock.nowMs()
  const id = newId('llm')
  const snapshotJson = JSON.stringify(input.snapshot)
  db.run(
    `INSERT INTO llm_jobs (
       tenant_id, id, conversation_id, message_id, purpose, state, idempotency_key,
       frame_version, snapshot_json, result_json, error_code, claimed_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
    tenantId,
    id,
    input.conversationId,
    input.messageId,
    input.purpose,
    idempotencyKey,
    input.frameVersion,
    snapshotJson,
    now,
    now,
  )
  const job = getLlmJob(db, tenantId, id)!
  return {
    job,
    created: true,
    queueMessage: {
      source: 'llm_job',
      tenantId,
      jobId: job.id,
      conversationId: job.conversationId,
      messageId: job.messageId,
      purpose: job.purpose,
      idempotencyKey: job.idempotencyKey,
    },
  }
}

export type ClaimLlmJobResult =
  | { status: 'claimed'; job: LlmJobRow }
  | { status: 'done'; job: LlmJobRow }
  | { status: 'in_flight'; job: LlmJobRow }
  | { status: 'failed'; job: LlmJobRow }
  | { status: 'missing' }
  | { status: 'resolved_stale'; job: LlmJobRow }

export function claimLlmJobOp(
  db: ClinicDb,
  tenantId: string,
  input: { jobId: string; idempotencyKey: string; staleAfterMs?: number },
  clock: Clock,
): ClaimLlmJobResult {
  const staleAfter = input.staleAfterMs ?? LLM_CLAIM_STALE_MS
  const now = clock.nowMs()
  return db.transactionSync(() => {
    const row = db.get<JobSql>(
      `SELECT * FROM llm_jobs WHERE tenant_id = ? AND id = ?`,
      tenantId,
      input.jobId,
    )
    if (!row || row.idempotency_key !== input.idempotencyKey) return { status: 'missing' }
    const job = mapJob(row)
    if (job.state === 'done') return { status: 'done', job }
    if (job.state === 'failed' || job.state === 'stale') return { status: 'failed', job }
    if (job.state === 'claimed' && job.claimedAt != null) {
      if (now - job.claimedAt < staleAfter) return { status: 'in_flight', job }
      db.run(
        `UPDATE llm_jobs SET state = 'stale', error_code = 'claim_lease_expired', updated_at = ?
         WHERE tenant_id = ? AND id = ?`,
        now,
        tenantId,
        job.id,
      )
      return { status: 'resolved_stale', job: { ...job, state: 'stale', errorCode: 'claim_lease_expired', updatedAt: now } }
    }
    db.run(
      `UPDATE llm_jobs SET state = 'claimed', claimed_at = ?, updated_at = ?
       WHERE tenant_id = ? AND id = ? AND state = 'queued'`,
      now,
      now,
      tenantId,
      job.id,
    )
    const claimed = getLlmJob(db, tenantId, job.id)
    if (!claimed || claimed.state !== 'claimed') {
      // Race: outro claim ganhou.
      const again = getLlmJob(db, tenantId, job.id)
      if (!again) return { status: 'missing' }
      if (again.state === 'done') return { status: 'done', job: again }
      if (again.state === 'claimed') return { status: 'in_flight', job: again }
      return { status: 'failed', job: again }
    }
    return { status: 'claimed', job: claimed }
  })
}

export function markLlmJobDone(
  db: ClinicDb,
  tenantId: string,
  input: { jobId: string; result: unknown },
  clock: Clock,
): LlmJobRow | null {
  const now = clock.nowMs()
  db.run(
    `UPDATE llm_jobs SET state = 'done', result_json = ?, error_code = NULL, updated_at = ?
     WHERE tenant_id = ? AND id = ? AND state IN ('queued', 'claimed')`,
    JSON.stringify(input.result),
    now,
    tenantId,
    input.jobId,
  )
  return getLlmJob(db, tenantId, input.jobId)
}

export function markLlmJobFailed(
  db: ClinicDb,
  tenantId: string,
  input: { jobId: string; errorCode: string; result?: unknown },
  clock: Clock,
): LlmJobRow | null {
  const now = clock.nowMs()
  db.run(
    `UPDATE llm_jobs SET state = 'failed', error_code = ?, result_json = ?, updated_at = ?
     WHERE tenant_id = ? AND id = ? AND state IN ('queued', 'claimed', 'stale')`,
    input.errorCode,
    input.result != null ? JSON.stringify(input.result) : null,
    now,
    tenantId,
    input.jobId,
  )
  return getLlmJob(db, tenantId, input.jobId)
}

export function parseSnapshot<T>(job: LlmJobRow): T | null {
  try {
    return JSON.parse(job.snapshotJson) as T
  } catch {
    return null
  }
}

