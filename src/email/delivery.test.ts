import { describe, expect, it } from 'vitest'
import { bootAdminDb } from '../db/test-db'
import { createControllableClock } from '../db/clock'
import { createInvitation, listAuditForTenant } from '../db/admin'
import { redactSecrets } from '../db/tokens'
import {
  createSimulatedEmailTransport,
  deliverInvitationEmail,
  listDeliveryJobsForInvitation,
  processInvitationDelivery,
  tokenFromInviteUrl,
} from './index'

describe('e-mail delivery — idempotência e retries (#25)', () => {
  it('retry de entrega não cria convites extras; token ausente da auditoria', async () => {
    const { db, close } = bootAdminDb()
    const clock = createControllableClock(3_000_000_000_000)
    const transport = createSimulatedEmailTransport({ clock })
    transport.failNext(2)
    try {
      const issued = await createInvitation(db, clock, {
        tenantId: 'clinic-demo-a',
        email: 'delivery@example.test',
        issuedByClerkUserId: 'user_synth_owner_a',
      })

      const first = await deliverInvitationEmail(db, clock, transport, {
        invitationId: issued.invitation.id,
        issuedAt: issued.invitation.issuedAt,
        toEmail: issued.invitation.normalizedEmail,
        tenantId: 'clinic-demo-a',
        tenantName: 'Clínica Demo A',
        rawToken: issued.rawToken,
        expiresAt: issued.invitation.expiresAt,
        appBaseUrl: 'http://localhost:5173',
        actorClerkUserId: 'user_synth_owner_a',
      })
      expect(first.sent).toBe(false)
      expect(first.created).toBe(true)
      expect(first.job.attemptCount).toBe(1)

      // Mesma chave idempotente — não cria 2º job nem 2º convite.
      const again = await deliverInvitationEmail(db, clock, transport, {
        invitationId: issued.invitation.id,
        issuedAt: issued.invitation.issuedAt,
        toEmail: issued.invitation.normalizedEmail,
        tenantId: 'clinic-demo-a',
        tenantName: 'Clínica Demo A',
        rawToken: issued.rawToken,
        expiresAt: issued.invitation.expiresAt,
        appBaseUrl: 'http://localhost:5173',
        actorClerkUserId: 'user_synth_owner_a',
      })
      expect(again.created).toBe(false)
      expect(again.job.id).toBe(first.job.id)

      const jobs = listDeliveryJobsForInvitation(db, issued.invitation.id)
      expect(jobs).toHaveLength(1)

      // 3ª tentativa (após 2 falhas) — sucesso; um único e-mail no mailbox.
      const recovered = await processInvitationDelivery(db, clock, transport, {
        jobId: first.job.id,
        payload: {
          toEmail: issued.invitation.normalizedEmail,
          tenantId: 'clinic-demo-a',
          tenantName: 'Clínica Demo A',
          invitationId: issued.invitation.id,
          rawToken: issued.rawToken,
          expiresAt: issued.invitation.expiresAt,
          appBaseUrl: 'http://localhost:5173',
        },
      })
      expect(recovered.sent).toBe(true)
      expect(transport.mailbox).toHaveLength(1)
      expect(tokenFromInviteUrl(transport.mailbox[0]!.inviteUrl)).toBe(issued.rawToken)

      const audit = listAuditForTenant(db, 'clinic-demo-a')
      const blob = JSON.stringify(audit)
      expect(blob).not.toContain(issued.rawToken)
      expect(JSON.stringify(redactSecrets({ rawToken: issued.rawToken }))).toContain('[redacted]')
    } finally {
      close()
    }
  })
})
