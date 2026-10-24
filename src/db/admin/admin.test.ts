import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../clock'
import { applyRemainingFromAdmin, bootAdminDb, migrateUntilMemberships, openMemoryDb } from '../test-db'
import { fromNodeSqlite } from './store'
import { redactSecrets, hashToken } from '../tokens'
import {
  ADMIN_SCHEMA_VERSION,
  INVITATION_RESEND_COOLDOWN_MS,
  INVITATION_RESEND_MAX,
  INVITATION_RESEND_WINDOW_MS,
  SUPPORT_REQUEST_TTL_MS,
  SUPPORT_SESSION_TTL_MS,
  SchemaNotReadyError,
  ConflictError,
  ForbiddenError,
  assertAdminSchemaReady,
  createInvitation,
  resendInvitation,
  cancelInvitation,
  acceptInvitation,
  createSupportAccessRequest,
  approveSupportRequest,
  activateSupportSession,
  rejectSupportRequest,
  consumeSupportHandoff,
  revokeSupportSession,
  expireSupportSessionIfNeeded,
  requestSupportTermination,
  suspendTenant,
  reactivateTenant,
  revokeMembership,
  listActiveMembershipsForUser,
  adminTenantSnapshot,
  adminUserTenants,
  listAuditForTenant,
} from './index'

describe('admin schema gate', () => {
  it('bloqueia repositórios sem migração 0003', () => {
    const raw = openMemoryDb()
    try {
      migrateUntilMemberships(raw)
      const db = fromNodeSqlite(raw)
      expect(() => assertAdminSchemaReady(db)).toThrow(SchemaNotReadyError)
    } finally {
      raw.close()
    }
  })

  it('aceita schema na versão administrativa esperada após upgrade', () => {
    const raw = openMemoryDb()
    try {
      migrateUntilMemberships(raw)
      applyRemainingFromAdmin(raw)
      const db = fromNodeSqlite(raw)
      expect(() => assertAdminSchemaReady(db)).not.toThrow()
      expect(ADMIN_SCHEMA_VERSION).toBe(9)
    } finally {
      raw.close()
    }
  })
})

describe('escopo administrativo e fixtures', () => {
  it('lista memberships N:N e nega snapshot a utilizador sem acesso', () => {
    const { db, close } = bootAdminDb()
    try {
      const multi = listActiveMembershipsForUser(db, 'user_synth_multi')
      expect(multi.map((m) => `${m.tenantId}:${m.role}`)).toEqual([
        'clinic-demo-a:owner',
        'clinic-demo-b:attendant',
      ])

      expect(adminUserTenants(db, 'user_synth_no_access')).toEqual([])

      expect(() =>
        adminTenantSnapshot(db, 'clinic-demo-a', { viewerClerkUserId: 'user_synth_no_access' }),
      ).toThrow(ForbiddenError)

      const snap = adminTenantSnapshot(db, 'clinic-demo-a', {
        viewerClerkUserId: 'user_synth_owner_a',
        requireOwner: true,
      })
      expect(snap?.tenant.id).toBe('clinic-demo-a')
      expect(snap?.members.length).toBeGreaterThanOrEqual(4)
    } finally {
      close()
    }
  })

  it('revogação em A preserva membership em B', () => {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock(2_000_000_000_000)
    try {
      revokeMembership(db, clock, {
        tenantId: 'clinic-demo-a',
        clerkUserId: 'user_synth_multi',
        actorClerkUserId: 'user_synth_owner_a',
        allowOwnerTarget: true,
      })
      const left = listActiveMembershipsForUser(db, 'user_synth_multi')
      expect(left).toEqual([
        expect.objectContaining({ tenantId: 'clinic-demo-b', role: 'attendant', status: 'active' }),
      ])
      const audit = listAuditForTenant(db, 'clinic-demo-a')
      expect(audit.some((e) =>
        e.action === 'membership.revoke' && e.subjectClerkUserId === 'user_synth_multi',
      )).toBe(true)
    } finally {
      close()
    }
  })

  it('suspende tenant com transição atómica e auditoria', () => {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock(2_000_000_000_000)
    try {
      const suspended = suspendTenant(db, clock, 'clinic-demo-b', 'user_synth_superadmin')
      expect(suspended.status).toBe('suspended')
      expect(suspended.suspendedAt).toBe(clock.nowMs())
      expect(() => suspendTenant(db, clock, 'clinic-demo-b', 'user_synth_superadmin')).toThrow(ConflictError)
      const active = reactivateTenant(db, clock, 'clinic-demo-b', 'user_synth_superadmin')
      expect(active.status).toBe('active')
    } finally {
      close()
    }
  })
})

describe('convites — token hash, rotação e consumo concorrente', () => {
  it('persiste só hash e nunca expõe token na auditoria', async () => {
    const { db, raw, close } = bootAdminDb()
    const clock = createControllableClock(2_100_000_000_000)
    try {
      const issued = await createInvitation(db, clock, {
        tenantId: 'clinic-demo-a',
        email: 'Attendant.New@Example.Test',
        issuedByClerkUserId: 'user_synth_owner_a',
      })
      expect(issued.rawToken.length).toBeGreaterThan(20)
      expect(issued.invitation.normalizedEmail).toBe('attendant.new@example.test')

      const stored = raw.prepare(
        'SELECT token_hash FROM tenant_invitations WHERE id = ?',
      ).get(issued.invitation.id) as { token_hash: string }
      expect(stored.token_hash).toBe(await hashToken(issued.rawToken))
      expect(stored.token_hash).not.toContain(issued.rawToken)

      const audit = listAuditForTenant(db, 'clinic-demo-a')
      const createEvt = audit.find((e) => e.action === 'invitation.create')!
      expect(createEvt.metadataJson).not.toContain(issued.rawToken)
      expect(JSON.stringify(redactSecrets({ token: issued.rawToken, email: 'x' }))).toContain('[redacted]')
    } finally {
      close()
    }
  })

  it('rotação invalida token antigo; cooldown e quota DEC-024', async () => {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock(2_200_000_000_000)
    try {
      const first = await createInvitation(db, clock, {
        tenantId: 'clinic-demo-a',
        email: 'rotate@example.test',
        issuedByClerkUserId: 'user_synth_owner_a',
      })

      // Criação inicial não é reenvio (DEC-024): o primeiro reenvio é imediato.
      const second = await resendInvitation(db, clock, {
        invitationId: first.invitation.id,
        actorClerkUserId: 'user_synth_owner_a2',
      })
      expect(second.rawToken).not.toBe(first.rawToken)

      await expect(
        resendInvitation(db, clock, {
          invitationId: first.invitation.id,
          actorClerkUserId: 'user_synth_owner_a',
        }),
      ).rejects.toMatchObject({ code: 'invitation_resend_cooldown' })

      clock.advance(INVITATION_RESEND_COOLDOWN_MS)

      await expect(
        acceptInvitation(db, clock, {
          rawToken: first.rawToken,
          acceptorClerkUserId: 'user_synth_new_attendant',
          verifiedEmail: 'rotate@example.test',
        }),
      ).rejects.toMatchObject({ code: 'invitation_token_invalid' })

      for (let i = 0; i < INVITATION_RESEND_MAX - 1; i++) {
        clock.advance(INVITATION_RESEND_COOLDOWN_MS)
        await resendInvitation(db, clock, {
          invitationId: first.invitation.id,
          actorClerkUserId: 'user_synth_owner_a',
        })
      }
      clock.advance(INVITATION_RESEND_COOLDOWN_MS)
      await expect(
        resendInvitation(db, clock, {
          invitationId: first.invitation.id,
          actorClerkUserId: 'user_synth_owner_a',
        }),
      ).rejects.toMatchObject({ code: 'invitation_resend_quota' })

      clock.advance(INVITATION_RESEND_WINDOW_MS)
      await resendInvitation(db, clock, {
        invitationId: first.invitation.id,
        actorClerkUserId: 'user_synth_owner_a',
      })
    } finally {
      close()
    }
  })

  it('consumo concorrente: apenas um aceite cria membership', async () => {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock(2_300_000_000_000)
    try {
      const issued = await createInvitation(db, clock, {
        tenantId: 'clinic-demo-a',
        email: 'race@example.test',
        issuedByClerkUserId: 'user_synth_owner_a',
      })

      const results = await Promise.allSettled([
        acceptInvitation(db, clock, {
          rawToken: issued.rawToken,
          acceptorClerkUserId: 'user_race_1',
          verifiedEmail: 'race@example.test',
        }),
        acceptInvitation(db, clock, {
          rawToken: issued.rawToken,
          acceptorClerkUserId: 'user_race_2',
          verifiedEmail: 'race@example.test',
        }),
      ])

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)

      const members = adminTenantSnapshot(db, 'clinic-demo-a')!.members
        .filter((m) => m.clerkUserId.startsWith('user_race_'))
      expect(members).toHaveLength(1)
      expect(members[0]?.role).toBe('attendant')
    } finally {
      close()
    }
  })

  it('cancelamento por outro owner invalida aceite posterior', async () => {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock(2_400_000_000_000)
    try {
      const issued = await createInvitation(db, clock, {
        tenantId: 'clinic-demo-a',
        email: 'cancel@example.test',
        issuedByClerkUserId: 'user_synth_owner_a',
      })
      cancelInvitation(db, clock, {
        invitationId: issued.invitation.id,
        actorClerkUserId: 'user_synth_owner_a2',
      })
      await expect(
        acceptInvitation(db, clock, {
          rawToken: issued.rawToken,
          acceptorClerkUserId: 'user_cancelled',
          verifiedEmail: 'cancel@example.test',
        }),
      ).rejects.toBeInstanceOf(ConflictError)
    } finally {
      close()
    }
  })
})

describe('suporte — aprovação (#26) e ativação/handoff (#27 domínio)', () => {
  it('aprovação não cria sessão; ativação consome handoff uma vez e expira aos 30min', async () => {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock(2_500_000_000_000)
    try {
      const request = createSupportAccessRequest(db, clock, {
        tenantId: 'clinic-demo-a',
        actorClerkUserId: 'user_synth_superadmin',
        subjectClerkUserId: 'user_synth_attendant_a',
        reason: 'diagnóstico sintético',
        scope: 'read_diagnostics',
      })
      expect(request.expiresAt - request.createdAt).toBe(SUPPORT_REQUEST_TTL_MS)

      const approved = approveSupportRequest(db, clock, {
        requestId: request.id,
        ownerClerkUserId: 'user_synth_owner_a',
      })
      expect(approved.status).toBe('approved')
      expect(
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM support_sessions WHERE support_access_request_id = ?`,
          approved.id,
        )?.n,
      ).toBe(0)

      const activated = await activateSupportSession(db, clock, {
        requestId: approved.id,
        actorClerkUserId: 'user_synth_superadmin',
        actorClerkSessionId: 'sess_synth_actor',
      })
      expect(activated.session.expiresAt - activated.session.activatedAt).toBe(SUPPORT_SESSION_TTL_MS)

      const consumed = await consumeSupportHandoff(db, clock, {
        handoffCode: activated.handoffCode,
        actorClerkUserId: 'user_synth_superadmin',
        actorClerkSessionId: 'sess_synth_actor',
      })
      expect(consumed.session.id).toBe(activated.session.id)
      expect(consumed.sessionToken).toBeTruthy()

      await expect(
        consumeSupportHandoff(db, clock, {
          handoffCode: activated.handoffCode,
          actorClerkUserId: 'user_synth_superadmin',
          actorClerkSessionId: 'sess_synth_actor',
        }),
      ).rejects.toMatchObject({ code: 'handoff_invalid' })

      clock.advance(SUPPORT_SESSION_TTL_MS)
      const expired = expireSupportSessionIfNeeded(db, clock, consumed.session.id)
      expect(expired.status).toBe('expired')

      const audit = listAuditForTenant(db, 'clinic-demo-a')
      expect(audit.every((e) => !JSON.stringify(e).includes(activated.sessionToken))).toBe(true)
      expect(audit.every((e) => !JSON.stringify(e).includes(consumed.sessionToken))).toBe(true)
      expect(audit.every((e) => !JSON.stringify(e).includes(activated.handoffCode))).toBe(true)
      expect(audit.some((e) => e.action === 'support.request.approve')).toBe(true)
      expect(audit.some((e) =>
        e.action === 'support.session.activate'
        && e.subjectClerkUserId === 'user_synth_attendant_a',
      )).toBe(true)
    } finally {
      close()
    }
  })

  it('pedido expirado (24h) não aprova; rejeição e revogação por owner', async () => {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock(2_600_000_000_000)
    try {
      const expiredReq = createSupportAccessRequest(db, clock, {
        tenantId: 'clinic-demo-a',
        actorClerkUserId: 'user_synth_superadmin',
        subjectClerkUserId: 'user_synth_attendant_a',
        reason: 'expirar',
        scope: 'read',
      })
      clock.advance(SUPPORT_REQUEST_TTL_MS)
      expect(() =>
        approveSupportRequest(db, clock, {
          requestId: expiredReq.id,
          ownerClerkUserId: 'user_synth_owner_a',
        }),
      ).toThrow(ConflictError)

      const req = createSupportAccessRequest(db, clock, {
        tenantId: 'clinic-demo-a',
        actorClerkUserId: 'user_synth_superadmin',
        subjectClerkUserId: 'user_synth_attendant_a',
        reason: 'rejeitar',
        scope: 'read',
      })
      rejectSupportRequest(db, clock, {
        requestId: req.id,
        ownerClerkUserId: 'user_synth_owner_a2',
      })

      const live = createSupportAccessRequest(db, clock, {
        tenantId: 'clinic-demo-a',
        actorClerkUserId: 'user_synth_superadmin',
        subjectClerkUserId: 'user_synth_attendant_a',
        reason: 'revogar',
        scope: 'read',
      })
      approveSupportRequest(db, clock, {
        requestId: live.id,
        ownerClerkUserId: 'user_synth_owner_a',
      })
      const activated = await activateSupportSession(db, clock, {
        requestId: live.id,
        actorClerkUserId: 'user_synth_superadmin',
        actorClerkSessionId: 'sess2',
      })
      const revoked = revokeSupportSession(db, clock, {
        sessionId: activated.session.id,
        actorClerkUserId: 'user_synth_owner_a2',
        asOwner: true,
      })
      expect(revoked.status).toBe('revoked')

      expect(() =>
        requestSupportTermination(db, clock, {
          sessionId: activated.session.id,
          subjectClerkUserId: 'user_synth_attendant_a',
        }),
      ).toThrow(ConflictError)
    } finally {
      close()
    }
  })

  it('aprovação concorrente: só uma decisão vence', () => {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock(2_700_000_000_000)
    try {
      const req = createSupportAccessRequest(db, clock, {
        tenantId: 'clinic-demo-a',
        actorClerkUserId: 'user_synth_superadmin',
        subjectClerkUserId: 'user_synth_attendant_a',
        reason: 'race',
        scope: 'read',
      })

      const results = [
        (() => {
          try {
            return {
              status: 'fulfilled' as const,
              value: approveSupportRequest(db, clock, {
                requestId: req.id,
                ownerClerkUserId: 'user_synth_owner_a',
              }),
            }
          } catch (reason) {
            return { status: 'rejected' as const, reason }
          }
        })(),
        (() => {
          try {
            return {
              status: 'fulfilled' as const,
              value: approveSupportRequest(db, clock, {
                requestId: req.id,
                ownerClerkUserId: 'user_synth_owner_a2',
              }),
            }
          } catch (reason) {
            return { status: 'rejected' as const, reason }
          }
        })(),
      ]
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    } finally {
      close()
    }
  })
})

describe('legado operacional separado', () => {
  it('services/professionals existem como legado mas não entram no snapshot admin', () => {
    const { db, raw, close } = bootAdminDb()
    try {
      const snap = adminTenantSnapshot(db, 'clinic-demo-a', {
        viewerClerkUserId: 'user_synth_owner_a',
      })
      expect(snap).not.toHaveProperty('services')
      expect(snap).not.toHaveProperty('professionals')
      expect(
        (raw.prepare('SELECT COUNT(*) AS n FROM services WHERE tenant_id = ?').get('clinic-demo-a') as { n: number }).n,
      ).toBeGreaterThan(0)
    } finally {
      close()
    }
  })
})
