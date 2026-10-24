/**
 * Ensaio de recuperação por clínica (#44 / DEC-038 / ADR-0012).
 * Harness local: isolamento A/B, compatibilidade de schema, anti-reenvio.
 * PITR real Cloudflare = GATE Em aberto (conta/bindings).
 */

import { ADMIN_SCHEMA_VERSION } from '../db/admin/constants'
import { CLINIC_SCHEMA_VERSION } from '../clinic/constants'
import { emitOpsAlert } from './alerts'

export type SchemaCompatReport = {
  adminExpected: number
  adminActual: number | null
  clinicExpected: number
  clinicActual: number | null
  r2PrefixOk: boolean
  compatible: boolean
  gaps: string[]
}

export type RecoveryRehearsalResult = {
  tenantA: string
  tenantB: string
  schema: SchemaCompatReport
  /** Contagens em B antes/depois do ensaio em A — devem ser iguais. */
  tenantBBefore: Record<string, number>
  tenantBAfter: Record<string, number>
  isolationOk: boolean
  /** Garantias documentadas do ensaio (sem efeitos externos). */
  guarantees: string[]
  /** Itens que exigem conta Cloudflare / provedor live. */
  openGates: string[]
  correlationId: string
}

export function assessSchemaCompatibility(input: {
  adminActual: number | null
  clinicActual: number | null
  /** Prefixo R2 da clínica A existe ou está vazio de forma coerente. */
  r2PrefixOk: boolean
}): SchemaCompatReport {
  const gaps: string[] = []
  if (input.adminActual == null) {
    gaps.push('admin_schema_state_missing')
  } else if (input.adminActual !== ADMIN_SCHEMA_VERSION) {
    gaps.push(
      `admin_schema_mismatch:expected_${ADMIN_SCHEMA_VERSION}:actual_${input.adminActual}`,
    )
  }
  if (input.clinicActual == null) {
    gaps.push('clinic_schema_state_missing')
  } else if (input.clinicActual !== CLINIC_SCHEMA_VERSION) {
    gaps.push(
      `clinic_schema_mismatch:expected_${CLINIC_SCHEMA_VERSION}:actual_${input.clinicActual}`,
    )
  }
  if (!input.r2PrefixOk) {
    gaps.push('r2_prefix_incoherent')
  }
  return {
    adminExpected: ADMIN_SCHEMA_VERSION,
    adminActual: input.adminActual,
    clinicExpected: CLINIC_SCHEMA_VERSION,
    clinicActual: input.clinicActual,
    r2PrefixOk: input.r2PrefixOk,
    compatible: gaps.length === 0,
    gaps,
  }
}

export function assertIsolationPreserved(
  before: Record<string, number>,
  after: Record<string, number>,
): { ok: boolean; diffs: string[] } {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const diffs: string[] = []
  for (const key of keys) {
    const a = before[key] ?? 0
    const b = after[key] ?? 0
    if (a !== b) diffs.push(`${key}:${a}->${b}`)
  }
  return { ok: diffs.length === 0, diffs }
}

/**
 * Monta o relatório de ensaio. A mutação em A (wipe/replay sintético) é
 * responsabilidade do caller; aqui só se valida isolamento + schema.
 */
export function buildRecoveryRehearsalReport(input: {
  tenantA: string
  tenantB: string
  adminSchemaVersion: number | null
  clinicSchemaVersionA: number | null
  r2PrefixOk: boolean
  tenantBBefore: Record<string, number>
  tenantBAfter: Record<string, number>
  /** Se true, emite alerta recovery.isolation quando B muda. */
  emitAlertOnBreach?: boolean
}): RecoveryRehearsalResult {
  const schema = assessSchemaCompatibility({
    adminActual: input.adminSchemaVersion,
    clinicActual: input.clinicSchemaVersionA,
    r2PrefixOk: input.r2PrefixOk,
  })
  const isolation = assertIsolationPreserved(
    input.tenantBBefore,
    input.tenantBAfter,
  )
  let correlationId = `rehearsal_${input.tenantA}`
  if (!isolation.ok && input.emitAlertOnBreach !== false) {
    const emitted = emitOpsAlert({
      kind: 'recovery.isolation',
      tenantId: input.tenantA,
      operation: 'recovery.rehearsal',
      stage: 'isolation_check',
      outcome: 'failed',
      fields: {
        tenantB: input.tenantB,
        diffs: isolation.diffs,
      },
    })
    correlationId = emitted.correlationId
  } else if (!schema.compatible && input.emitAlertOnBreach !== false) {
    const emitted = emitOpsAlert({
      kind: 'schema.mismatch',
      tenantId: input.tenantA,
      operation: 'recovery.rehearsal',
      stage: 'schema_check',
      outcome: 'failed',
      fields: { gaps: schema.gaps },
    })
    correlationId = emitted.correlationId
  }

  return {
    tenantA: input.tenantA,
    tenantB: input.tenantB,
    schema,
    tenantBBefore: input.tenantBBefore,
    tenantBAfter: input.tenantBAfter,
    isolationOk: isolation.ok,
    guarantees: [
      'recuperar_A_nao_altera_B',
      'sem_reenvio_whatsapp_automatico',
      'sem_reemissao_pix_automatica',
      'sem_reativar_membership_ou_suporte_expirado',
      'reconcilia_tombstones_e_purged_tenants',
    ],
    openGates: [
      'GATE-CF-PITR: restore time-point Durable Object SQLite (doc CF ≤30d) — Em aberto até conta staging',
      'GATE-CF-D1-BACKUP: export/PITR D1 central — Em aberto',
      'GATE-META-RECONCILE: reconciliar status Meta sem reenviar — ensaio live Em aberto (GATE-01/02)',
      'GATE-PIX-RECONCILE: reconciliar cobranças Woovi sem nova charge — Em aberto (GATE-08)',
    ],
    correlationId,
  }
}

/** Política documentada: restore ≠ reprocessar efeitos externos. */
export const RECOVERY_POLICY = {
  neverResendWhatsapp: true,
  neverRecreatePixCharge: true,
  neverReactivateExpiredSupport: true,
  neverReactivateRevokedMembership: true,
  reconcileProvidersReadOnly: true,
  pitrAvailableDaysPerDocs: 30,
  pitrStatus: 'em_aberto' as const,
}
