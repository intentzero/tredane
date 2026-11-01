/**
 * Perfil de apresentação de membros da equipe (DEC-102).
 * Resolve nome e e-mail no Worker via Clerk Backend (ou fixtures sintéticos).
 * Sem cache em D1 neste recorte — só resolução sob demanda no GET /team.
 */
import type { ClerkClient } from '@clerk/backend'
import { SYNTH_STAFF_FIRST_NAMES } from '../clinic/inbox/human-prefix'
import { normalizeEmail } from '../db/admin/ids'
import {
  DEFAULT_SYNTH_EMAIL_FIXTURES,
  type SyntheticVerifiedEmailFixture,
} from './verified-email'

export type StaffProfile = {
  displayName: string | null
  email: string | null
}

export type StaffProfileReader = {
  readStaffProfiles(clerkUserIds: readonly string[]): Promise<Map<string, StaffProfile>>
}

function displayNameFromParts(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fullName: string | null | undefined,
  username: string | null | undefined,
): string | null {
  const composed = [firstName?.trim(), lastName?.trim()].filter(Boolean).join(' ').trim()
  if (composed) return composed
  const full = fullName?.trim()
  if (full) return full
  const user = username?.trim()
  return user || null
}

function emailFromClerkUser(user: {
  primaryEmailAddressId: string | null
  emailAddresses: Array<{ id: string; emailAddress: string }>
}): string | null {
  const primaryId = user.primaryEmailAddressId
  const primary = user.emailAddresses.find((e) => e.id === primaryId) ?? user.emailAddresses[0]
  const raw = primary?.emailAddress?.trim()
  return raw ? normalizeEmail(raw) : null
}

export function createClerkStaffProfileReader(client: ClerkClient): StaffProfileReader {
  return {
    async readStaffProfiles(clerkUserIds) {
      const unique = [...new Set(clerkUserIds.filter(Boolean))]
      const out = new Map<string, StaffProfile>()
      if (unique.length === 0) return out

      // Clínicas MVP têm poucos membros: resolve em paralelo; falha por id não derruba a lista.
      await Promise.all(
        unique.map(async (id) => {
          try {
            const user = await client.users.getUser(id)
            out.set(id, {
              displayName: displayNameFromParts(
                user.firstName,
                user.lastName,
                user.fullName,
                user.username,
              ),
              email: emailFromClerkUser(user),
            })
          } catch {
            out.set(id, { displayName: null, email: null })
          }
        }),
      )
      return out
    },
  }
}

export type SyntheticStaffProfileFixture = {
  clerkUserId: string
  displayName: string | null
  email: string | null
}

export function defaultSyntheticStaffProfiles(
  emailFixtures: readonly SyntheticVerifiedEmailFixture[] = DEFAULT_SYNTH_EMAIL_FIXTURES,
): SyntheticStaffProfileFixture[] {
  const emails = new Map(
    emailFixtures.map((f) => [
      f.clerkUserId,
      f.verifiedEmail ? normalizeEmail(f.verifiedEmail) : null,
    ]),
  )
  const ids = new Set<string>([
    ...Object.keys(SYNTH_STAFF_FIRST_NAMES),
    ...emailFixtures.map((f) => f.clerkUserId),
  ])
  return [...ids].map((clerkUserId) => ({
    clerkUserId,
    displayName: SYNTH_STAFF_FIRST_NAMES[clerkUserId] ?? null,
    email: emails.get(clerkUserId) ?? null,
  }))
}

export function createSyntheticStaffProfileReader(
  fixtures: readonly SyntheticStaffProfileFixture[] = defaultSyntheticStaffProfiles(),
): StaffProfileReader {
  const byId = new Map(fixtures.map((f) => [f.clerkUserId, f]))
  return {
    async readStaffProfiles(clerkUserIds) {
      const out = new Map<string, StaffProfile>()
      for (const id of new Set(clerkUserIds.filter(Boolean))) {
        const fixture = byId.get(id)
        out.set(id, {
          displayName: fixture?.displayName ?? null,
          email: fixture?.email ?? null,
        })
      }
      return out
    },
  }
}
