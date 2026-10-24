/**
 * Medição sintética de latência / contagens (#44).
 * Não consulta billing Cloudflare — só tempos e cardinalidades locais.
 */

import { summarizeLatency, type LatencySummary } from './budgets'

export type OpsClinicSnapshot = {
  tenantId: string
  schemaVersion: number | null
  schemaReady: boolean
  pendingOutbox: number
  failedOutbox: number
  uncertainOutbound: number
  contactCount: number
  messageCount: number
  appointmentCount: number
  attachmentMetaCount: number
  openWsConnections?: number
}

export type SyntheticLoadResult = {
  samples: LatencySummary[]
  clinicSnapshots: OpsClinicSnapshot[]
  /** true se todos os p95 medidos respeitam budgets Propostos aplicáveis. */
  withinProposedBudgets: boolean
  measuredAt: string
}

export async function measureDurationsMs(
  name: string,
  iterations: number,
  fn: () => Promise<void>,
): Promise<LatencySummary> {
  const durationsMs: number[] = []
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now()
    await fn()
    durationsMs.push(performance.now() - start)
  }
  return summarizeLatency({ name, durationsMs })
}

/**
 * Agrega snapshots de duas clínicas sintéticas e amostras de latência.
 * Usado por harness HTTP e testes unitários.
 */
export function buildSyntheticLoadReport(input: {
  samples: LatencySummary[]
  clinicSnapshots: OpsClinicSnapshot[]
  now?: Date
}): SyntheticLoadResult {
  const applicable = input.samples.filter((s) => s.withinProposedP95 !== null)
  const within =
    applicable.length === 0
      ? true
      : applicable.every((s) => s.withinProposedP95 === true)
  return {
    samples: input.samples,
    clinicSnapshots: input.clinicSnapshots,
    withinProposedBudgets: within,
    measuredAt: (input.now ?? new Date()).toISOString(),
  }
}

/** Contagens SQL no ClinicDb — sem ler conteúdo de mensagens. */
export function countClinicOpsRows(
  db: {
    get: <T>(sql: string, ...params: unknown[]) => T | null
  },
  tenantId: string,
): Omit<OpsClinicSnapshot, 'tenantId' | 'schemaVersion' | 'schemaReady' | 'openWsConnections'> {
  const pendingOutbox =
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM outbox_events
       WHERE tenant_id = ? AND processing_state IN ('pending', 'publishing')`,
      tenantId,
    )?.n ?? 0
  const failedOutbox =
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM outbox_events
       WHERE tenant_id = ? AND processing_state = 'failed'`,
      tenantId,
    )?.n ?? 0
  const uncertainOutbound =
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM outbound_messages
       WHERE tenant_id = ? AND delivery_state IN ('unknown', 'pending')`,
      tenantId,
    )?.n ?? 0
  const contactCount =
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM contacts WHERE tenant_id = ?`,
      tenantId,
    )?.n ?? 0
  const messageCount =
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ?`,
      tenantId,
    )?.n ?? 0
  const appointmentCount =
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`,
      tenantId,
    )?.n ?? 0
  const attachmentMetaCount =
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM attachments WHERE tenant_id = ?`,
      tenantId,
    )?.n ?? 0
  return {
    pendingOutbox,
    failedOutbox,
    uncertainOutbound,
    contactCount,
    messageCount,
    appointmentCount,
    attachmentMetaCount,
  }
}
