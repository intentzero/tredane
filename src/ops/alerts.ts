/**
 * Catálogo de alertas operacionais (#44 / REQ-013 / REQ-070).
 * Emite eventos técnicos correlacionados; não envia e-mail/PagerDuty neste PR
 * (destino externo = Em aberto até staging provisionado).
 */

import {
  emitOpsLog,
  newCorrelationId,
  scrubLogDetail,
  type OpsLogLevel,
  type OpsLogSink,
} from './log'

export const OPS_ALERT_KINDS = [
  'dlq.depth',
  'outbox.stale',
  'outbound.uncertain',
  'meta.failure',
  'pix.failure',
  'ai.failure',
  'realtime.revoke',
  'tenant.purge',
  'schema.mismatch',
  'recovery.isolation',
] as const

export type OpsAlertKind = (typeof OPS_ALERT_KINDS)[number]

export type OpsAlertSeverity = 'info' | 'warning' | 'critical'

export type OpsAlert = {
  kind: OpsAlertKind
  /** Se omitido, deriva de `severityForAlert(kind)`. */
  severity?: OpsAlertSeverity
  tenantId?: string
  operation?: string
  stage?: string
  outcome?: string
  correlationId?: string
  /** Contagens / ids técnicos — sem PII. */
  fields?: Record<string, unknown>
}

const KIND_TO_LEVEL: Record<OpsAlertKind, OpsLogLevel> = {
  'dlq.depth': 'error',
  'outbox.stale': 'warn',
  'outbound.uncertain': 'warn',
  'meta.failure': 'error',
  'pix.failure': 'error',
  'ai.failure': 'warn',
  'realtime.revoke': 'info',
  'tenant.purge': 'warn',
  'schema.mismatch': 'error',
  'recovery.isolation': 'error',
}

const KIND_TO_SEVERITY: Record<OpsAlertKind, OpsAlertSeverity> = {
  'dlq.depth': 'critical',
  'outbox.stale': 'warning',
  'outbound.uncertain': 'warning',
  'meta.failure': 'critical',
  'pix.failure': 'critical',
  'ai.failure': 'warning',
  'realtime.revoke': 'info',
  'tenant.purge': 'warning',
  'schema.mismatch': 'critical',
  'recovery.isolation': 'critical',
}

export function severityForAlert(kind: OpsAlertKind): OpsAlertSeverity {
  return KIND_TO_SEVERITY[kind]
}

/**
 * Emite alerta como log estruturado (Workers Observability).
 * Destinos externos (Slack/PagerDuty) ficam Em aberto — ver runbooks.
 */
export function emitOpsAlert(
  alert: OpsAlert,
  sink?: OpsLogSink,
): { correlationId: string; severity: OpsAlertSeverity } {
  const correlationId = alert.correlationId ?? newCorrelationId('alert')
  const severity = alert.severity ?? severityForAlert(alert.kind)
  emitOpsLog(
    {
      level: KIND_TO_LEVEL[alert.kind],
      channel: 'ops.alert',
      event: `alert.${alert.kind}`,
      correlationId,
      tenantId: alert.tenantId,
      operation: alert.operation ?? alert.kind,
      stage: alert.stage,
      outcome: alert.outcome ?? severity,
      detail: {
        alertKind: alert.kind,
        severity,
        ...scrubLogDetail(alert.fields),
      },
    },
    sink,
  )
  return { correlationId, severity }
}

/** Avaliação local de sinais sintéticos — usado no harness e smoke. */
export type OpsSignalSnapshot = {
  dlqDepth?: number
  staleOutboxCount?: number
  uncertainOutboundCount?: number
  metaFailures?: number
  pixFailures?: number
  aiFailures?: number
  purgeOverdue?: boolean
  schemaMismatch?: boolean
}

export type EvaluatedAlert = {
  kind: OpsAlertKind
  severity: OpsAlertSeverity
  reason: string
  fields: Record<string, unknown>
}

/**
 * Limiares **Propostos** até medição em staging (ver budgets.ts / f6-ops.md).
 * Não são SLOs confirmados.
 */
export const PROPOSED_ALERT_THRESHOLDS = {
  dlqDepth: 1,
  staleOutboxCount: 10,
  uncertainOutboundCount: 5,
  metaFailures: 3,
  pixFailures: 3,
  aiFailures: 10,
} as const

export function evaluateOpsSignals(
  signals: OpsSignalSnapshot,
  thresholds = PROPOSED_ALERT_THRESHOLDS,
): EvaluatedAlert[] {
  const out: EvaluatedAlert[] = []
  if (
    signals.dlqDepth != null &&
    signals.dlqDepth >= thresholds.dlqDepth
  ) {
    out.push({
      kind: 'dlq.depth',
      severity: 'critical',
      reason: 'dlq_messages_present',
      fields: { dlqDepth: signals.dlqDepth },
    })
  }
  if (
    signals.staleOutboxCount != null &&
    signals.staleOutboxCount >= thresholds.staleOutboxCount
  ) {
    out.push({
      kind: 'outbox.stale',
      severity: 'warning',
      reason: 'pending_outbox_above_threshold',
      fields: { staleOutboxCount: signals.staleOutboxCount },
    })
  }
  if (
    signals.uncertainOutboundCount != null &&
    signals.uncertainOutboundCount >= thresholds.uncertainOutboundCount
  ) {
    out.push({
      kind: 'outbound.uncertain',
      severity: 'warning',
      reason: 'uncertain_outbound_above_threshold',
      fields: { uncertainOutboundCount: signals.uncertainOutboundCount },
    })
  }
  if (
    signals.metaFailures != null &&
    signals.metaFailures >= thresholds.metaFailures
  ) {
    out.push({
      kind: 'meta.failure',
      severity: 'critical',
      reason: 'meta_failures_above_threshold',
      fields: { metaFailures: signals.metaFailures },
    })
  }
  if (
    signals.pixFailures != null &&
    signals.pixFailures >= thresholds.pixFailures
  ) {
    out.push({
      kind: 'pix.failure',
      severity: 'critical',
      reason: 'pix_failures_above_threshold',
      fields: { pixFailures: signals.pixFailures },
    })
  }
  if (
    signals.aiFailures != null &&
    signals.aiFailures >= thresholds.aiFailures
  ) {
    out.push({
      kind: 'ai.failure',
      severity: 'warning',
      reason: 'ai_failures_above_threshold',
      fields: { aiFailures: signals.aiFailures },
    })
  }
  if (signals.purgeOverdue) {
    out.push({
      kind: 'tenant.purge',
      severity: 'warning',
      reason: 'purge_deadline_overdue_or_near',
      fields: { purgeOverdue: true },
    })
  }
  if (signals.schemaMismatch) {
    out.push({
      kind: 'schema.mismatch',
      severity: 'critical',
      reason: 'schema_version_mismatch',
      fields: { schemaMismatch: true },
    })
  }
  return out
}
