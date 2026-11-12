import { describe, expect, it } from 'vitest'
import { systemClock } from '../../db/clock'
import { bootClinicDb } from '../test-db'
import { workerCaller } from '../envelopes'
import { ingestContactMessage } from '../operations'
import { newId } from '../ids'
import { listContactsDirectory } from './conversations'

/** DEC-165: o directório Clientes diz o próximo horário e a última visita (só confirmados). */
describe('directório Clientes — próximo horário e última visita', () => {
  it('escolhe o próximo confirmado, a última visita já acabada e ignora cancelados', () => {
    const { db, close } = bootClinicDb()
    try {
      const tenantId = 'clinic-demo-directory-a'
      const caller = workerCaller(tenantId, 'user_synth_owner_a')
      const now = systemClock.nowMs()
      const contactId = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:evt:dir-1',
          waId: '5511999990011',
          displayName: 'Bia Fictícia',
          body: 'Oi',
        },
        systemClock,
      ).contact!.id
      const otherId = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:evt:dir-2',
          waId: '5511999990012',
          displayName: 'Cris Fictícia',
          body: 'Oi',
        },
        systemClock,
      ).contact!.id

      db.run(
        `INSERT INTO services (id, tenant_id, name, duration_minutes, created_at, updated_at)
         VALUES ('svc-a', ?, 'Limpeza de pele', 60, ?, ?)`,
        tenantId,
        now,
        now,
      )
      const appt = (startsAt: number, status: 'confirmed' | 'cancelled', who = contactId) =>
        db.run(
          `INSERT INTO appointments (
            id, tenant_id, service_id, professional_id, room_resource_id,
            starts_at, ends_at, status, contact_label, created_at, contact_id
          ) VALUES (?, ?, 'svc-a', 'pro-x', NULL, ?, ?, ?, 'Fictícia', ?, ?)`,
          newId('apt'),
          tenantId,
          startsAt,
          startsAt + 3_600_000,
          status,
          now,
          who,
        )
      const H = 3_600_000
      appt(now - 72 * H, 'confirmed')
      appt(now - 24 * H, 'confirmed')
      appt(now - 2 * H, 'cancelled')
      appt(now + 48 * H, 'confirmed')
      appt(now + 24 * H, 'cancelled')
      appt(now + 96 * H, 'confirmed')

      const { items } = listContactsDirectory(db, tenantId, { nowMs: now })
      const bia = items.find((c) => c.id === contactId)!
      expect(bia.nextVisit).toEqual({ startsAt: now + 48 * H, serviceName: 'Limpeza de pele' })
      expect(bia.lastVisit).toEqual({ startsAt: now - 24 * H, serviceName: 'Limpeza de pele' })
      const cris = items.find((c) => c.id === otherId)!
      expect(cris.nextVisit).toBeNull()
      expect(cris.lastVisit).toBeNull()
    } finally {
      close()
    }
  })
})
