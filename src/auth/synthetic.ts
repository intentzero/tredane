import type { AuthorityReader } from './superadmin'
import type { SessionAuthenticator } from './session'
import { assertCookieOriginAllowed, requestUsesBearer } from './session'
import type { SessionAuthResult, UserAuthoritySnapshot } from './types'

/**
 * Autenticação sintética para testes e harness local (#21).
 * Formato: `Authorization: Bearer synth:<clerkUserId>`
 * Opcional: `X-Synth-Session: <sessionId>`
 * Metadata: mapa injetável — nunca usar em staging/production.
 */

export const SYNTH_BEARER_PREFIX = 'synth:'

export type SyntheticUserFixture = {
  clerkUserId: string
  privateSuperadmin?: unknown
  publicSuperadmin?: unknown
}

export const DEFAULT_SYNTH_FIXTURES: readonly SyntheticUserFixture[] = [
  { clerkUserId: 'user_synth_owner_a' },
  { clerkUserId: 'user_synth_owner_a2' },
  { clerkUserId: 'user_synth_attendant_a' },
  { clerkUserId: 'user_synth_multi' },
  { clerkUserId: 'user_synth_owner_b' },
  { clerkUserId: 'user_synth_no_access' },
  { clerkUserId: 'user_synth_suspended_owner' },
  { clerkUserId: 'user_synth_superadmin', privateSuperadmin: true },
  { clerkUserId: 'user_synth_string_super', privateSuperadmin: 'true' },
  { clerkUserId: 'user_synth_public_super', publicSuperadmin: true },
]

function parseSynthBearer(header: string | null): string | null {
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  if (!match?.[1]) return null
  const token = match[1]
  if (!token.startsWith(SYNTH_BEARER_PREFIX)) return null
  const userId = token.slice(SYNTH_BEARER_PREFIX.length)
  return userId.length > 0 ? userId : null
}

export function createSyntheticSessionAuthenticator(opts: {
  authorizedParties?: readonly string[]
  /** Se true, ausência de sessão → missing; se false e cookie path, exige origin. */
  allowMissingOriginInTests?: boolean
}): SessionAuthenticator {
  const parties = opts.authorizedParties ?? ['http://localhost:5173']
  return {
    async authenticateRequest(request: Request): Promise<SessionAuthResult> {
      const usesBearer = requestUsesBearer(request)
      const userId = parseSynthBearer(request.headers.get('Authorization'))

      if (!userId) {
        if (!usesBearer && request.headers.get('Cookie')?.includes('synth_session=')) {
          if (!opts.allowMissingOriginInTests) {
            try {
              assertCookieOriginAllowed(request, parties)
            } catch {
              return { ok: false, reason: 'origin_rejected' }
            }
          }
          const cookieUser = /synth_session=([^;]+)/.exec(request.headers.get('Cookie') ?? '')?.[1]
          if (!cookieUser) return { ok: false, reason: 'invalid' }
          return {
            ok: true,
            clerkUserId: decodeURIComponent(cookieUser),
            sessionId: request.headers.get('X-Synth-Session') ?? `sess_synth_${cookieUser}`,
            transport: 'cookie',
          }
        }
        return { ok: false, reason: 'missing' }
      }

      if (userId === 'user_synth_expired') {
        return { ok: false, reason: 'expired' }
      }
      if (userId === 'user_synth_invalid') {
        return { ok: false, reason: 'invalid' }
      }

      return {
        ok: true,
        clerkUserId: userId,
        sessionId: request.headers.get('X-Synth-Session') ?? `sess_synth_${userId}`,
        transport: 'bearer',
      }
    },
  }
}

export function createSyntheticAuthorityReader(
  fixtures: readonly SyntheticUserFixture[] = DEFAULT_SYNTH_FIXTURES,
  opts: { failUserIds?: ReadonlySet<string> } = {},
): AuthorityReader {
  const byId = new Map(fixtures.map((f) => [f.clerkUserId, f]))
  return {
    async readUserAuthority(clerkUserId: string): Promise<UserAuthoritySnapshot> {
      if (opts.failUserIds?.has(clerkUserId)) {
        throw new Error('authority_backend_unavailable')
      }
      const fixture = byId.get(clerkUserId)
      if (!fixture) {
        return {
          clerkUserId,
          privateSuperadmin: undefined,
          publicSuperadmin: undefined,
        }
      }
      return {
        clerkUserId: fixture.clerkUserId,
        privateSuperadmin: fixture.privateSuperadmin,
        publicSuperadmin: fixture.publicSuperadmin,
      }
    },
  }
}

export function synthAuthHeader(clerkUserId: string): string {
  return `Bearer ${SYNTH_BEARER_PREFIX}${clerkUserId}`
}
