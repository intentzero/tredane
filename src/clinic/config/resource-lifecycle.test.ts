import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ConflictError, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { confirmAppointmentOp, zonedCivilToUtc } from '../scheduling'
import {
  deactivateResourceOp,
  deleteResourceOp,
  getConfigSnapshotOp,
  listResourceFutureAppointmentsOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from './index'

const TZ = 'America/Sao_Paulo'

function seed() {
  const clock = createControllableClock(Date.UTC(2024, 0, 1))
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
  const mk = (name: string) =>
    upsertResourceOp(db, caller, { kind: 'professional', name }, clock)
  const paula = mk('Dra. Paula Reis')
  const bia = mk('Bia Souza')
  const carla = mk('Carla (sem serviço)')
  const room = upsertResourceOp(
    db,
    caller,
    { kind: 'room', name: 'Sala 2', category: 'Sala com laser' },
    clock,
  )
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Limpeza de pele',
      durationMinutes: 60,
      bufferMinutes: 0,
      professionalIds: [paula.id, bia.id],
      roomRequirement: { mode: 'category', category: 'Sala com laser' },
    },
    clock,
  )
  for (const r of [paula, bia, carla, room]) {
    setWeeklyWindowsOp(
      db,
      caller,
      { resourceId: r.id, windows: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1080 }] },
      clock,
    )
  }
  const book = (proId: string, hour: number, req: string) =>
    confirmAppointmentOp(
      db,
      caller,
      {
        clientRequestId: req,
        serviceId: svc.id,
        professionalId: proId,
        roomResourceId: room.id,
        startsAt: zonedCivilToUtc(TZ, 2024, 1, 8, hour, 0),
        contactLabel: 'Paciente Fictícia',
        actorClerkUserId: 'user_synth_owner_a',
      },
      clock,
    ).value
  return { ...boot, clock, caller, paula, bia, carla, room, svc, book }
}

describe('ciclo de vida de recursos', () => {
  it('lista compromissos futuros com sugestão livre e compatível', () => {
    const s = seed()
    try {
      s.book(s.paula.id, 10, 'r1')
      const out = listResourceFutureAppointmentsOp(s.db, s.caller, s.paula.id, s.clock)
      expect(out.appointments).toHaveLength(1)
      // Carla não atende o serviço; Bia está livre.
      expect(out.appointments[0]!.candidates.map((c) => c.id)).toEqual([s.bia.id])
      expect(out.appointments[0]!.suggestedResourceId).toBe(s.bia.id)
    } finally {
      s.close()
    }
  })

  it('desativa remanejando um e mantendo outro, com auditoria e sem cancelar', () => {
    const s = seed()
    try {
      const a1 = s.book(s.paula.id, 10, 'r1')
      const a2 = s.book(s.paula.id, 12, 'r2')
      const res = deactivateResourceOp(
        s.db,
        s.caller,
        { resourceId: s.paula.id, reassignments: [{ appointmentId: a1.id, targetResourceId: s.bia.id }] },
        s.clock,
      )
      expect(res.active).toBe(false)
      expect(res.reassigned).toHaveLength(1)
      expect(res.keptAppointmentIds).toEqual([a2.id])
      const rows = s.db.all<{ id: string; professional_id: string; status: string }>(
        `SELECT id, professional_id, status FROM appointments ORDER BY starts_at`,
      )
      expect(rows.map((r) => r.status)).toEqual(['confirmed', 'confirmed'])
      expect(rows[0]!.professional_id).toBe(s.bia.id)
      expect(rows[1]!.professional_id).toBe(s.paula.id)
      const alloc = s.db.get<{ resource_id: string }>(
        `SELECT resource_id FROM appointment_allocations WHERE appointment_id = ? AND resource_kind = 'professional'`,
        a1.id,
      )
      expect(alloc?.resource_id).toBe(s.bia.id)
      const audit = s.db.all<{ action: string }>(
        `SELECT action FROM operational_audit WHERE action IN ('appointment.resource_reassigned','config.resource_deactivated')`,
      )
      expect(audit.map((a) => a.action).sort()).toEqual([
        'appointment.resource_reassigned',
        'config.resource_deactivated',
      ])
      // Sem notificação ao paciente: nenhum outbox novo de reagendamento.
      const outbox = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM outbox_events WHERE type = 'appointment.rescheduled'`,
      )
      expect(outbox?.n ?? 0).toBe(0)
    } finally {
      s.close()
    }
  })

  it('recusa remanejar para recurso ocupado e não altera nada', () => {
    const s = seed()
    try {
      const a1 = s.book(s.paula.id, 10, 'r1')
      // Carla não está vinculada ao serviço: o servidor recusa.
      expect(() =>
        deactivateResourceOp(
          s.db,
          s.caller,
          { resourceId: s.paula.id, reassignments: [{ appointmentId: a1.id, targetResourceId: s.carla.id }] },
          s.clock,
        ),
      ).toThrow(ConflictError)
      const snap = getConfigSnapshotOp(s.db, s.caller, s.clock)
      expect(snap.resources.find((r) => r.id === s.paula.id)?.active).toBe(true)
      const apt = s.db.get<{ professional_id: string }>(
        `SELECT professional_id FROM appointments WHERE id = ?`,
        a1.id,
      )
      expect(apt?.professional_id).toBe(s.paula.id)
    } finally {
      s.close()
    }
  })

  it('exclui só recurso sem histórico; com histórico devolve erro claro', () => {
    const s = seed()
    try {
      s.book(s.paula.id, 10, 'r1')
      expect(() => deleteResourceOp(s.db, s.caller, s.paula.id, s.clock)).toThrow(
        /já teve compromissos/,
      )
      const snap = getConfigSnapshotOp(s.db, s.caller, s.clock)
      expect(snap.resources.find((r) => r.id === s.paula.id)?.hasAppointmentHistory).toBe(true)
      expect(snap.resources.find((r) => r.id === s.carla.id)?.hasAppointmentHistory).toBe(false)
      deleteResourceOp(s.db, s.caller, s.carla.id, s.clock)
      const after = getConfigSnapshotOp(s.db, s.caller, s.clock)
      expect(after.resources.some((r) => r.id === s.carla.id)).toBe(false)
    } finally {
      s.close()
    }
  })
})
