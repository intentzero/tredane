import { AuthError } from './errors'
import type { UserAuthoritySnapshot } from './types'

/**
 * DEC-018 / ADR-0006: apenas `privateMetadata.superadmin === true` (booleano).
 * String "true", 1, publicMetadata ou ausência → negado.
 */
export function isExactPrivateSuperadmin(privateSuperadmin: unknown): boolean {
  return privateSuperadmin === true
}

export function assertSuperadminFromAuthority(snapshot: UserAuthoritySnapshot): void {
  // publicMetadata nunca autoriza, mesmo se true.
  if (snapshot.publicSuperadmin === true || snapshot.publicSuperadmin === 'true') {
    throw new AuthError(
      'superadmin_required',
      'Flag pública não autoriza Platform Admin',
      403,
    )
  }
  if (!isExactPrivateSuperadmin(snapshot.privateSuperadmin)) {
    throw new AuthError(
      'superadmin_required',
      'Superadmin booleano privado exigido',
      403,
    )
  }
}

/**
 * Lê autoridade atual. Qualquer falha de verificação → fail closed (nunca concede).
 * Sem cache positivo: cada pedido de platform revalida.
 */
export type AuthorityReader = {
  readUserAuthority(clerkUserId: string): Promise<UserAuthoritySnapshot>
}

export async function requireVerifiedSuperadmin(
  reader: AuthorityReader,
  clerkUserId: string,
): Promise<void> {
  let snapshot: UserAuthoritySnapshot
  try {
    snapshot = await reader.readUserAuthority(clerkUserId)
  } catch {
    throw new AuthError(
      'authority_verification_failed',
      'Falha ao verificar autoridade',
      403,
    )
  }
  if (snapshot.clerkUserId !== clerkUserId) {
    throw new AuthError(
      'authority_verification_failed',
      'Falha ao verificar autoridade',
      403,
    )
  }
  assertSuperadminFromAuthority(snapshot)
}
