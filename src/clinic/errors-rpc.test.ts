import { describe, expect, it } from 'vitest'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  clinicErrorHttpStatus,
  readClinicError,
} from './errors'

/** Eco típico do Durable Object RPC (protótipo perdido; name/code/details intactos). */
function rpcEcho(err: Error & { code?: string; details?: Record<string, unknown> }): Error {
  const echo = new Error(err.message)
  echo.name = err.name
  Object.assign(echo, {
    code: err.code,
    ...(err.details !== undefined ? { details: err.details } : {}),
  })
  return echo
}

describe('readClinicError (DO RPC)', () => {
  it('reconhece ValidationError local e o eco RPC', () => {
    const local = new ValidationError('synonym_collision', '«peito» já identifica a variante «Peito».', {
      synonym: 'peito',
    })
    expect(readClinicError(local)).toEqual({
      name: 'ValidationError',
      code: 'synonym_collision',
      message: local.message,
      details: { synonym: 'peito' },
    })
    const remote = rpcEcho(local)
    expect(remote instanceof ValidationError).toBe(false)
    expect(readClinicError(remote)).toEqual({
      name: 'ValidationError',
      code: 'synonym_collision',
      message: local.message,
      details: { synonym: 'peito' },
    })
    expect(clinicErrorHttpStatus(readClinicError(remote)!)).toBe(400)
  })

  it('mapeia NotFound e Conflict', () => {
    expect(clinicErrorHttpStatus(readClinicError(new NotFoundError('x', 'y'))!)).toBe(404)
    expect(clinicErrorHttpStatus(readClinicError(rpcEcho(new ConflictError('c', 'm')))!)).toBe(409)
  })

  it('ignora Error genérico', () => {
    expect(readClinicError(new Error('boom'))).toBeNull()
    expect(readClinicError({ name: 'Error', code: 'x', message: 'y' })).toBeNull()
  })
})
