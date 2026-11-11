import { AuthError } from './errors'
import type { SessionAuthResult } from './types'

export type SessionAuthenticator = {
  authenticateRequest(request: Request): Promise<SessionAuthResult>
}

export function requireSession(result: SessionAuthResult): {
  clerkUserId: string
  sessionId: string
  transport: 'bearer' | 'cookie'
} {
  if (result.ok) return result
  switch (result.reason) {
    case 'missing':
      throw new AuthError('unauthenticated', 'Sessão ausente', 401)
    case 'expired':
      throw new AuthError('session_expired', 'Sessão expirada', 401)
    case 'origin_rejected':
      throw new AuthError('origin_rejected', 'Origem rejeitada', 403)
    default:
      throw new AuthError('session_invalid', 'Sessão inválida', 401)
  }
}

/**
 * CSRF / cookie leaking: pedidos com cookie (sem Bearer) exigem Origin ou Referer
 * em authorizedParties. Bearer JWT já carrega azp validado pelo Clerk.
 */
export function assertCookieOriginAllowed(
  request: Request,
  authorizedParties: readonly string[],
): void {
  if (authorizedParties.length === 0) {
    throw new AuthError('origin_rejected', 'Origem rejeitada', 403)
  }
  const origin = request.headers.get('Origin')
  if (origin && authorizedParties.includes(origin)) return

  const referer = request.headers.get('Referer')
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin
      if (authorizedParties.includes(refOrigin)) return
    } catch {
      /* fall through */
    }
  }
  throw new AuthError('origin_rejected', 'Origem rejeitada', 403)
}

/**
 * DEC-159 — consent OAuth MCP: navegação top-level GET para o nosso Host
 * (redirect do cliente MCP) chega sem Origin e com Referer externo.
 * Cookie SameSite=Lax é enviado no GET; CSRF de escrita continua a exigir
 * Origin na POST do formulário (assertCookieOriginAllowed).
 */
export function assertCookieAllowedForAuthorizeGet(
  request: Request,
  authorizedParties: readonly string[],
  appBaseUrl?: string | null,
): void {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    assertCookieOriginAllowed(request, authorizedParties)
    return
  }
  try {
    assertCookieOriginAllowed(request, authorizedParties)
    return
  } catch {
    /* tentar Host do nosso painel */
  }
  const allowedHosts = new Set<string>()
  for (const party of authorizedParties) {
    try {
      allowedHosts.add(new URL(party).host)
    } catch {
      /* ignore */
    }
  }
  if (appBaseUrl) {
    try {
      allowedHosts.add(new URL(appBaseUrl).host)
    } catch {
      /* ignore */
    }
  }
  const host = new URL(request.url).host
  if (allowedHosts.has(host)) return
  throw new AuthError('origin_rejected', 'Origem rejeitada', 403)
}

export function requestUsesBearer(request: Request): boolean {
  const auth = request.headers.get('Authorization')
  return Boolean(auth && /^Bearer\s+\S+/i.test(auth))
}
