/**
 * Cookie de sessão de suporte (#27 / ADR-0007).
 * HttpOnly; Secure; SameSite=Lax — nunca em localStorage/URL.
 * Vinculado à sessão Clerk do actor via actor_clerk_session_id no D1.
 */

export const SUPPORT_COOKIE_NAME = 'tredane_support'

export function parseSupportCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  const match = new RegExp(`(?:^|;\\s*)${SUPPORT_COOKIE_NAME}=([^;]+)`).exec(cookieHeader)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

export function buildSupportSetCookie(
  sessionToken: string,
  opts: { maxAgeSec: number; secure?: boolean } = { maxAgeSec: 30 * 60 },
): string {
  const parts = [
    `${SUPPORT_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSec))}`,
  ]
  if (opts.secure !== false) parts.push('Secure')
  return parts.join('; ')
}

/** Invalida cookie imediatamente (revogação/expiração). */
export function buildSupportClearCookie(opts: { secure?: boolean } = {}): string {
  const parts = [
    `${SUPPORT_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ]
  if (opts.secure !== false) parts.push('Secure')
  return parts.join('; ')
}

/**
 * CSRF para handoff/ações com cookie de suporte:
 * Bearer (API) dispensa Origin; cookie exige Origin/Referer em authorizedParties.
 */
export function assertSupportMutationOrigin(
  request: Request,
  transport: 'bearer' | 'cookie',
  authorizedParties: readonly string[],
): void {
  if (transport === 'bearer') return
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
  throw new Error('origin_rejected')
}
