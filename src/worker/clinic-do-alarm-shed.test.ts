import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { upsertContact } from '../clinic/contacts'
import { createConversation } from '../clinic/inbox/conversations'
import { bootClinicDb } from '../clinic/test-db'
import {
  ALARM_SHED_AUTODRAFT_THRESHOLD,
  ALARM_SHED_IDLE_THRESHOLD,
  countDueAlarmBacklog,
  shedDueAlarmBacklog,
} from './clinic-do-alarm-shed'

const TENANT = 'clinic-shed-alarm'
const NOW = Date.UTC(2026, 10, 15, 4, 0, 0)

describe('shedDueAlarmBacklog', () => {
  it('não limpa abaixo do limiar', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    try {
      const c1 = upsertContact(boot.db, { tenantId: TENANT, waId: '550000009001', displayName: 'A' }, clock)
      const c2 = upsertContact(boot.db, { tenantId: TENANT, waId: '550000009002', displayName: 'B' }, clock)
      const conv1 = createConversation(boot.db, { tenantId: TENANT, contactId: c1.id }, clock)
      const conv2 = createConversation(boot.db, { tenantId: TENANT, contactId: c2.id }, clock)
      for (const id of [conv1.id, conv2.id]) {
        boot.db.run(
          `UPDATE conversations SET idle_due_at = ?, idle_phase = 'prompt' WHERE tenant_id = ? AND id = ?`,
          NOW - 1,
          TENANT,
          id,
        )
      }
      boot.db.run(
        `INSERT INTO ai_autodraft_jobs
           (tenant_id, conversation_id, message_id, due_at, state, created_at, updated_at)
         VALUES (?, ?, 'msg1', ?, 'queued', ?, ?)`,
        TENANT,
        conv1.id,
        NOW - 1,
        NOW - 1_000,
        NOW - 1_000,
      )
      expect(ALARM_SHED_IDLE_THRESHOLD).toBeGreaterThan(2)
      expect(ALARM_SHED_AUTODRAFT_THRESHOLD).toBeGreaterThan(1)
      const r = shedDueAlarmBacklog(boot.db, TENANT, NOW)
      expect(r.shed).toBe(false)
      expect(countDueAlarmBacklog(boot.db, TENANT, NOW)).toEqual({ idleDue: 2, autodraftDue: 1 })
    } finally {
      boot.close()
    }
  })

  it('limpa idle e autodraft vencidos quando o backlog passa o limiar', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    try {
      const dueIds: string[] = []
      for (let i = 0; i < ALARM_SHED_IDLE_THRESHOLD; i++) {
        const contact = upsertContact(
          boot.db,
          { tenantId: TENANT, waId: `55000000901${i}`, displayName: `C${i}` },
          clock,
        )
        const conv = createConversation(boot.db, { tenantId: TENANT, contactId: contact.id }, clock)
        dueIds.push(conv.id)
        boot.db.run(
          `UPDATE conversations SET idle_due_at = ?, idle_phase = 'prompt' WHERE tenant_id = ? AND id = ?`,
          NOW - 1,
          TENANT,
          conv.id,
        )
      }
      const futureContact = upsertContact(
        boot.db,
        { tenantId: TENANT, waId: '550000009099', displayName: 'Future' },
        clock,
      )
      const future = createConversation(boot.db, { tenantId: TENANT, contactId: futureContact.id }, clock)
      boot.db.run(
        `UPDATE conversations SET idle_due_at = ?, idle_phase = 'prompt' WHERE tenant_id = ? AND id = ?`,
        NOW + 60_000,
        TENANT,
        future.id,
      )

      boot.db.run(
        `INSERT INTO ai_autodraft_jobs
           (tenant_id, conversation_id, message_id, due_at, state, created_at, updated_at)
         VALUES (?, ?, 'msg0', ?, 'queued', ?, ?)`,
        TENANT,
        dueIds[0],
        NOW - 1,
        NOW - 1_000,
        NOW - 1_000,
      )
      boot.db.run(
        `INSERT INTO ai_autodraft_jobs
           (tenant_id, conversation_id, message_id, due_at, state, created_at, updated_at)
         VALUES (?, ?, 'msg1', ?, 'generating', ?, ?)`,
        TENANT,
        dueIds[1],
        NOW + 999,
        NOW - 1_000,
        NOW - 1_000,
      )
      boot.db.run(
        `INSERT INTO ai_autodraft_jobs
           (tenant_id, conversation_id, message_id, due_at, state, created_at, updated_at)
         VALUES (?, ?, 'msg2', ?, 'queued', ?, ?)`,
        TENANT,
        dueIds[2] ?? future.id,
        NOW + 60_000,
        NOW - 1_000,
        NOW - 1_000,
      )

      const r = shedDueAlarmBacklog(boot.db, TENANT, NOW)
      expect(r.shed).toBe(true)
      expect(r.idleCleared).toBe(ALARM_SHED_IDLE_THRESHOLD)
      expect(r.autodraftDropped).toBe(2)
      expect(countDueAlarmBacklog(boot.db, TENANT, NOW)).toEqual({ idleDue: 0, autodraftDue: 0 })
      expect(
        boot.db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ? AND idle_due_at IS NOT NULL`,
          TENANT,
        )?.n,
      ).toBe(1)
      expect(
        boot.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ai_autodraft_jobs WHERE tenant_id = ?`, TENANT)
          ?.n,
      ).toBe(1)
    } finally {
      boot.close()
    }
  })
})
