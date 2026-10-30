/**
 * DEC-077 / S1 — migração do bloco Tempo. Não filtra a grade.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { CLINIC_SCHEMA_VERSION } from '../constants'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiProfile } from '../config/settings'
import { queryAvailabilityOp } from '../scheduling'

const MONDAY = '2024-01-08'

function columnNames(
  db: ReturnType<typeof bootClinicDb>['db'],
  table: string,
): string[] {
  return db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name)
}

describe('bloco Tempo (S1)', () => {
  it('deixa Tanto faz, não copia o endereço e a grade não muda', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      expect(CLINIC_SCHEMA_VERSION).toBe(43)
      const state = db.get<{ version: number; status: string }>(
        'SELECT version, status FROM clinic_schema_state WHERE id = 1',
      )
      expect(state).toEqual({ version: 43, status: 'ready' })

      const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1' }, clock)
      const pro = upsertResourceOp(
        db,
        caller,
        { kind: 'professional', name: 'Gi', homeRoomId: room.id },
        clock,
      )
      const windows = [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 }]
      setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows }, clock)

      const make = (name: string) =>
        upsertServiceOp(
          db,
          caller,
          {
            name,
            durationMinutes: 60,
            bufferMinutes: 0,
            professionalIds: [pro.id],
            roomRequirement: { mode: 'none' },
          },
          clock,
        )

      const bronze = make('Bronzeamento')
      const dep = make('Depilação')

      const rows = db.all<{
        id: string
        tempo_ceu: string
        tempo_temperatura: string
        tempo_celsius: number | null
        audiencia: string
      }>(
        `SELECT id, tempo_ceu, tempo_temperatura, tempo_celsius, audiencia
         FROM services WHERE tenant_id = ? ORDER BY name`,
        'clinic-demo-a',
      )
      expect(rows).toEqual([
        {
          id: bronze.id,
          tempo_ceu: 'tanto_faz',
          tempo_temperatura: 'tanto_faz',
          tempo_celsius: null,
          audiencia: 'qualquer',
        },
        {
          id: dep.id,
          tempo_ceu: 'tanto_faz',
          tempo_temperatura: 'tanto_faz',
          tempo_celsius: null,
          audiencia: 'qualquer',
        },
      ])

      setClinicAiProfile(
        db,
        'clinic-demo-a',
        { clinicAddress: 'Rua Fictícia, 10, Campinas' },
        clock,
      )
      const settings = db.get<{
        tempo_local: string
        tempo_cidade: string | null
        tempo_latitude: number | null
        tempo_longitude: number | null
        clinic_address: string
      }>(
        `SELECT tempo_local, tempo_cidade, tempo_latitude, tempo_longitude, clinic_address
         FROM clinic_settings WHERE id = 1`,
      )
      expect(settings).toEqual({
        tempo_local: 'nenhum',
        tempo_cidade: null,
        tempo_latitude: null,
        tempo_longitude: null,
        clinic_address: 'Rua Fictícia, 10, Campinas',
      })

      const contactCols = columnNames(db, 'contacts')
      const appointmentCols = columnNames(db, 'appointments')
      expect(contactCols.some((name) => name.startsWith('tempo_'))).toBe(false)
      expect(appointmentCols.some((name) => name.startsWith('tempo_'))).toBe(false)
      expect(columnNames(db, 'services')).toContain('audiencia')

      const slotsOf = (serviceId: string) =>
        queryAvailabilityOp(
          db,
          caller,
          { serviceId, date: MONDAY },
          clock,
        ).slots.map((slot) => slot.startsAt)

      const before = slotsOf(bronze.id)
      expect(before.length).toBeGreaterThan(0)
      expect(slotsOf(dep.id)).toEqual(before)

      db.run(
        `UPDATE services
           SET tempo_ceu = 'sol', tempo_temperatura = 'acima', tempo_celsius = 24
         WHERE tenant_id = ? AND id = ?`,
        'clinic-demo-a',
        bronze.id,
      )
      expect(slotsOf(bronze.id)).toEqual(before)

      expect(() =>
        db.run(`UPDATE services SET tempo_ceu = 'solzinho' WHERE id = ?`, bronze.id),
      ).toThrow()
    } finally {
      close()
    }
  })
})
