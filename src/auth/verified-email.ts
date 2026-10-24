/**
 * E-mail verificado para aceite de convite (DEC-021 / ADR-0008).
 * Aceite exige endereço verificado correspondente ao convite — não role/tenant do browser.
 */
import type { ClerkClient } from '@clerk/backend'
import { normalizeEmail } from '../db/admin/ids'

export type VerifiedEmailSnapshot =
  | { ok: true; email: string }
  | { ok: false; reason: 'missing' | 'unverified' | 'unavailable' }

export type VerifiedEmailReader = {
  readPrimaryVerifiedEmail(clerkUserId: string): Promise<VerifiedEmailSnapshot>
}

export function createClerkVerifiedEmailReader(client: ClerkClient): VerifiedEmailReader {
  return {
    async readPrimaryVerifiedEmail(clerkUserId: string): Promise<VerifiedEmailSnapshot> {
      try {
        const user = await client.users.getUser(clerkUserId)
        const primaryId = user.primaryEmailAddressId
        const primary = user.emailAddresses.find((e) => e.id === primaryId)
          ?? user.emailAddresses[0]
        if (!primary?.emailAddress) {
          return { ok: false, reason: 'missing' }
        }
        if (primary.verification?.status !== 'verified') {
          return { ok: false, reason: 'unverified' }
        }
        return { ok: true, email: normalizeEmail(primary.emailAddress) }
      } catch {
        return { ok: false, reason: 'unavailable' }
      }
    },
  }
}

export type SyntheticVerifiedEmailFixture = {
  clerkUserId: string
  /** E-mail verificado; omitir / null = sem e-mail verificado. */
  verifiedEmail?: string | null
}

export const DEFAULT_SYNTH_EMAIL_FIXTURES: readonly SyntheticVerifiedEmailFixture[] = [
  { clerkUserId: 'user_synth_owner_a', verifiedEmail: 'owner.a@example.test' },
  { clerkUserId: 'user_synth_owner_a2', verifiedEmail: 'owner.a2@example.test' },
  { clerkUserId: 'user_synth_attendant_a', verifiedEmail: 'attendant.a@example.test' },
  { clerkUserId: 'user_synth_multi', verifiedEmail: 'multi@example.test' },
  { clerkUserId: 'user_synth_owner_b', verifiedEmail: 'owner.b@example.test' },
  { clerkUserId: 'user_synth_no_access', verifiedEmail: 'no.access@example.test' },
  { clerkUserId: 'user_synth_superadmin', verifiedEmail: 'superadmin@example.test' },
  { clerkUserId: 'user_synth_invitee', verifiedEmail: 'invitee@example.test' },
  { clerkUserId: 'user_synth_unverified', verifiedEmail: null },
]

/**
 * Reader sintético. Header `X-Synth-Verified-Email` sobrescreve o fixture
 * (vazio = unverified). Sem header → fixture ou missing.
 */
export function createSyntheticVerifiedEmailReader(
  fixtures: readonly SyntheticVerifiedEmailFixture[] = DEFAULT_SYNTH_EMAIL_FIXTURES,
  opts: {
    /** Request atual — usado para ler header de override nos testes HTTP. */
    getRequest?: () => Request | null
  } = {},
): VerifiedEmailReader {
  const byId = new Map(fixtures.map((f) => [f.clerkUserId, f]))
  return {
    async readPrimaryVerifiedEmail(clerkUserId: string): Promise<VerifiedEmailSnapshot> {
      const req = opts.getRequest?.() ?? null
      if (req) {
        const header = req.headers.get('X-Synth-Verified-Email')
        if (header !== null) {
          const trimmed = header.trim()
          if (!trimmed) return { ok: false, reason: 'unverified' }
          return { ok: true, email: normalizeEmail(trimmed) }
        }
      }
      const fixture = byId.get(clerkUserId)
      if (!fixture) return { ok: false, reason: 'missing' }
      if (fixture.verifiedEmail == null || fixture.verifiedEmail === '') {
        return { ok: false, reason: 'unverified' }
      }
      return { ok: true, email: normalizeEmail(fixture.verifiedEmail) }
    },
  }
}
