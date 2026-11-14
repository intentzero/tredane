export class ClinicError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ClinicError'
    this.code = code
  }
}

export class SchemaNotReadyError extends ClinicError {
  constructor(detail: string) {
    super('schema_not_ready', `Schema operacional da clínica incompleto: ${detail}`)
    this.name = 'SchemaNotReadyError'
  }
}

export class TenantMismatchError extends ClinicError {
  constructor(detail: string) {
    super('tenant_mismatch', `Tenant recusado no Clinic DO: ${detail}`)
    this.name = 'TenantMismatchError'
  }
}

export class UnauthorizedCallerError extends ClinicError {
  constructor(detail: string) {
    super('unauthorized_caller', `Chamador interno inválido: ${detail}`)
    this.name = 'UnauthorizedCallerError'
  }
}

export class ConflictError extends ClinicError {
  readonly details?: Record<string, unknown>

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message)
    this.name = 'ConflictError'
    this.details = details
  }
}

export class NotFoundError extends ClinicError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends ClinicError {
  readonly details?: Record<string, unknown>

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message)
    this.name = 'ValidationError'
    this.details = details
  }
}

const CLINIC_ERROR_NAMES = new Set([
  'ClinicError',
  'SchemaNotReadyError',
  'TenantMismatchError',
  'UnauthorizedCallerError',
  'ConflictError',
  'NotFoundError',
  'ValidationError',
])

export type ClinicErrorShape = {
  name: string
  code: string
  message: string
  details?: Record<string, unknown>
}

/**
 * Lê ClinicError local ou o eco do Durable Object RPC.
 * O runtime preserva `name` / `message` / propriedades próprias (`code`, `details`)
 * com `enhanced_error_serialization`, mas **não** o protótipo — `instanceof` falha
 * (ver Cloudflare Workers RPC error handling).
 */
export function readClinicError(err: unknown): ClinicErrorShape | null {
  if (err instanceof ClinicError) {
    const details =
      err instanceof ValidationError || err instanceof ConflictError ? err.details : undefined
    return { name: err.name, code: err.code, message: err.message, details }
  }
  if (!err || typeof err !== 'object') return null
  const e = err as {
    name?: unknown
    code?: unknown
    message?: unknown
    details?: unknown
  }
  if (typeof e.name !== 'string' || !CLINIC_ERROR_NAMES.has(e.name)) return null
  if (typeof e.code !== 'string' || typeof e.message !== 'string') return null
  const details =
    e.details && typeof e.details === 'object' && !Array.isArray(e.details)
      ? (e.details as Record<string, unknown>)
      : undefined
  return { name: e.name, code: e.code, message: e.message, details }
}

/** Status HTTP canónico para erros de domínio da clínica. */
export function clinicErrorHttpStatus(shape: ClinicErrorShape): number {
  if (shape.name === 'NotFoundError') return 404
  if (shape.name === 'ConflictError') return 409
  if (shape.code === 'tenant_mismatch' || shape.code === 'unauthorized_caller') return 403
  return 400
}
