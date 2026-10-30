/**
 * DEC-082 — a lista de salas do serviço substitui none/any/category/resource.
 */
import { describe, expect, it } from 'vitest'
import { CLINIC_MIGRATIONS } from '../migrations'
import { fromNodeSqlite } from '../store'
import { openClinicMemoryDb } from '../test-db'

describe('migração 0042', () => {
  it('passa sem sala a sem espaço, e any/categoria à lista das salas ativas', () => {
    const raw = openClinicMemoryDb()
    const db = fromNodeSqlite(raw)
    try {
      for (const m of CLINIC_MIGRATIONS.filter((x) => x.id < 42)) {
        for (const st of m.statements) db.exec(st)
      }
      const resource = (id: string, kind: string, name: string, category: string | null, active: number) => {
        db.run(
          `INSERT INTO resources (id, tenant_id, kind, name, category, active, created_at, updated_at)
           VALUES (?, 't', ?, ?, ?, ?, 0, 0)`,
          id,
          kind,
          name,
          category,
          active,
        )
      }
      resource('dep', 'room', 'Depilação', null, 1)
      resource('mas', 'room', 'Massagem', 'Laser', 1)
      resource('off', 'room', 'Fechada', 'Laser', 0)
      resource('eq', 'equipment', 'Laser', null, 1)
      for (const id of ['s-none', 's-any', 's-cat', 's-room', 's-off', 's-eq', 's-empty']) {
        db.run(
          `INSERT INTO services (id, tenant_id, name, duration_minutes, created_at, updated_at)
           VALUES (?, 't', ?, 30, 0, 0)`,
          id,
          id,
        )
      }
      const req = (serviceId: string, mode: string, category: string | null, resourceId: string | null) => {
        db.run(
          `INSERT INTO service_room_requirements (tenant_id, service_id, mode, category, resource_id)
           VALUES ('t', ?, ?, ?, ?)`,
          serviceId,
          mode,
          category,
          resourceId,
        )
      }
      req('s-none', 'none', null, null)
      req('s-any', 'any', null, null)
      req('s-cat', 'category', 'Laser', null)
      req('s-room', 'resource', null, 'dep')
      req('s-off', 'resource', null, 'off')
      req('s-eq', 'resource', null, 'eq')

      const m42 = CLINIC_MIGRATIONS.find((x) => x.id === 42)!
      expect(m42.name).toBe('0042_service_room_list')
      for (const st of m42.statements) db.exec(st)

      const rows = db.all<{ service_id: string; mode: string; resource_id: string }>(
        `SELECT service_id, mode, resource_id FROM service_room_requirements
         ORDER BY service_id, mode, resource_id`,
      )
      expect(rows).toEqual([
        { service_id: 's-any', mode: 'room', resource_id: 'dep' },
        { service_id: 's-any', mode: 'room', resource_id: 'mas' },
        { service_id: 's-any', mode: 'rooms', resource_id: '' },
        { service_id: 's-cat', mode: 'room', resource_id: 'mas' },
        { service_id: 's-cat', mode: 'rooms', resource_id: '' },
        { service_id: 's-empty', mode: 'none', resource_id: '' },
        { service_id: 's-eq', mode: 'equipment', resource_id: 'eq' },
        { service_id: 's-eq', mode: 'none', resource_id: '' },
        { service_id: 's-none', mode: 'none', resource_id: '' },
        { service_id: 's-off', mode: 'room', resource_id: 'off' },
        { service_id: 's-off', mode: 'rooms', resource_id: '' },
        { service_id: 's-room', mode: 'room', resource_id: 'dep' },
        { service_id: 's-room', mode: 'rooms', resource_id: '' },
      ])
    } finally {
      raw.close()
    }
  })
})
