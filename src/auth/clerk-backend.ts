import { createClerkClient, type ClerkClient } from '@clerk/backend'
import type { AuthorityReader } from './superadmin'
import type { SessionAuthenticator } from './session'
import { assertCookieOriginAllowed, requestUsesBearer } from './session'
import type { SessionAuthResult, UserAuthoritySnapshot } from './types'

export type ClerkAuthConfig = {
  secretKey: string
  publishableKey: string
  /** PEM público opcional — verificação networkless do JWT. */
  jwtKey?: string
  /** Origens permitidas (CSRF / azp). Obrigatório em staging/prod. */
  authorizedParties: readonly string[]
}

export function createClerkClientFromConfig(config: ClerkAuthConfig): ClerkClient {
  return createClerkClient({
    secretKey: config.secretKey,
    publishableKey: config.publishableKey,
    jwtKey: config.jwtKey,
  })
}

export function createClerkSessionAuthenticator(
  config: ClerkAuthConfig,
  client: ClerkClient = createClerkClientFromConfig(config),
): SessionAuthenticator {
  return {
    async authenticateRequest(request: Request): Promise<SessionAuthResult> {
      const usesBearer = requestUsesBearer(request)

      // Cookie sem Origin válida → negar antes de confiar na sessão.
      if (!usesBearer) {
        try {
          assertCookieOriginAllowed(request, config.authorizedParties)
        } catch {
          return { ok: false, reason: 'origin_rejected' }
        }
      }

      let requestState: Awaited<ReturnType<ClerkClient['authenticateRequest']>>
      try {
        requestState = await client.authenticateRequest(request, {
          secretKey: config.secretKey,
          publishableKey: config.publishableKey,
          jwtKey: config.jwtKey,
          authorizedParties: [...config.authorizedParties],
          acceptsToken: 'session_token',
        })
      } catch {
        return { ok: false, reason: 'invalid' }
      }

      if (!requestState.isAuthenticated) {
        const reason = String(requestState.reason ?? '')
        if (reason.toLowerCase().includes('expir')) {
          return { ok: false, reason: 'expired' }
        }
        if (!request.headers.get('Authorization') && !request.headers.get('Cookie')) {
          return { ok: false, reason: 'missing' }
        }
        return { ok: false, reason: 'invalid' }
      }

      const auth = requestState.toAuth()
      if (!auth.userId || !auth.sessionId) {
        return { ok: false, reason: 'invalid' }
      }

      return {
        ok: true,
        clerkUserId: auth.userId,
        sessionId: auth.sessionId,
        transport: usesBearer ? 'bearer' : 'cookie',
      }
    },
  }
}

/**
 * Lê privateMetadata via Backend API a cada chamada — sem cache positivo (ADR-0006).
 * Falha de rede/API propaga para o caller, que falha fechado.
 */
export function createClerkAuthorityReader(client: ClerkClient): AuthorityReader {
  return {
    async readUserAuthority(clerkUserId: string): Promise<UserAuthoritySnapshot> {
      const user = await client.users.getUser(clerkUserId)
      return {
        clerkUserId: user.id,
        privateSuperadmin: user.privateMetadata?.superadmin,
        publicSuperadmin: user.publicMetadata?.superadmin,
      }
    },
  }
}
