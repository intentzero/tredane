export class AdminError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AdminError'
    this.code = code
  }
}

export class SchemaNotReadyError extends AdminError {
  constructor(detail: string) {
    super('schema_not_ready', `Schema administrativo incompleto: ${detail}`)
    this.name = 'SchemaNotReadyError'
  }
}

export class ConflictError extends AdminError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'ConflictError'
  }
}

export class NotFoundError extends AdminError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'NotFoundError'
  }
}

export class ForbiddenError extends AdminError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'ForbiddenError'
  }
}
