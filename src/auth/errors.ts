/** Erros de autenticação/autorização — fail closed; mensagens sem dados de outro tenant. */

export type AuthErrorCode =
  | 'unauthenticated'
  | 'session_expired'
  | 'session_invalid'
  | 'origin_rejected'
  | 'authority_verification_failed'
  | 'superadmin_required'
  | 'tenant_access_denied'
  | 'tenant_not_active'
  | 'permission_denied'
  | 'forged_role_rejected'
  | 'integration_unverified'
  /** Sessão de suporte (ADR-0017): escrita ou rota fora da lista de leitura, e falhas do cookie. */
  | 'support_write_blocked'
  | 'support_route_blocked'
  | 'support_cookie_invalid'
  | 'support_session_not_active'
  | 'support_session_expired'
  | 'support_actor_mismatch'
  | 'support_clerk_session_mismatch'
  | 'support_tenant_forged'
  | 'support_subject_forged'
  | 'subject_not_member'

export class AuthError extends Error {
  readonly code: AuthErrorCode
  readonly status: 401 | 403

  constructor(code: AuthErrorCode, message: string, status: 401 | 403) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.status = status
  }
}

export function isAuthError(err: unknown): err is AuthError {
  return err instanceof AuthError
}
