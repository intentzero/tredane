import { SYNTHETIC_TENANT_PREFIX } from './constants'
import { TenantMismatchError, UnauthorizedCallerError } from './errors'

/**
 * Envelopes internos tenant/entity/event/idempotency (issue #20).
 * Auth Clerk HTTP (#21) autentica o humano; o Worker monta este envelope
 * antes de RPC/Queue. O DO revalida coerência com o tenant vinculado.
 */

export const CALLER_KINDS = [
  'worker_internal',
  'queue_consumer',
  'integration',
] as const

export type CallerKind = (typeof CALLER_KINDS)[number]

/** Asserção mínima até segredo/mTLS interno — só valores conhecidos do Worker. */
export const INTERNAL_ASSERTIONS = [
  'tredane-worker-v1',
  'tredane-queue-v1',
] as const

export type InternalAssertion = (typeof INTERNAL_ASSERTIONS)[number]

export type ClinicCaller = {
  kind: CallerKind
  /** Tenant já autorizado no Worker (não confiar no cliente). */
  tenantId: string
  assertion: InternalAssertion
  actorId?: string
}

export type EntityRef = {
  type: string
  id: string
}

export type EventEnvelope<TPayload = Record<string, unknown>> = {
  tenantId: string
  eventId: string
  type: string
  entity: EntityRef
  idempotencyKey: string
  occurredAt: number
  payload: TPayload
}

/** Resultado devolvido pelo consumer ao DO correto (contrato F1/F3). */
export type ConsumerResult = {
  tenantId: string
  outboxEventId: string
  idempotencyKey: string
  outcome: 'succeeded' | 'failed' | 'uncertain'
  providerRef?: string
  errorCode?: string
  occurredAt: number
}

export function assertValidCaller(caller: ClinicCaller): void {
  if (!CALLER_KINDS.includes(caller.kind)) {
    throw new UnauthorizedCallerError(`kind=${String(caller.kind)}`)
  }
  if (!INTERNAL_ASSERTIONS.includes(caller.assertion)) {
    throw new UnauthorizedCallerError('assertion inválida')
  }
  if (!caller.tenantId || typeof caller.tenantId !== 'string') {
    throw new UnauthorizedCallerError('tenantId ausente')
  }
  if (caller.kind === 'queue_consumer' && caller.assertion !== 'tredane-queue-v1') {
    throw new UnauthorizedCallerError('consumer exige assertion de fila')
  }
  if (caller.kind === 'worker_internal' && caller.assertion !== 'tredane-worker-v1') {
    throw new UnauthorizedCallerError('worker exige assertion de worker')
  }
}

/** ID real de tenant gerado por `newId('tenant')`: `tenant_` + 24 hex. */
export const REAL_TENANT_ID_RE = /^tenant_[0-9a-f]{24}$/

export function isRealTenantId(tenantId: string): boolean {
  return REAL_TENANT_ID_RE.test(tenantId)
}

export function isSyntheticTenantId(tenantId: string): boolean {
  return typeof tenantId === 'string' && tenantId.startsWith(SYNTHETIC_TENANT_PREFIX)
}

/**
 * Tenant aceito pelo Clinic DO: id real (`tenant_<hex>`) sempre; `clinic-demo-*`
 * só quando `allowSynthetic` (development/test). Qualquer outro formato é recusado.
 */
export function assertClinicTenantId(
  tenantId: string,
  opts: { allowSynthetic: boolean } = { allowSynthetic: true },
): void {
  if (typeof tenantId !== 'string' || !tenantId) {
    throw new TenantMismatchError('tenantId ausente')
  }
  if (isRealTenantId(tenantId)) return
  if (opts.allowSynthetic && isSyntheticTenantId(tenantId)) return
  throw new TenantMismatchError(
    opts.allowSynthetic
      ? 'tenantId inválido (esperado tenant_<hex> ou clinic-demo-*)'
      : 'tenantId inválido (esperado tenant_<hex>)',
  )
}

/** Harness / seeds: só tenants sintéticos. */
export function assertSyntheticTenantId(tenantId: string): void {
  if (!tenantId.startsWith(SYNTHETIC_TENANT_PREFIX)) {
    throw new TenantMismatchError('apenas tenants sintéticos clinic-demo-* neste recorte')
  }
}

export function assertCallerTenant(
  caller: ClinicCaller,
  expectedTenantId: string,
): void {
  assertValidCaller(caller)
  if (caller.tenantId !== expectedTenantId) {
    throw new TenantMismatchError(
      `chamador=${caller.tenantId} esperado=${expectedTenantId}`,
    )
  }
}

export function workerCaller(tenantId: string, actorId?: string): ClinicCaller {
  return {
    kind: 'worker_internal',
    tenantId,
    assertion: 'tredane-worker-v1',
    actorId,
  }
}

export function queueCaller(tenantId: string): ClinicCaller {
  return {
    kind: 'queue_consumer',
    tenantId,
    assertion: 'tredane-queue-v1',
  }
}
