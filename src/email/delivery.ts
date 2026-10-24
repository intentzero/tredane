/**
 * Fila/idempotência de entrega de e-mail (#25 convites / #26 suporte).
 * Job durável no D1 sem token/handoff; payload sensível só em memória até envio.
 */
import type { Clock } from '../db/clock'
import { newId } from '../db/admin/ids'
import type { AdminDb } from '../db/admin/store'
import { assertAdminSchemaReady } from '../db/admin/gate'
import { writeAudit } from '../db/admin/audit'
import { hashToken, redactSecrets } from '../db/tokens'
import type {
  DeliveryJobRow,
  EmailTransport,
  InvitationEmailPayload,
  SupportAccessRequestEmailPayload,
  SupportSessionStartedEmailPayload,
} from './types'

const DEFAULT_MAX_ATTEMPTS = 5
const RETRY_BASE_MS = 2_000

const JOB_SELECT = `SELECT id, idempotency_key, template, to_email, tenant_id, invitation_id,
       support_request_id, support_session_id, status, attempt_count, max_attempts, next_attempt_at,
       last_error, created_at, updated_at, sent_at
FROM email_delivery_jobs`

type JobSqlRow = {
  id: string
  idempotency_key: string
  template: string
  to_email: string
  tenant_id: string
  invitation_id: string | null
  support_request_id: string | null
  support_session_id: string | null
  status: string
  attempt_count: number
  max_attempts: number
  next_attempt_at: number
  last_error: string | null
  created_at: number
  updated_at: number
  sent_at: number | null
}

export type PendingInvitationDelivery = {
  jobId: string
  payload: InvitationEmailPayload
}

export type PendingSupportRequestDelivery = {
  jobId: string
  payload: SupportAccessRequestEmailPayload
}

export type PendingSupportSessionStartedDelivery = {
  jobId: string
  payload: SupportSessionStartedEmailPayload
}

function mapTemplate(raw: string): DeliveryJobRow['template'] {
  if (raw === 'support_access_request') return 'support_access_request'
  if (raw === 'support_session_started') return 'support_session_started'
  return 'tenant_invitation'
}

function mapJob(row: JobSqlRow): DeliveryJobRow {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    template: mapTemplate(row.template),
    toEmail: row.to_email,
    tenantId: row.tenant_id,
    invitationId: row.invitation_id,
    supportRequestId: row.support_request_id,
    supportSessionId: row.support_session_id,
    status: row.status as DeliveryJobRow['status'],
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
  }
}

export function getDeliveryJob(db: AdminDb, id: string): DeliveryJobRow | undefined {
  assertAdminSchemaReady(db)
  const row = db.get<JobSqlRow>(`${JOB_SELECT} WHERE id = ?`, id)
  return row ? mapJob(row) : undefined
}

export function getDeliveryJobByIdempotency(
  db: AdminDb,
  idempotencyKey: string,
): DeliveryJobRow | undefined {
  assertAdminSchemaReady(db)
  const row = db.get<JobSqlRow>(
    `${JOB_SELECT} WHERE idempotency_key = ?`,
    idempotencyKey,
  )
  return row ? mapJob(row) : undefined
}

/**
 * Cria job idempotente. Retorna existing se a chave já existir (retry de entrega
 * não cria convite nem job extra).
 */
export function enqueueInvitationDelivery(
  db: AdminDb,
  clock: Clock,
  input: {
    idempotencyKey: string
    toEmail: string
    tenantId: string
    invitationId: string
    actorClerkUserId: string
    maxAttempts?: number
  },
): { job: DeliveryJobRow; created: boolean } {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  const existing = getDeliveryJobByIdempotency(db, input.idempotencyKey)
  if (existing) {
    return { job: existing, created: false }
  }

  const id = newId('eml')
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  return db.immediate(() => {
    const again = getDeliveryJobByIdempotency(db, input.idempotencyKey)
    if (again) return { job: again, created: false }

    db.run(
      `INSERT INTO email_delivery_jobs (
        id, idempotency_key, template, to_email, tenant_id, invitation_id, support_request_id,
        support_session_id, status, attempt_count, max_attempts, next_attempt_at, last_error,
        created_at, updated_at, sent_at
      ) VALUES (?, ?, 'tenant_invitation', ?, ?, ?, NULL, NULL, 'pending', 0, ?, ?, NULL, ?, ?, NULL)`,
      id,
      input.idempotencyKey,
      input.toEmail,
      input.tenantId,
      input.invitationId,
      maxAttempts,
      now,
      now,
      now,
    )

    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      tenantId: input.tenantId,
      action: 'email.delivery.enqueue',
      objectType: 'email_delivery_job',
      objectId: id,
      outcome: 'success',
      metadata: {
        invitationId: input.invitationId,
        email: input.toEmail,
        ...redactSecrets({}),
      },
    })

    return { job: getDeliveryJob(db, id)!, created: true }
  })
}

export function enqueueSupportRequestDelivery(
  db: AdminDb,
  clock: Clock,
  input: {
    idempotencyKey: string
    toEmail: string
    tenantId: string
    supportRequestId: string
    actorClerkUserId: string
    maxAttempts?: number
  },
): { job: DeliveryJobRow; created: boolean } {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  const existing = getDeliveryJobByIdempotency(db, input.idempotencyKey)
  if (existing) {
    return { job: existing, created: false }
  }

  const id = newId('eml')
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  return db.immediate(() => {
    const again = getDeliveryJobByIdempotency(db, input.idempotencyKey)
    if (again) return { job: again, created: false }

    db.run(
      `INSERT INTO email_delivery_jobs (
        id, idempotency_key, template, to_email, tenant_id, invitation_id, support_request_id,
        support_session_id, status, attempt_count, max_attempts, next_attempt_at, last_error,
        created_at, updated_at, sent_at
      ) VALUES (?, ?, 'support_access_request', ?, ?, NULL, ?, NULL, 'pending', 0, ?, ?, NULL, ?, ?, NULL)`,
      id,
      input.idempotencyKey,
      input.toEmail,
      input.tenantId,
      input.supportRequestId,
      maxAttempts,
      now,
      now,
      now,
    )

    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      tenantId: input.tenantId,
      action: 'email.delivery.enqueue',
      objectType: 'email_delivery_job',
      objectId: id,
      outcome: 'success',
      metadata: {
        supportRequestId: input.supportRequestId,
        email: input.toEmail,
        template: 'support_access_request',
      },
    })

    return { job: getDeliveryJob(db, id)!, created: true }
  })
}

export function enqueueSupportSessionStartedDelivery(
  db: AdminDb,
  clock: Clock,
  input: {
    idempotencyKey: string
    toEmail: string
    tenantId: string
    supportSessionId: string
    supportRequestId: string
    actorClerkUserId: string
    maxAttempts?: number
  },
): { job: DeliveryJobRow; created: boolean } {
  assertAdminSchemaReady(db)
  const now = clock.nowMs()
  const existing = getDeliveryJobByIdempotency(db, input.idempotencyKey)
  if (existing) {
    return { job: existing, created: false }
  }

  const id = newId('eml')
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  return db.immediate(() => {
    const again = getDeliveryJobByIdempotency(db, input.idempotencyKey)
    if (again) return { job: again, created: false }

    db.run(
      `INSERT INTO email_delivery_jobs (
        id, idempotency_key, template, to_email, tenant_id, invitation_id, support_request_id,
        support_session_id, status, attempt_count, max_attempts, next_attempt_at, last_error,
        created_at, updated_at, sent_at
      ) VALUES (?, ?, 'support_session_started', ?, ?, NULL, ?, ?, 'pending', 0, ?, ?, NULL, ?, ?, NULL)`,
      id,
      input.idempotencyKey,
      input.toEmail,
      input.tenantId,
      input.supportRequestId,
      input.supportSessionId,
      maxAttempts,
      now,
      now,
      now,
    )

    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      tenantId: input.tenantId,
      action: 'email.delivery.enqueue',
      objectType: 'email_delivery_job',
      objectId: id,
      outcome: 'success',
      supportSessionId: input.supportSessionId,
      metadata: {
        supportSessionId: input.supportSessionId,
        email: input.toEmail,
        template: 'support_session_started',
      },
    })

    return { job: getDeliveryJob(db, id)!, created: true }
  })
}

export type ProcessDeliveryResult = {
  job: DeliveryJobRow
  sent: boolean
  retried: boolean
}

function markDeliveryOutcome(
  db: AdminDb,
  clock: Clock,
  jobId: string,
  current: DeliveryJobRow,
  transportName: string,
  result: EmailSendResultLike,
  meta: Record<string, unknown>,
): ProcessDeliveryResult {
  const now = clock.nowMs()
  if (result.ok) {
    db.run(
      `UPDATE email_delivery_jobs
       SET status = 'sent', attempt_count = attempt_count + 1, sent_at = ?, updated_at = ?, last_error = NULL
       WHERE id = ? AND status IN ('pending', 'failed')`,
      now,
      now,
      jobId,
    )
    writeAudit(db, clock, {
      actorClerkUserId: 'system:email',
      tenantId: current.tenantId,
      action: 'email.delivery.sent',
      objectType: 'email_delivery_job',
      objectId: jobId,
      outcome: 'success',
      metadata: {
        ...meta,
        transport: transportName,
        providerMessageId: result.providerMessageId,
      },
    })
    return { job: getDeliveryJob(db, jobId)!, sent: true, retried: false }
  }

  const nextAttempt = current.attemptCount + 1
  const abandoned = nextAttempt >= current.maxAttempts || !result.retryable
  const nextAt = now + RETRY_BASE_MS * nextAttempt
  db.run(
    `UPDATE email_delivery_jobs
     SET status = ?, attempt_count = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
     WHERE id = ?`,
    abandoned ? 'abandoned' : 'failed',
    nextAttempt,
    nextAt,
    result.error.slice(0, 200),
    now,
    jobId,
  )
  writeAudit(db, clock, {
    actorClerkUserId: 'system:email',
    tenantId: current.tenantId,
    action: abandoned ? 'email.delivery.abandoned' : 'email.delivery.failed',
    objectType: 'email_delivery_job',
    objectId: jobId,
    outcome: 'error',
    metadata: {
      ...meta,
      transport: transportName,
      error: result.error.slice(0, 120),
      attempt: nextAttempt,
    },
  })
  return {
    job: getDeliveryJob(db, jobId)!,
    sent: false,
    retried: !abandoned,
  }
}

type EmailSendResultLike =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string; retryable: boolean }

/**
 * Tenta enviar. Token só existe em `payload` (memória). Falha retryable
 * incrementa tentativas sem criar novo convite.
 */
export async function processInvitationDelivery(
  db: AdminDb,
  clock: Clock,
  transport: EmailTransport,
  pending: PendingInvitationDelivery,
): Promise<ProcessDeliveryResult> {
  assertAdminSchemaReady(db)
  const current = getDeliveryJob(db, pending.jobId)
  if (!current) {
    throw new Error('delivery_job_missing')
  }
  if (current.status === 'sent') {
    return { job: current, sent: true, retried: false }
  }
  if (current.status === 'abandoned') {
    return { job: current, sent: false, retried: false }
  }

  const result = await transport.sendInvitation(pending.payload)
  return markDeliveryOutcome(db, clock, pending.jobId, current, transport.name, result, {
    invitationId: current.invitationId,
  })
}

export async function processSupportRequestDelivery(
  db: AdminDb,
  clock: Clock,
  transport: EmailTransport,
  pending: PendingSupportRequestDelivery,
): Promise<ProcessDeliveryResult> {
  assertAdminSchemaReady(db)
  const current = getDeliveryJob(db, pending.jobId)
  if (!current) {
    throw new Error('delivery_job_missing')
  }
  if (current.status === 'sent') {
    return { job: current, sent: true, retried: false }
  }
  if (current.status === 'abandoned') {
    return { job: current, sent: false, retried: false }
  }

  const result = await transport.sendSupportAccessRequest(pending.payload)
  return markDeliveryOutcome(db, clock, pending.jobId, current, transport.name, result, {
    supportRequestId: current.supportRequestId,
  })
}

export async function processSupportSessionStartedDelivery(
  db: AdminDb,
  clock: Clock,
  transport: EmailTransport,
  pending: PendingSupportSessionStartedDelivery,
): Promise<ProcessDeliveryResult> {
  assertAdminSchemaReady(db)
  const current = getDeliveryJob(db, pending.jobId)
  if (!current) {
    throw new Error('delivery_job_missing')
  }
  if (current.status === 'sent') {
    return { job: current, sent: true, retried: false }
  }
  if (current.status === 'abandoned') {
    return { job: current, sent: false, retried: false }
  }

  const result = await transport.sendSupportSessionStarted(pending.payload)
  return markDeliveryOutcome(db, clock, pending.jobId, current, transport.name, result, {
    supportSessionId: current.supportSessionId,
  })
}

/**
 * Agenda + tenta entrega imediata. Idempotente por (invitationId, tokenHash).
 * Retry de entrega reutiliza o mesmo job — não cria convite.
 */
export async function deliverInvitationEmail(
  db: AdminDb,
  clock: Clock,
  transport: EmailTransport,
  input: {
    invitationId: string
    issuedAt: number
    toEmail: string
    tenantId: string
    tenantName: string
    rawToken: string
    expiresAt: number
    appBaseUrl: string
    actorClerkUserId: string
    /** Se true, tenta imediatamente após enfileirar. */
    sendNow?: boolean
  },
): Promise<{ job: DeliveryJobRow; sent: boolean; created: boolean }> {
  const tokenHash = await hashToken(input.rawToken)
  const idempotencyKey = `inv:${input.invitationId}:${tokenHash}`
  const { job, created } = enqueueInvitationDelivery(db, clock, {
    idempotencyKey,
    toEmail: input.toEmail,
    tenantId: input.tenantId,
    invitationId: input.invitationId,
    actorClerkUserId: input.actorClerkUserId,
  })

  if (job.status === 'sent') {
    return { job, sent: true, created }
  }

  if (input.sendNow === false) {
    return { job, sent: false, created }
  }

  const processed = await processInvitationDelivery(db, clock, transport, {
    jobId: job.id,
    payload: {
      toEmail: input.toEmail,
      tenantId: input.tenantId,
      tenantName: input.tenantName,
      invitationId: input.invitationId,
      rawToken: input.rawToken,
      expiresAt: input.expiresAt,
      appBaseUrl: input.appBaseUrl,
    },
  })
  return { job: processed.job, sent: processed.sent, created }
}

/**
 * E-mail informativo de pedido de suporte (DEC-030).
 * Idempotente por (supportRequestId, toEmail). Sem credencial.
 */
export async function deliverSupportAccessRequestEmail(
  db: AdminDb,
  clock: Clock,
  transport: EmailTransport,
  input: {
    supportRequestId: string
    toEmail: string
    tenantId: string
    tenantName: string
    actorClerkUserId: string
    subjectClerkUserId: string
    reason: string
    scope: string
    expiresAt: number
    appBaseUrl: string
    /** Actor que criou o pedido (superadmin). */
    requestedByClerkUserId: string
    sendNow?: boolean
  },
): Promise<{ job: DeliveryJobRow; sent: boolean; created: boolean }> {
  const idempotencyKey = `sar:${input.supportRequestId}:${input.toEmail}`
  const { job, created } = enqueueSupportRequestDelivery(db, clock, {
    idempotencyKey,
    toEmail: input.toEmail,
    tenantId: input.tenantId,
    supportRequestId: input.supportRequestId,
    actorClerkUserId: input.requestedByClerkUserId,
  })

  if (job.status === 'sent') {
    return { job, sent: true, created }
  }

  if (input.sendNow === false) {
    return { job, sent: false, created }
  }

  const processed = await processSupportRequestDelivery(db, clock, transport, {
    jobId: job.id,
    payload: {
      toEmail: input.toEmail,
      tenantId: input.tenantId,
      tenantName: input.tenantName,
      supportRequestId: input.supportRequestId,
      actorClerkUserId: input.actorClerkUserId,
      subjectClerkUserId: input.subjectClerkUserId,
      reason: input.reason,
      scope: input.scope,
      expiresAt: input.expiresAt,
      appBaseUrl: input.appBaseUrl,
    },
  })
  return { job: processed.job, sent: processed.sent, created }
}

export function listDeliveryJobsForInvitation(
  db: AdminDb,
  invitationId: string,
): DeliveryJobRow[] {
  assertAdminSchemaReady(db)
  const rows = db.all<JobSqlRow>(
    `${JOB_SELECT} WHERE invitation_id = ? ORDER BY created_at`,
    invitationId,
  )
  return rows.map(mapJob)
}

export function listDeliveryJobsForSupportRequest(
  db: AdminDb,
  supportRequestId: string,
): DeliveryJobRow[] {
  assertAdminSchemaReady(db)
  const rows = db.all<JobSqlRow>(
    `${JOB_SELECT} WHERE support_request_id = ? ORDER BY created_at`,
    supportRequestId,
  )
  return rows.map(mapJob)
}

/**
 * E-mail de início após sessão `active` (DEC-035).
 * Idempotente por (supportSessionId, toEmail). Sem credencial.
 */
export async function deliverSupportSessionStartedEmail(
  db: AdminDb,
  clock: Clock,
  transport: EmailTransport,
  input: {
    supportSessionId: string
    supportRequestId: string
    toEmail: string
    tenantId: string
    tenantName: string
    actorClerkUserId: string
    subjectClerkUserId: string
    reason: string
    scope: string
    activatedAt: number
    expiresAt: number
    appBaseUrl: string
    sendNow?: boolean
  },
): Promise<{ job: DeliveryJobRow; sent: boolean; created: boolean }> {
  const idempotencyKey = `ssn:${input.supportSessionId}:${input.toEmail}`
  const { job, created } = enqueueSupportSessionStartedDelivery(db, clock, {
    idempotencyKey,
    toEmail: input.toEmail,
    tenantId: input.tenantId,
    supportSessionId: input.supportSessionId,
    supportRequestId: input.supportRequestId,
    actorClerkUserId: input.actorClerkUserId,
  })

  if (job.status === 'sent') {
    return { job, sent: true, created }
  }

  if (input.sendNow === false) {
    return { job, sent: false, created }
  }

  const processed = await processSupportSessionStartedDelivery(db, clock, transport, {
    jobId: job.id,
    payload: {
      toEmail: input.toEmail,
      tenantId: input.tenantId,
      tenantName: input.tenantName,
      supportSessionId: input.supportSessionId,
      supportRequestId: input.supportRequestId,
      actorClerkUserId: input.actorClerkUserId,
      subjectClerkUserId: input.subjectClerkUserId,
      reason: input.reason,
      scope: input.scope,
      activatedAt: input.activatedAt,
      expiresAt: input.expiresAt,
      appBaseUrl: input.appBaseUrl,
    },
  })
  return { job: processed.job, sent: processed.sent, created }
}

export function listDeliveryJobsForSupportSession(
  db: AdminDb,
  supportSessionId: string,
): DeliveryJobRow[] {
  assertAdminSchemaReady(db)
  const rows = db.all<JobSqlRow>(
    `${JOB_SELECT} WHERE support_session_id = ? ORDER BY created_at`,
    supportSessionId,
  )
  return rows.map(mapJob)
}
