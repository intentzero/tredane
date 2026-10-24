/**
 * Orquestração de expurgo de tenant (#43 / REQ-071).
 */
import { describe, expect, it } from 'vitest'
import { bootAdminDb } from '../db/test-db'
import { createControllableClock } from '../db/clock'
import { markTenantPendingDeletionLifecycle } from '../db/admin/lifecycle'
import { bootClinicDb } from '../clinic/test-db'
import { upsertContact, listContacts } from '../clinic/contacts'
import { wipeClinicOperationalData } from '../clinic/retention'
import { workerCaller } from '../clinic'
import { RETENTION } from '../attachments/policy'
import { purgeDeadlineAt } from './policy'
import { runTenantPurgeUntilDone, tickTenantPurge } from './orchestrator'
import { assertTenantAcceptsClinicalIngest, isTenantPurged } from './guards'
import { getOpenPurgeCommand, getPurgeCommand } from './commands'
import { getTenant } from '../db/admin/tenants'

describe('retenção — expurgo de clínica ≤30 dias', () => {
  it('avança checkpoints até purged; relógio controlado; idempotente', async () => {
    const admin = bootAdminDb({ seed: true })
    const clinic = bootClinicDb()
    try {
      const clock = createControllableClock(1_700_000_000_000)
      const actor = 'user_synth_superadmin'
      const tenantId = 'clinic-demo-a'
      const caller = workerCaller(tenantId, actor)

      upsertContact(
        clinic.db,
        { tenantId, waId: '5511999000111', displayName: 'Cliente Fictício' },
        clock,
      )
      expect(listContacts(clinic.db, tenantId)).toHaveLength(1)

      const lifecycle = markTenantPendingDeletionLifecycle(
        admin.db,
        clock,
        tenantId,
        actor,
      )
      expect(lifecycle.tenant.status).toBe('pending_deletion')
      expect(lifecycle.deletionCommand?.status).toBe('queued')

      const cmd = getOpenPurgeCommand(admin.db, tenantId)!
      expect(cmd.deadlineAt).toBe(
        purgeDeadlineAt(lifecycle.tenant.pendingDeletionAt!),
      )
      expect(cmd.deadlineAt! - lifecycle.tenant.pendingDeletionAt!).toBe(
        RETENTION.tenantDeletionMaxDays * 24 * 60 * 60 * 1000,
      )

      const result = await runTenantPurgeUntilDone(
        {
          adminDb: admin.db,
          clock,
          actorClerkUserId: actor,
          attachmentsBucket: null,
          wipeClinic: () => wipeClinicOperationalData(clinic.db, caller, clock),
        },
        { tenantId },
      )

      expect(result.done).toBe(true)
      expect(result.command.status).toBe('completed')
      expect(result.command.lastStep).toBe('completed')
      expect(listContacts(clinic.db, tenantId)).toHaveLength(0)
      expect(isTenantPurged(admin.db, tenantId)).toBe(true)
      expect(getTenant(admin.db, tenantId)?.status).toBe('purged')

      const again = await tickTenantPurge(
        {
          adminDb: admin.db,
          clock,
          actorClerkUserId: actor,
          wipeClinic: () => ({ alreadyWiped: true }),
        },
        { tenantId },
      )
      expect(again.done).toBe(true)
      expect(again.detail.alreadyCompleted).toBe(true)
    } finally {
      clinic.close()
      admin.close()
    }
  })

  it('alerta antes do deadline e marca overdue após 30 dias', async () => {
    const admin = bootAdminDb({ seed: true })
    const clinic = bootClinicDb()
    try {
      const start = 1_700_000_000_000
      const clock = createControllableClock(start)
      const actor = 'user_synth_superadmin'
      const tenantId = 'clinic-demo-b'
      const caller = workerCaller(tenantId, actor)

      markTenantPendingDeletionLifecycle(admin.db, clock, tenantId, actor)
      const cmd = getOpenPurgeCommand(admin.db, tenantId)!
      const deadline = cmd.deadlineAt!

      clock.set(deadline - 2 * 24 * 60 * 60 * 1000)
      const tick = await tickTenantPurge(
        {
          adminDb: admin.db,
          clock,
          actorClerkUserId: actor,
          wipeClinic: () => wipeClinicOperationalData(clinic.db, caller, clock),
        },
        { tenantId },
      )
      expect(tick.alerted).toBe(true)
      expect(getPurgeCommand(admin.db, cmd.id)?.alertSentAt).toBeTruthy()

      clock.set(deadline + 1)
      const overdueTick = await tickTenantPurge(
        {
          adminDb: admin.db,
          clock,
          actorClerkUserId: actor,
          wipeClinic: () => ({ alreadyWiped: true }),
        },
        { tenantId },
      )
      expect(overdueTick.overdue).toBe(true)
    } finally {
      clinic.close()
      admin.close()
    }
  })

  it('replay após purged não reabre tenant activo', async () => {
    const admin = bootAdminDb({ seed: true })
    const clinic = bootClinicDb()
    try {
      const clock = createControllableClock(1_700_000_000_000)
      const actor = 'user_synth_superadmin'
      const tenantId = 'clinic-demo-a'
      const caller = workerCaller(tenantId, actor)
      markTenantPendingDeletionLifecycle(admin.db, clock, tenantId, actor)
      await runTenantPurgeUntilDone(
        {
          adminDb: admin.db,
          clock,
          actorClerkUserId: actor,
          wipeClinic: () => wipeClinicOperationalData(clinic.db, caller, clock),
        },
        { tenantId },
      )
      expect(isTenantPurged(admin.db, tenantId)).toBe(true)

      const gate = assertTenantAcceptsClinicalIngest(admin.db, tenantId)
      expect(gate.ok).toBe(false)
      if (!gate.ok) expect(gate.reason).toBe('tenant_purged')
    } finally {
      clinic.close()
      admin.close()
    }
  })
})
