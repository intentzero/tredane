import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { bootClinicDb } from '../test-db'
import { workerCaller } from '../envelopes'
import { setAppointmentAttendanceOp } from './attendance'
import { ConflictError } from '../errors'

describe('marcar chegada (DEC-205)', () => {
  it('grava chegou e não veio; limpa; recusa outra coluna', () => {
    const clock = createControllableClock(1_700_000_000_000)
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      // Usa um compromisso já confirmado pelo seed sintético se existir; senão cria mínimo.
      const existing = db.get<{ id: string; professional_id: string; status: string }>(
        `SELECT id, professional_id, status FROM appointments
         WHERE tenant_id = 'clinic-demo-a' AND status = 'confirmed' LIMIT 1`,
      )
      let appointmentId: string
      let professionalId: string
      if (existing) {
        appointmentId = existing.id
        professionalId = existing.professional_id
      } else {
        // Sem seed de agenda: o teste exige um compromisso — cria via SQL mínimo.
        appointmentId = 'apt_att_1'
        professionalId = 'prof-1'
        db.run(
          `INSERT INTO appointments (
             id, tenant_id, service_id, professional_id, room_resource_id,
             starts_at, ends_at, status, contact_label, created_at, version
           ) VALUES (?, 'clinic-demo-a', 'facial', ?, NULL, ?, ?, 'confirmed', 'Ana', ?, 1)`,
          appointmentId,
          professionalId,
          clock.nowMs() + 3_600_000,
          clock.nowMs() + 7_200_000,
          clock.nowMs(),
        )
      }

      const arrived = setAppointmentAttendanceOp(
        db,
        caller,
        { appointmentId, attendance: 'arrived' },
        clock,
      )
      expect(arrived.attendance).toBe('arrived')
      expect(
        db.get<{ attendance: string }>(
          `SELECT attendance FROM appointments WHERE id = ?`,
          appointmentId,
        )?.attendance,
      ).toBe('arrived')

      const noShow = setAppointmentAttendanceOp(
        db,
        caller,
        { appointmentId, attendance: 'no_show' },
        clock,
      )
      expect(noShow.attendance).toBe('no_show')
      expect(noShow.version).toBeGreaterThan(arrived.version)

      const cleared = setAppointmentAttendanceOp(
        db,
        caller,
        { appointmentId, attendance: null },
        clock,
      )
      expect(cleared.attendance).toBeNull()

      expect(() =>
        setAppointmentAttendanceOp(
          db,
          caller,
          {
            appointmentId,
            attendance: 'arrived',
            restrictToProfessionalId: 'outra-pro',
          },
          clock,
        ),
      ).toThrow(ConflictError)

      setAppointmentAttendanceOp(
        db,
        caller,
        {
          appointmentId,
          attendance: 'arrived',
          restrictToProfessionalId: professionalId,
        },
        clock,
      )
    } finally {
      close()
    }
  })
})
