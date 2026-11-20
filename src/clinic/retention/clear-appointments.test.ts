/**
 * Limpar agenda (staging): desliga vínculo e realinha etapa (DEC-092 / DEC-040).
 */
import { describe, expect, it } from 'vitest'
import { workerCaller } from '../envelopes'
import { bootClinicDb } from '../test-db'
import { seedSyntheticPipelineOp } from '../pipeline/seed'
import { getOpportunity, listStageHistory } from '../pipeline/opportunities'
import { clearClinicAppointments } from './clear-appointments'

describe('clearClinicAppointments — pipeline', () => {
  it('Agendado com vínculo volta a Em atendimento; Agendado manual (DEC-040) fica', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const tenantId = 'clinic-demo-a'
      const caller = workerCaller(tenantId, 'user_synth_owner_a')
      const seeded = seedSyntheticPipelineOp(db, caller, clock)
      expect(seeded.seeded).toBe(true)

      const carlaBefore = getOpportunity(db, tenantId, 'opp_seed_carla')
      expect(carlaBefore?.stage).toBe('agendado')
      expect(carlaBefore?.linkedAppointmentId).toBe('apt_seed_carla')

      const beatrizBefore = getOpportunity(db, tenantId, 'opp_seed_beatriz')
      expect(beatrizBefore?.stage).toBe('agendado')
      expect(beatrizBefore?.linkedAppointmentId).toBeNull()

      const result = clearClinicAppointments(db, caller, clock)
      expect(result.deletedCounts.appointments).toBeGreaterThanOrEqual(1)
      expect(
        Number(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)?.n ?? 0),
      ).toBe(0)

      const carla = getOpportunity(db, tenantId, 'opp_seed_carla')
      expect(carla?.linkedAppointmentId).toBeNull()
      expect(carla?.stage).toBe('em_atendimento')
      const carlaHist = listStageHistory(db, tenantId, 'opp_seed_carla')
      expect(carlaHist.some((h) => h.fromStage === 'agendado' && h.toStage === 'em_atendimento')).toBe(
        true,
      )

      const beatriz = getOpportunity(db, tenantId, 'opp_seed_beatriz')
      expect(beatriz?.stage).toBe('agendado')
      expect(beatriz?.linkedAppointmentId).toBeNull()

      const linkedLeft = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM opportunities
         WHERE tenant_id = ? AND linked_appointment_id IS NOT NULL`,
        tenantId,
      )
      expect(Number(linkedLeft?.n ?? 0)).toBe(0)
    } finally {
      close()
    }
  })
})
