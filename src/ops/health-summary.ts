/**
 * Resumo periódico de saúde por clínica (DEC-193, #833).
 *
 * Um cron lê o `getOpsSnapshot` de cada Durable Object e grava só contagens e estados em
 * `tenant_health_summary` (D1 central). A Platform Admin lê desta tabela e nunca consulta o DO
 * a cada visita. Sem conteúdo de conversa, contactos ou telefones. O mesmo SQL corre no store
 * síncrono (testes) e no D1 (`AsyncAdminDb`).
 */
import type { AsyncAdminDb } from '../db/admin/async-store'
import {
  evaluateOpsSignals,
  PROPOSED_ALERT_THRESHOLDS,
  type EvaluatedAlert,
  type OpsAlertSeverity,
} from './alerts'
import type { OpsClinicSnapshot } from './metrics'

/** Intervalo do cron (`wrangler.jsonc`); a UI avisa quando a leitura é bem mais velha que isto. */
export const HEALTH_REFRESH_INTERVAL_MS = 10 * 60 * 1000
export const HEALTH_READ_TIMEOUT_MS = 5_000
const HEALTH_CONCURRENCY = 5

export type HealthSummaryRow = {
  tenantId: string
  readAt: number
  lastOkAt: number | null
  status: 'ok' | 'unreachable'
  schemaVersion: number | null
  schemaReady: boolean | null
  pendingOutbox: number | null
  failedOutbox: number | null
  uncertainOutbound: number | null
  llmJobsOpen: number | null
  llmJobsFailed1h: number | null
  /** Volume (Q-PA-04): só contagens; `null` nas linhas anteriores à migração 0026. */
  contactCount: number | null
  messageCount: number | null
  appointmentCount: number | null
  attachmentCount: number | null
}

type RawSummary = {
  tenant_id: string
  read_at: number
  last_ok_at: number | null
  status: string
  schema_version: number | null
  schema_ready: number | null
  pending_outbox: number | null
  failed_outbox: number | null
  uncertain_outbound: number | null
  llm_jobs_open: number | null
  llm_jobs_failed_1h: number | null
  contact_count: number | null
  message_count: number | null
  appointment_count: number | null
  attachment_count: number | null
}

const num = (v: number | null | undefined): number | null => (v === null || v === undefined ? null : Number(v))

function mapSummary(r: RawSummary): HealthSummaryRow {
  return {
    tenantId: r.tenant_id,
    readAt: Number(r.read_at),
    lastOkAt: num(r.last_ok_at),
    status: r.status === 'ok' ? 'ok' : 'unreachable',
    schemaVersion: num(r.schema_version),
    schemaReady: r.schema_ready === null || r.schema_ready === undefined ? null : Number(r.schema_ready) === 1,
    pendingOutbox: num(r.pending_outbox),
    failedOutbox: num(r.failed_outbox),
    uncertainOutbound: num(r.uncertain_outbound),
    llmJobsOpen: num(r.llm_jobs_open),
    llmJobsFailed1h: num(r.llm_jobs_failed_1h),
    contactCount: num(r.contact_count),
    messageCount: num(r.message_count),
    appointmentCount: num(r.appointment_count),
    attachmentCount: num(r.attachment_count),
  }
}

/** Situação mostrada ao operador. Limiares **Propostos** (`PROPOSED_ALERT_THRESHOLDS`), não SLOs. */
export type HealthSituation = 'critical' | 'attention' | 'normal' | 'no_data'

export type HealthAlert = {
  kind: EvaluatedAlert['kind']
  severity: OpsAlertSeverity
  reason: string
  value: number | null
  threshold: number | null
}

const ALERT_VALUE: Partial<Record<EvaluatedAlert['kind'], { field: string; threshold: number | null }>> = {
  'outbox.stale': { field: 'staleOutboxCount', threshold: PROPOSED_ALERT_THRESHOLDS.staleOutboxCount },
  'outbound.uncertain': { field: 'uncertainOutboundCount', threshold: PROPOSED_ALERT_THRESHOLDS.uncertainOutboundCount },
  'ai.failure': { field: 'aiFailures', threshold: PROPOSED_ALERT_THRESHOLDS.aiFailures },
}

/**
 * Regras (Propostas):
 * - sem leitura bem-sucedida → «sem dados»;
 * - crítico: alerta crítico (schema fora de versão) ou WhatsApp interrompido pela Meta;
 * - atenção: qualquer alerta de aviso, ou envios falhados/incertos, ou jobs de IA falhados na última hora;
 * - senão normal.
 */
export function assessHealth(
  row: HealthSummaryRow | null,
  whatsappStatus: string,
): { situation: HealthSituation; alerts: HealthAlert[]; stale: boolean } {
  if (!row || row.lastOkAt === null) return { situation: 'no_data', alerts: [], stale: row?.status === 'unreachable' }
  const evaluated = evaluateOpsSignals({
    staleOutboxCount: row.pendingOutbox ?? undefined,
    uncertainOutboundCount: row.uncertainOutbound ?? undefined,
    aiFailures: row.llmJobsFailed1h ?? undefined,
    schemaMismatch: row.schemaReady === false,
  })
  const alerts: HealthAlert[] = evaluated.map((a) => {
    const meta = ALERT_VALUE[a.kind]
    const raw = meta ? a.fields[meta.field] : undefined
    return {
      kind: a.kind,
      severity: a.severity,
      reason: a.reason,
      value: typeof raw === 'number' ? raw : null,
      threshold: meta?.threshold ?? null,
    }
  })
  const critical = alerts.some((a) => a.severity === 'critical') || whatsappStatus === 'error'
  const attention =
    alerts.length > 0 ||
    (row.failedOutbox ?? 0) > 0 ||
    (row.uncertainOutbound ?? 0) > 0 ||
    (row.llmJobsFailed1h ?? 0) > 0
  return { situation: critical ? 'critical' : attention ? 'attention' : 'normal', alerts, stale: row.status === 'unreachable' }
}

type ReadSnapshot = (tenantId: string) => Promise<Partial<OpsClinicSnapshot> & { tenantId: string }>

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('health_read_timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/** Lê o DO de uma clínica e grava o resumo. Falha/timeout → `unreachable`, mantendo a última leitura boa. */
export async function refreshTenantHealth(
  db: AsyncAdminDb,
  tenantId: string,
  readSnapshot: ReadSnapshot,
  nowMs: number,
  timeoutMs = HEALTH_READ_TIMEOUT_MS,
): Promise<'ok' | 'unreachable'> {
  try {
    const snap = await withTimeout(readSnapshot(tenantId), timeoutMs)
    await db.run(
      `INSERT INTO tenant_health_summary (
         tenant_id, read_at, last_ok_at, status, schema_version, schema_ready,
         pending_outbox, failed_outbox, uncertain_outbound, llm_jobs_open, llm_jobs_failed_1h,
         contact_count, message_count, appointment_count, attachment_count
       ) VALUES (?, ?, ?, 'ok', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id) DO UPDATE SET
         read_at = excluded.read_at, last_ok_at = excluded.last_ok_at, status = 'ok',
         schema_version = excluded.schema_version, schema_ready = excluded.schema_ready,
         pending_outbox = excluded.pending_outbox, failed_outbox = excluded.failed_outbox,
         uncertain_outbound = excluded.uncertain_outbound,
         llm_jobs_open = excluded.llm_jobs_open, llm_jobs_failed_1h = excluded.llm_jobs_failed_1h,
         contact_count = excluded.contact_count, message_count = excluded.message_count,
         appointment_count = excluded.appointment_count, attachment_count = excluded.attachment_count`,
      tenantId,
      nowMs,
      nowMs,
      snap.schemaVersion ?? null,
      snap.schemaReady === undefined ? null : snap.schemaReady ? 1 : 0,
      snap.pendingOutbox ?? null,
      snap.failedOutbox ?? null,
      snap.uncertainOutbound ?? null,
      snap.llmJobsOpen ?? null,
      snap.llmJobsFailed1h ?? null,
      snap.contactCount ?? null,
      snap.messageCount ?? null,
      snap.appointmentCount ?? null,
      snap.attachmentMetaCount ?? null,
    )
    return 'ok'
  } catch {
    await db.run(
      `INSERT INTO tenant_health_summary (tenant_id, read_at, last_ok_at, status)
       VALUES (?, ?, NULL, 'unreachable')
       ON CONFLICT(tenant_id) DO UPDATE SET read_at = excluded.read_at, status = 'unreachable'`,
      tenantId,
      nowMs,
    )
    return 'unreachable'
  }
}

/** Percorre as clínicas ativas (as suspensas ou em exclusão têm o DO vedado e ficam com a última leitura). */
export async function refreshAllHealth(
  db: AsyncAdminDb,
  readSnapshot: ReadSnapshot,
  nowMs: number,
  opts: { timeoutMs?: number; concurrency?: number } = {},
): Promise<{ ok: number; unreachable: number }> {
  const tenants = await db.all<{ id: string }>(`SELECT id FROM tenants WHERE status = 'active' ORDER BY id`)
  const queue = tenants.map((t) => t.id)
  const result = { ok: 0, unreachable: 0 }
  const workers = Array.from({ length: Math.min(opts.concurrency ?? HEALTH_CONCURRENCY, queue.length) }, async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const outcome = await refreshTenantHealth(db, id, readSnapshot, nowMs, opts.timeoutMs)
      result[outcome] += 1
    }
  })
  await Promise.all(workers)
  return result
}

export type HealthClinicRow = {
  tenantId: string
  name: string
  tenantStatus: 'active' | 'suspended' | 'pending_deletion'
  whatsappStatus: string
  summary: HealthSummaryRow | null
}

const HEALTH_SELECT = `
  SELECT t.id AS tenant_id_t, t.name, t.status AS tenant_status,
         (SELECT b.status FROM whatsapp_phone_bindings b
           WHERE b.tenant_id = t.id AND b.status IN ('active', 'interrupted')
           ORDER BY b.updated_at DESC LIMIT 1) AS wa_binding_status,
         (SELECT COUNT(*) FROM whatsapp_signup_sessions s
           WHERE s.tenant_id = t.id AND s.status = 'pending') AS wa_signup_pending,
         h.tenant_id, h.read_at, h.last_ok_at, h.status, h.schema_version, h.schema_ready,
         h.pending_outbox, h.failed_outbox, h.uncertain_outbound, h.llm_jobs_open, h.llm_jobs_failed_1h,
         h.contact_count, h.message_count, h.appointment_count, h.attachment_count
  FROM tenants t
  LEFT JOIN tenant_health_summary h ON h.tenant_id = t.id`

type RawHealth = RawSummary & {
  tenant_id_t: string
  name: string
  tenant_status: string
  wa_binding_status: string | null
  wa_signup_pending: number
}

function mapHealth(r: RawHealth): HealthClinicRow {
  const wa =
    r.wa_binding_status === 'active'
      ? 'connected'
      : r.wa_binding_status === 'interrupted'
        ? 'error'
        : Number(r.wa_signup_pending) > 0
          ? 'pending'
          : 'not_connected'
  return {
    tenantId: r.tenant_id_t,
    name: r.name,
    tenantStatus: r.tenant_status as HealthClinicRow['tenantStatus'],
    whatsappStatus: wa,
    summary: r.tenant_id ? mapSummary(r) : null,
  }
}

export async function listHealth(db: AsyncAdminDb): Promise<HealthClinicRow[]> {
  return (await db.all<RawHealth>(`${HEALTH_SELECT} ORDER BY t.name COLLATE NOCASE, t.id`)).map(mapHealth)
}

export async function getHealth(db: AsyncAdminDb, tenantId: string): Promise<HealthClinicRow | null> {
  const row = await db.get<RawHealth>(`${HEALTH_SELECT} WHERE t.id = ?`, tenantId)
  return row ? mapHealth(row) : null
}
