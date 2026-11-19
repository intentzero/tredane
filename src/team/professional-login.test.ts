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

describe('login da profissional (DEC-204)', () => {
  it('e-mail novo cria a linha e um convite de profissional', async () => {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock()
    try {
      const out = await linkProfessionalLogin(db, clock, emailTransport, 'https://app.test', {
        tenantId: TENANT,
        resourceId: 'pro-ana',
        email: 'Ana@Clinica.Example',
        alsoAttendant: false,
        actorClerkUserId: OWNER,
      })
      expect(out.invitationSent).toBe(true)
      expect(out.login.email).toBe('ana@clinica.example')
      expect(out.login.clerkUserId).toBeNull()
      const invite = db.get<{ role: string; status: string }>(
        `SELECT role, status FROM tenant_invitations
         WHERE tenant_id = ? AND normalized_email = ?`,
        TENANT,
        'ana@clinica.example',
      )
      expect(invite).toEqual({ role: 'professional', status: 'pending' })
    } finally {
      close()
    }
  })

  it('aceitar o convite grava o utilizador Clerk na ficha', async () => {
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

  it('desativar revoga só o papel professional', async () => {
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
        email: 'ana@clinica.example',
        alsoAttendant: false,
        actorClerkUserId: OWNER,
      })
      await expect(
        linkProfessionalLogin(db, clock, emailTransport, 'https://app.test', {
          tenantId: TENANT,
          resourceId: 'pro-bia',
          email: 'ana@clinica.example',
          alsoAttendant: false,
          actorClerkUserId: OWNER,
        }),
      ).rejects.toBeInstanceOf(ConflictError)
    } finally {
      close()
    }
  })
})
