import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { acceptInvitation, createInvitation, getMembership } from '../db/admin'
import { bootAdminDb } from '../db/test-db'
import type { EmailTransport } from '../email/types'
import { ConflictError } from '../db/admin'
import { linkProfessionalLogin, releaseProfessionalLogin } from './professional-login'

const TENANT = 'clinic-demo-a'
const OWNER = 'user_synth_owner_a'
const ATTENDANT = 'user_synth_attendant_a'

const emailTransport: EmailTransport = {
  name: 'test',
  async sendInvitation() {
    return { ok: true, providerMessageId: 'msg' }
  },
  async sendSupportAccessRequest() {
    return { ok: true, providerMessageId: 'msg' }
  },
  async sendSupportSessionStarted() {
    return { ok: true, providerMessageId: 'msg' }
  },
}

describe('login da profissional (DEC-204 revista — Equipe primeiro)', () => {
  it('sem membership activo recusa e não cria convite', async () => {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock()
    try {
      await expect(
        linkProfessionalLogin(db, clock, emailTransport, 'https://app.test', {
          tenantId: TENANT,
          resourceId: 'pro-ana',
          email: 'Ana@Clinica.Example',
          alsoAttendant: false,
          actorClerkUserId: OWNER,
        }),
      ).rejects.toMatchObject({ code: 'membership_required' })
      expect(
        db.get(
          `SELECT 1 FROM professional_logins WHERE tenant_id = ? AND resource_id = ?`,
          TENANT,
          'pro-ana',
        ),
      ).toBeUndefined()
      expect(
        db.get(
          `SELECT 1 FROM tenant_invitations WHERE tenant_id = ? AND normalized_email = ?`,
          TENANT,
          'ana@clinica.example',
        ),
      ).toBeUndefined()
    } finally {
      close()
    }
  })

  it('aceitar convite de profissional legado ainda grava o Clerk na ficha', async () => {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock()
    try {
      db.run(
        `INSERT INTO professional_logins (
           tenant_id, resource_id, normalized_email, clerk_user_id, also_attendant
         ) VALUES (?, ?, ?, NULL, 0)`,
        TENANT,
        'pro-bia',
        'bia@clinica.example',
      )
      const issued = await createInvitation(db, clock, {
        tenantId: TENANT,
        email: 'bia@clinica.example',
        issuedByClerkUserId: OWNER,
        role: 'professional',
      })
      await acceptInvitation(db, clock, {
        rawToken: issued.rawToken,
        acceptorClerkUserId: 'user_bia',
        verifiedEmail: 'bia@clinica.example',
      })
      const row = db.get<{ clerk_user_id: string }>(
        `SELECT clerk_user_id FROM professional_logins WHERE tenant_id = ? AND resource_id = ?`,
        TENANT,
        'pro-bia',
      )
      expect(row?.clerk_user_id).toBe('user_bia')
      expect(getMembership(db, TENANT, 'user_bia')?.role).toBe('professional')
    } finally {
      close()
    }
  })

  it('atendente já na clínica desce a profissional; a responsável não desce', async () => {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock()
    try {
      const demoted = await linkProfessionalLogin(db, clock, emailTransport, 'https://app.test', {
        tenantId: TENANT,
        resourceId: 'pro-lia',
        email: 'lia@clinica.example',
        alsoAttendant: false,
        actorClerkUserId: OWNER,
        boundClerkUserId: ATTENDANT,
      })
      expect(demoted.invitationSent).toBe(false)
      expect(demoted.membershipRole).toBe('professional')
      expect(getMembership(db, TENANT, ATTENDANT)?.role).toBe('professional')

      const owner = await linkProfessionalLogin(db, clock, emailTransport, 'https://app.test', {
        tenantId: TENANT,
        resourceId: 'pro-dona',
        email: 'dona@clinica.example',
        alsoAttendant: false,
        actorClerkUserId: OWNER,
        boundClerkUserId: OWNER,
      })
      expect(owner.membershipRole).toBe('owner')
      expect(getMembership(db, TENANT, OWNER)?.role).toBe('owner')
    } finally {
      close()
    }
  })

  it('desativar revoga só o papel professional e apaga o vínculo', async () => {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock()
    try {
      await linkProfessionalLogin(db, clock, emailTransport, 'https://app.test', {
        tenantId: TENANT,
        resourceId: 'pro-lia',
        email: 'lia@clinica.example',
        alsoAttendant: false,
        actorClerkUserId: OWNER,
        boundClerkUserId: ATTENDANT,
      })
      const cut = releaseProfessionalLogin(db, clock, {
        tenantId: TENANT,
        resourceId: 'pro-lia',
        actorClerkUserId: OWNER,
      })
      expect(cut.revoked).toBe(true)
      expect(getMembership(db, TENANT, ATTENDANT)?.status).toBe('revoked')
      expect(
        db.get(
          `SELECT 1 FROM professional_logins WHERE tenant_id = ? AND resource_id = ?`,
          TENANT,
          'pro-lia',
        ),
      ).toBeUndefined()

      await expect(
        linkProfessionalLogin(db, clock, emailTransport, 'https://app.test', {
          tenantId: TENANT,
          resourceId: 'pro-outra',
          email: 'lia@clinica.example',
          alsoAttendant: false,
          actorClerkUserId: OWNER,
        }),
      ).rejects.toMatchObject({ code: 'membership_required' })

      await linkProfessionalLogin(db, clock, emailTransport, 'https://app.test', {
        tenantId: TENANT,
        resourceId: 'pro-dona',
        email: 'dona@clinica.example',
        alsoAttendant: true,
        actorClerkUserId: OWNER,
        boundClerkUserId: OWNER,
      })
      const kept = releaseProfessionalLogin(db, clock, {
        tenantId: TENANT,
        resourceId: 'pro-dona',
        actorClerkUserId: OWNER,
      })
      expect(kept.revoked).toBe(false)
      expect(getMembership(db, TENANT, OWNER)?.status).toBe('active')
      expect(
        db.get(
          `SELECT 1 FROM professional_logins WHERE tenant_id = ? AND resource_id = ?`,
          TENANT,
          'pro-dona',
        ),
      ).toBeUndefined()
    } finally {
      close()
    }
  })

  it('troca de membro na ficha revoga atendente só via alsoAttendant nesta ficha', async () => {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock()
    try {
      await linkProfessionalLogin(db, clock, emailTransport, 'https://app.test', {
        tenantId: TENANT,
        resourceId: 'pro-lia',
        email: 'lia@clinica.example',
        alsoAttendant: true,
        actorClerkUserId: OWNER,
        boundClerkUserId: ATTENDANT,
      })
      expect(getMembership(db, TENANT, ATTENDANT)?.role).toBe('attendant')

      await linkProfessionalLogin(db, clock, emailTransport, 'https://app.test', {
        tenantId: TENANT,
        resourceId: 'pro-lia',
        email: 'owner.a@example.test',
        alsoAttendant: false,
        actorClerkUserId: OWNER,
        boundClerkUserId: OWNER,
      })
      expect(getMembership(db, TENANT, ATTENDANT)?.status).toBe('revoked')
      const row = db.get<{ clerk_user_id: string | null; normalized_email: string }>(
        `SELECT clerk_user_id, normalized_email FROM professional_logins
         WHERE tenant_id = ? AND resource_id = ?`,
        TENANT,
        'pro-lia',
      )
      expect(row?.normalized_email).toBe('owner.a@example.test')
      expect(row?.clerk_user_id).toBe(OWNER)
      expect(getMembership(db, TENANT, OWNER)?.role).toBe('owner')
    } finally {
      close()
    }
  })

  it('recusa o mesmo e-mail noutra ficha', async () => {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock()
    try {
      await linkProfessionalLogin(db, clock, emailTransport, 'https://app.test', {
        tenantId: TENANT,
        resourceId: 'pro-ana',
        email: 'attendant.a@example.test',
        alsoAttendant: false,
        actorClerkUserId: OWNER,
        boundClerkUserId: ATTENDANT,
      })
      await expect(
        linkProfessionalLogin(db, clock, emailTransport, 'https://app.test', {
          tenantId: TENANT,
          resourceId: 'pro-bia',
          email: 'attendant.a@example.test',
          alsoAttendant: false,
          actorClerkUserId: OWNER,
          boundClerkUserId: OWNER,
        }),
      ).rejects.toBeInstanceOf(ConflictError)
    } finally {
      close()
    }
  })
})
