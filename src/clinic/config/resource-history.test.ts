import { describe, expect, it } from 'vitest'
import { bootClinicDb } from '../test-db'

/** Cada consulta de histórico precisa de índice: sem ele a Clínica varre a tabela por recurso. */
describe('índices do aviso «tem histórico» (#226)', () => {
  const cases: Array<[string, string]> = [
    ['appointments', 'professional_id'],
    ['appointments', 'room_resource_id'],
    ['appointment_allocations', 'resource_id'],
    ['scheduling_intents', 'professional_id'],
    ['scheduling_intents', 'room_resource_id'],
    ['pix_charges', 'professional_id'],
    ['pix_charges', 'room_resource_id'],
    ['schedule_holds', 'professional_id'],
  ]
  it.each(cases)('%s.%s usa índice', (table, column) => {
    const { db } = bootClinicDb({})
    const plan = db
      .all<{ detail: string }>(
        `EXPLAIN QUERY PLAN SELECT 1 FROM ${table} WHERE tenant_id = ? AND ${column} = ? LIMIT 1`,
        't',
        'r',
      )
      .map((r) => r.detail)
      .join(' ')
    expect(plan).toMatch(/USING (COVERING )?INDEX/)
    expect(plan).not.toMatch(/SCAN/)
  })
})
