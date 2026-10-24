import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { bootAdminDb } from '../db/test-db'
import {
  assignOwner,
  countActiveOwners,
  createTenantWithOwner,
  listAuditForTenant,
  listMembersForTenant,
  markTenantPendingDeletionLifecycle,
  reactivateTenantLifecycle,
  removeOwner,
  replaceOwner,
  revokeMembership,
  suspendTenantLifecycle,
  ConflictError,
  ForbiddenError,
} from '../db/admin'
import {
  activateSupportSession,
  approveSupportRequest,
  createSupportAccessRequest,
} from '../db/admin/support'

describe('Platform Admin domínio (#24)', () => {
  it('cria tenant com primeiro owner e audita', () => {
    const { db, close } = bootAdminDb({ seed: true })
    const clock = createControllableClock(2_400_000_000_000)
    try {
      const created = createTenantWithOwner(db, clock, {
        id: 'clinic-demo-new',
        name: 'Nova Clínica Sintética',
        ownerClerkUserId: 'user_synth_new_owner',
        actorClerkUserId: 'user_synth_superadmin',
      })
      expect(created.tenant.status).toBe('active')
      expect(created.owner.role).toBe('owner')
      expect(countActiveOwners(db, 'clinic-demo-new')).toBe(1)
      const audit = listAuditForTenant(db, 'clinic-demo-new')
      expect(audit.some((e) => e.action === 'tenant.create')).toBe(true)
      expect(audit.some((e) => e.action === 'owner.assign')).toBe(true)
    } finally {
      close()
    }
  })

  it('protege último owner; replace e promote preservam ≥1', () => {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock(2_410_000_000_000)
    try {
      expect(() =>
        removeOwner(db, clock, {
          tenantId: 'clinic-demo-b',
          clerkUserId: 'user_synth_owner_b',
          actorClerkUserId: 'user_synth_superadmin',
        }),
      ).toThrow(ForbiddenError)

      assignOwner(db, clock, {
        tenantId: 'clinic-demo-b',
        clerkUserId: 'user_synth_attendant_a',
        actorClerkUserId: 'user_synth_superadmin',
      })
      expect(
        listMembersForTenant(db, 'clinic-demo-b').find(
          (m) => m.clerkUserId === 'user_synth_attendant_a',
        )?.role,
      ).toBe('owner')

      const replaced = replaceOwner(db, clock, {
        tenantId: 'clinic-demo-b',
        fromClerkUserId: 'user_synth_owner_b',
        toClerkUserId: 'user_synth_multi',
        actorClerkUserId: 'user_synth_superadmin',
      })
      expect(replaced.from.status).toBe('revoked')
      expect(replaced.to.role).toBe('owner')
      expect(replaced.to.status).toBe('active')
      // Membership B do multi como attendant foi promovido; vínculo A intacto.
      expect(
        listMembersForTenant(db, 'clinic-demo-a').find(
          (m) => m.clerkUserId === 'user_synth_multi',
        )?.status,
      ).toBe('active')
    } finally {
      close()
    }
  })

  it('suspensão corta suporte; reativação não restaura memberships/suporte', async () => {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock(2_420_000_000_000)
    try {
      revokeMembership(db, clock, {
        tenantId: 'clinic-demo-a',
        clerkUserId: 'user_synth_attendant_a',
        actorClerkUserId: 'user_synth_owner_a',
      })

      const req = createSupportAccessRequest(db, clock, {
        tenantId: 'clinic-demo-a',
        actorClerkUserId: 'user_synth_superadmin',
        subjectClerkUserId: 'user_synth_owner_a',
        reason: 'diagnóstico sintético',
        scope: 'read_inbox',
      })
      approveSupportRequest(db, clock, {
        requestId: req.id,
        ownerClerkUserId: 'user_synth_owner_a',
      })
      const activated = await activateSupportSession(db, clock, {
        requestId: req.id,
        actorClerkUserId: 'user_synth_superadmin',
        actorClerkSessionId: 'sess_synth_super',
      })
      expect(activated.session.status).toBe('active')

      const suspended = suspendTenantLifecycle(
        db,
        clock,
        'clinic-demo-a',
        'user_synth_superadmin',
      )
      expect(suspended.tenant.status).toBe('suspended')
      expect(suspended.revokedSupportSessionIds).toContain(activated.session.id)

      const reactivated = reactivateTenantLifecycle(
        db,
        clock,
        'clinic-demo-a',
        'user_synth_superadmin',
      )
      expect(reactivated.tenant.status).toBe('active')
      expect(reactivated.preservedRevokedMemberships).toBeGreaterThanOrEqual(1)
      expect(reactivated.preservedRevokedSupport).toBeGreaterThanOrEqual(1)

      const attendant = listMembersForTenant(db, 'clinic-demo-a', {
        includeRevoked: true,
      }).find((m) => m.clerkUserId === 'user_synth_attendant_a')
      expect(attendant?.status).toBe('revoked')
    } finally {
      close()
    }
  })

  it('exclusão lógica enfileira comando e bloqueia edição; concorrência única', () => {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock(2_430_000_000_000)
    try {
      const first = markTenantPendingDeletionLifecycle(
        db,
        clock,
        'clinic-demo-b',
        'user_synth_superadmin',
      )
      expect(first.tenant.status).toBe('pending_deletion')
      expect(first.deletionCommand?.status).toBe('queued')

      expect(() =>
        markTenantPendingDeletionLifecycle(
          db,
          clock,
          'clinic-demo-b',
          'user_synth_superadmin',
        ),
      ).toThrow(ConflictError)

      const audit = listAuditForTenant(db, 'clinic-demo-b')
      expect(audit.filter((e) => e.action === 'tenant.pending_deletion')).toHaveLength(1)
      expect(
        audit.some((e) => e.action === 'tenant.deletion_command.enqueue'),
      ).toBe(true)
    } finally {
      close()
    }
  })
})
