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
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'ConflictError'
  }
}

export class NotFoundError extends ClinicError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'NotFoundError'
  }
}
