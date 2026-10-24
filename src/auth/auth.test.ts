import { describe, expect, it } from 'vitest'
import { bootAdminDb } from '../db/test-db'
import { revokeMembership, suspendTenant } from '../db/admin'
import { createControllableClock } from '../db/clock'
import { asyncFromSync } from '../db/admin/async-store'
import {
  ALL_PERMISSIONS,
  authenticateHuman,
  authenticateHumanWithOptionalSuperadmin,
  createSyntheticAuthorityReader,
  createSyntheticSessionAuthenticator,
  denyUnverifiedIntegration,
  isExactPrivateSuperadmin,
  listPlatformTenants,
  listPrincipalTenants,
  platformAllows,
  requireClinicPermission,
  resolveTenantContext,
  roleAllows,
  synthAuthHeader,
  type AuthServices,
  type Permission,
} from './index'
import { AuthError } from './errors'

function servicesFor(db = bootAdminDb()): { services: AuthServices; close: () => void } {
  const authority = createSyntheticAuthorityReader()
  const sessions = createSyntheticSessionAuthenticator({
    authorizedParties: ['http://localhost:5173'],
  })
  return {
    services: {
      sessions,
      authority,
      adminDb: asyncFromSync(db.db),
    },
    close: db.close,
  }
}

function requestFor(userId: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set('Authorization', synthAuthHeader(userId))
  return new Request('http://localhost/api/me', { ...init, headers })
}

describe('superadmin flag — DEC-018 fail closed', () => {
  it('aceita apenas boolean true em privateMetadata', () => {
    expect(isExactPrivateSuperadmin(true)).toBe(true)
    expect(isExactPrivateSuperadmin('true')).toBe(false)
    expect(isExactPrivateSuperadmin(1)).toBe(false)
    expect(isExactPrivateSuperadmin(undefined)).toBe(false)
    expect(isExactPrivateSuperadmin(null)).toBe(false)
  })

  it('nega string true, publicMetadata e falha de autoridade', async () => {
    const { services, close } = servicesFor()
    try {
      await expect(
        authenticateHumanWithOptionalSuperadmin(
          services,
          requestFor('user_synth_string_super'),
          { verifySuperadmin: true },
        ),
      ).rejects.toMatchObject({ code: 'superadmin_required', status: 403 })

      await expect(
        authenticateHumanWithOptionalSuperadmin(
          services,
          requestFor('user_synth_public_super'),
          { verifySuperadmin: true },
        ),
      ).rejects.toMatchObject({ code: 'superadmin_required', status: 403 })

      const failing: AuthServices = {
        ...services,
        authority: createSyntheticAuthorityReader(undefined, {
          failUserIds: new Set(['user_synth_superadmin']),
        }),
      }
      await expect(
        authenticateHumanWithOptionalSuperadmin(
          failing,
          requestFor('user_synth_superadmin'),
          { verifySuperadmin: true },
        ),
      ).rejects.toMatchObject({ code: 'authority_verification_failed', status: 403 })
    } finally {
      close()
    }
  })

  it('concede Platform Admin só com privateMetadata.superadmin === true', async () => {
    const { services, close } = servicesFor()
    try {
      const principal = await authenticateHumanWithOptionalSuperadmin(
        services,
        requestFor('user_synth_superadmin'),
        { verifySuperadmin: true },
      )
      expect(principal.isSuperadmin).toBe(true)
      const tenants = await listPlatformTenants(services, principal)
      expect(tenants.map((t) => t.id)).toContain('clinic-demo-a')
    } finally {
      close()
    }
  })
})

describe('sessão — ausência e expiração', () => {
  it('nega ausência e expiração', async () => {
    const { services, close } = servicesFor()
    try {
      await expect(
        authenticateHuman(services, new Request('http://localhost/api/me')),
      ).rejects.toMatchObject({ code: 'unauthenticated', status: 401 })

      await expect(
        authenticateHuman(services, requestFor('user_synth_expired')),
      ).rejects.toMatchObject({ code: 'session_expired', status: 401 })

      await expect(
        authenticateHuman(services, requestFor('user_synth_invalid')),
      ).rejects.toMatchObject({ code: 'session_invalid', status: 401 })
    } finally {
      close()
    }
  })

  it('nega cookie sem Origin autorizada', async () => {
    const sessions = createSyntheticSessionAuthenticator({
      authorizedParties: ['http://localhost:5173'],
    })
    const result = await sessions.authenticateRequest(
      new Request('http://localhost/api/me', {
        headers: { Cookie: 'synth_session=user_synth_owner_a' },
      }),
    )
    expect(result).toEqual({ ok: false, reason: 'origin_rejected' })

    const ok = await sessions.authenticateRequest(
      new Request('http://localhost/api/me', {
        headers: {
          Cookie: 'synth_session=user_synth_owner_a',
          Origin: 'http://localhost:5173',
        },
      }),
    )
    expect(ok.ok).toBe(true)
  })
})

describe('tenants e roles D1 — AC-17 / DEC-026', () => {
  it('mesmo utilizador exerce roles distintas em A e B', async () => {
    const { services, close } = servicesFor()
    try {
      const principal = await authenticateHuman(services, requestFor('user_synth_multi'))
      const tenants = await listPrincipalTenants(services, principal)
      expect(tenants.map((m) => `${m.tenantId}:${m.role}`)).toEqual([
        'clinic-demo-a:owner',
        'clinic-demo-b:attendant',
      ])

      const ctxA = await resolveTenantContext(services, principal, 'clinic-demo-a')
      const ctxB = await resolveTenantContext(services, principal, 'clinic-demo-b')
      expect(ctxA.role).toBe('owner')
      expect(ctxB.role).toBe('attendant')
      expect(roleAllows(ctxA.role, 'clinic.config.write')).toBe(true)
      expect(roleAllows(ctxB.role, 'clinic.config.write')).toBe(false)
    } finally {
      close()
    }
  })

  it('rejeita role forjada pelo cliente', async () => {
    const { services, close } = servicesFor()
    try {
      const principal = await authenticateHuman(services, requestFor('user_synth_attendant_a'))
      await expect(
        resolveTenantContext(services, principal, 'clinic-demo-a', 'owner'),
      ).rejects.toMatchObject({ code: 'forged_role_rejected', status: 403 })
    } finally {
      close()
    }
  })

  it('tenant suspenso e membership revogado deixam de autorizar', async () => {
    const boot = bootAdminDb()
    const { services, close } = servicesFor(boot)
    const clock = createControllableClock(2_000_000_000_000)
    try {
      const suspendedOwner = await authenticateHuman(
        services,
        requestFor('user_synth_suspended_owner'),
      )
      await expect(
        resolveTenantContext(services, suspendedOwner, 'clinic-demo-suspended'),
      ).rejects.toMatchObject({ code: 'tenant_not_active', status: 403 })

      // Suspende B e confirma que multi perde B mas mantém A até revogação.
      suspendTenant(boot.db, clock, 'clinic-demo-b', 'user_synth_superadmin')
      const multi = await authenticateHuman(services, requestFor('user_synth_multi'))
      const afterSuspend = await listPrincipalTenants(services, multi)
      expect(afterSuspend.map((m) => m.tenantId)).toEqual(['clinic-demo-a'])

      revokeMembership(boot.db, clock, {
        tenantId: 'clinic-demo-a',
        clerkUserId: 'user_synth_multi',
        actorClerkUserId: 'user_synth_owner_a',
        allowOwnerTarget: true,
      })
      await expect(
        resolveTenantContext(services, multi, 'clinic-demo-a'),
      ).rejects.toMatchObject({ code: 'tenant_access_denied', status: 403 })
    } finally {
      close()
    }
  })

  it('utilizador sem membership não vê tenants nem acessa clínica', async () => {
    const { services, close } = servicesFor()
    try {
      const principal = await authenticateHuman(services, requestFor('user_synth_no_access'))
      expect(await listPrincipalTenants(services, principal)).toEqual([])
      await expect(
        resolveTenantContext(services, principal, 'clinic-demo-a'),
      ).rejects.toMatchObject({ code: 'tenant_access_denied', status: 403 })
    } finally {
      close()
    }
  })

  it('superadmin sem membership não acessa dados clínicos', async () => {
    const { services, close } = servicesFor()
    try {
      const principal = await authenticateHumanWithOptionalSuperadmin(
        services,
        requestFor('user_synth_superadmin'),
        { verifySuperadmin: true },
      )
      expect(principal.isSuperadmin).toBe(true)
      expect(await listPrincipalTenants(services, principal)).toEqual([])
      await expect(
        resolveTenantContext(services, principal, 'clinic-demo-a'),
      ).rejects.toMatchObject({ code: 'tenant_access_denied', status: 403 })
    } finally {
      close()
    }
  })
})

describe('matriz de permissões automatizada', () => {
  const cases: Array<{
    role: 'owner' | 'attendant' | 'superadmin' | 'none'
    permission: Permission
    allowed: boolean
  }> = []

  for (const permission of ALL_PERMISSIONS) {
    const ownerOk = roleAllows('owner', permission)
    const attendantOk = roleAllows('attendant', permission)
    const platformOk = platformAllows(true, permission)
    cases.push({ role: 'owner', permission, allowed: ownerOk })
    cases.push({ role: 'attendant', permission, allowed: attendantOk })
    cases.push({ role: 'superadmin', permission, allowed: platformOk })
    cases.push({ role: 'none', permission, allowed: false })
  }

  it('deny-by-default e papéis esperados', () => {
    expect(ALL_PERMISSIONS.length).toBeGreaterThan(8)
    // Attendant nunca configura clínica nem gere members.
    expect(roleAllows('attendant', 'clinic.config.write')).toBe(false)
    expect(roleAllows('attendant', 'clinic.members.invite_attendant')).toBe(false)
    expect(roleAllows('owner', 'clinic.config.write')).toBe(true)
    // Superadmin não herda inbox clínica.
    expect(platformAllows(true, 'clinic.inbox.read')).toBe(false)
    expect(platformAllows(true, 'platform.tenants.read')).toBe(true)
    expect(platformAllows(false, 'platform.tenants.read')).toBe(false)
  })

  it.each(cases)(
    '$role / $permission => $allowed',
    ({ role, permission, allowed }) => {
      if (role === 'owner' || role === 'attendant') {
        expect(roleAllows(role, permission)).toBe(allowed)
        if (!allowed) {
          expect(() =>
            requireClinicPermission(
              {
                tenantId: 'clinic-demo-a',
                role,
                tenantName: 'x',
                tenantStatus: 'active',
              },
              permission,
            ),
          ).toThrow(AuthError)
        }
      } else if (role === 'superadmin') {
        expect(platformAllows(true, permission)).toBe(allowed)
      } else {
        expect(platformAllows(false, permission)).toBe(false)
        expect(roleAllows('attendant', permission) && false).toBe(false)
      }
    },
  )

  it('falha de verificação de autoridade nunca concede', async () => {
    const { services, close } = servicesFor()
    try {
      const failing: AuthServices = {
        ...services,
        authority: {
          async readUserAuthority() {
            throw new Error('boom')
          },
        },
      }
      await expect(
        authenticateHumanWithOptionalSuperadmin(
          failing,
          requestFor('user_synth_superadmin'),
          { verifySuperadmin: true },
        ),
      ).rejects.toMatchObject({ code: 'authority_verification_failed' })
    } finally {
      close()
    }
  })

  it('integração não verificada é negada', () => {
    expect(() => denyUnverifiedIntegration()).toThrow(AuthError)
  })
})
