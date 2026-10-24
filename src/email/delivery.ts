/**
 * Fila/idempotência de entrega de convites (#25).
 * Job durável no D1 sem token; payload com token só em memória até envio ou abandono.
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
} from './types'

const DEFAULT_MAX_ATTEMPTS = 5
const RETRY_BASE_MS = 2_000

export type PendingInvitationDelivery = {
  jobId: string
  payload: InvitationEmailPayload
}

function mapJob(row: {
  id: string
  idempotency_key: string
  template: string
  to_email: string
  tenant_id: string
  invitation_id: string
  status: string
  attempt_count: number
  max_attempts: number
  next_attempt_at: number
  last_error: string | null
  created_at: number
  updated_at: number
  sent_at: number | null
}): DeliveryJobRow {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    template: 'tenant_invitation',
    toEmail: row.to_email,
    tenantId: row.tenant_id,
    invitationId: row.invitation_id,
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
  const row = db.get<{
    id: string
    idempotency_key: string
    template: string
    to_email: string
    tenant_id: string
    invitation_id: string
    status: string
    attempt_count: number
    max_attempts: number
    next_attempt_at: number
    last_error: string | null
    created_at: number
    updated_at: number
    sent_at: number | null
  }>(
    `SELECT id, idempotency_key, template, to_email, tenant_id, invitation_id, status,
            attempt_count, max_attempts, next_attempt_at, last_error, created_at, updated_at, sent_at
     FROM email_delivery_jobs WHERE id = ?`,
    id,
  )
  return row ? mapJob(row) : undefined
}

export function getDeliveryJobByIdempotency(
  db: AdminDb,
  idempotencyKey: string,
): DeliveryJobRow | undefined {
  assertAdminSchemaReady(db)
  const row = db.get<{
    id: string
    idempotency_key: string
    template: string
    to_email: string
    tenant_id: string
    invitation_id: string
    status: string
    attempt_count: number
    max_attempts: number
    next_attempt_at: number
    last_error: string | null
    created_at: number
    updated_at: number
    sent_at: number | null
  }>(
    `SELECT id, idempotency_key, template, to_email, tenant_id, invitation_id, status,
            attempt_count, max_attempts, next_attempt_at, last_error, created_at, updated_at, sent_at
     FROM email_delivery_jobs WHERE idempotency_key = ?`,
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
        id, idempotency_key, template, to_email, tenant_id, invitation_id,
        status, attempt_count, max_attempts, next_attempt_at, last_error,
        created_at, updated_at, sent_at
      ) VALUES (?, ?, 'tenant_invitation', ?, ?, ?, 'pending', 0, ?, ?, NULL, ?, ?, NULL)`,
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
        // garantir que rawToken nunca entra mesmo se caller passar metadata errada
        ...redactSecrets({}),
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
  const now = clock.nowMs()
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
  if (result.ok) {
    db.run(
      `UPDATE email_delivery_jobs
       SET status = 'sent', attempt_count = attempt_count + 1, sent_at = ?, updated_at = ?, last_error = NULL
       WHERE id = ? AND status IN ('pending', 'failed')`,
      now,
      now,
      pending.jobId,
    )
    writeAudit(db, clock, {
      actorClerkUserId: 'system:email',
      tenantId: current.tenantId,
      action: 'email.delivery.sent',
      objectType: 'email_delivery_job',
      objectId: pending.jobId,
      outcome: 'success',
      metadata: {
        invitationId: current.invitationId,
        transport: transport.name,
        providerMessageId: result.providerMessageId,
      },
    })
    return { job: getDeliveryJob(db, pending.jobId)!, sent: true, retried: false }
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
    pending.jobId,
  )
  writeAudit(db, clock, {
    actorClerkUserId: 'system:email',
    tenantId: current.tenantId,
    action: abandoned ? 'email.delivery.abandoned' : 'email.delivery.failed',
    objectType: 'email_delivery_job',
    objectId: pending.jobId,
    outcome: 'error',
    metadata: {
      invitationId: current.invitationId,
      transport: transport.name,
      error: result.error.slice(0, 120),
      attempt: nextAttempt,
    },
  })
  return {
    job: getDeliveryJob(db, pending.jobId)!,
    sent: false,
    retried: !abandoned,
  }
}

/**
 * Agenda + tenta entrega imediata. Idempotente por (invitationId, issuedAt).
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
  // Chave por versão do token (hash), não só issuedAt — evita colisão create/resend
  // no mesmo milissegundo e mantém idempotência de retry da mesma entrega.
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

  // Só a primeira criação desta chave (ou job ainda pending/failed) tenta enviar.
  // Payload com token vive só neste stack frame.
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

export function listDeliveryJobsForInvitation(
  db: AdminDb,
  invitationId: string,
): DeliveryJobRow[] {
  assertAdminSchemaReady(db)
  const rows = db.all<{
    id: string
    idempotency_key: string
    template: string
    to_email: string
    tenant_id: string
    invitation_id: string
    status: string
    attempt_count: number
    max_attempts: number
    next_attempt_at: number
    last_error: string | null
    created_at: number
    updated_at: number
    sent_at: number | null
  }>(
    `SELECT id, idempotency_key, template, to_email, tenant_id, invitation_id, status,
            attempt_count, max_attempts, next_attempt_at, last_error, created_at, updated_at, sent_at
     FROM email_delivery_jobs WHERE invitation_id = ? ORDER BY created_at`,
    invitationId,
  )
  return rows.map(mapJob)
}
