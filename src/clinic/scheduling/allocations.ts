import { newId } from '../ids'
import type { ClinicDb } from '../store'
import type { ResourceKind } from '../constants'

export type AllocationRow = {
  id: string
  tenantId: string
  appointmentId: string
  resourceKind: ResourceKind
  resourceId: string
  occupiedFrom: number
  occupiedUntil: number
}

type AllocSql = {
  id: string
  tenant_id: string
  appointment_id: string
  resource_kind: string
  resource_id: string
  occupied_from: number
  occupied_until: number
}

function toAllocation(row: AllocSql): AllocationRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    appointmentId: row.appointment_id,
    resourceKind: row.resource_kind as ResourceKind,
    resourceId: row.resource_id,
    occupiedFrom: row.occupied_from,
    occupiedUntil: row.occupied_until,
  }
}

export function deleteAllocationsForAppointment(
  db: ClinicDb,
  tenantId: string,
  appointmentId: string,
): void {
  db.run(
    `DELETE FROM appointment_allocations WHERE tenant_id = ? AND appointment_id = ?`,
    tenantId,
    appointmentId,
  )
}

export function insertAllocations(
  db: ClinicDb,
  input: {
    tenantId: string
    appointmentId: string
    professionalId: string
    roomResourceId: string | null
    roomKind?: 'room' | 'equipment' | null
    occupiedFrom: number
    occupiedUntil: number
  },
): AllocationRow[] {
  const rows: AllocationRow[] = []
  const proId = newId('alloc')
  db.run(
    `INSERT INTO appointment_allocations (
      id, tenant_id, appointment_id, resource_kind, resource_id,
      occupied_from, occupied_until
    ) VALUES (?, ?, ?, 'professional', ?, ?, ?)`,
    proId,
    input.tenantId,
    input.appointmentId,
    input.professionalId,
    input.occupiedFrom,
    input.occupiedUntil,
  )
  rows.push(
    toAllocation({
      id: proId,
      tenant_id: input.tenantId,
      appointment_id: input.appointmentId,
      resource_kind: 'professional',
      resource_id: input.professionalId,
      occupied_from: input.occupiedFrom,
      occupied_until: input.occupiedUntil,
    }),
  )

  if (input.roomResourceId) {
    const kind = input.roomKind ?? 'room'
    const roomId = newId('alloc')
    db.run(
      `INSERT INTO appointment_allocations (
        id, tenant_id, appointment_id, resource_kind, resource_id,
        occupied_from, occupied_until
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      roomId,
      input.tenantId,
      input.appointmentId,
      kind,
      input.roomResourceId,
      input.occupiedFrom,
      input.occupiedUntil,
    )
    rows.push(
      toAllocation({
        id: roomId,
        tenant_id: input.tenantId,
        appointment_id: input.appointmentId,
        resource_kind: kind,
        resource_id: input.roomResourceId,
        occupied_from: input.occupiedFrom,
        occupied_until: input.occupiedUntil,
      }),
    )
  }
  return rows
}

export function listAllocationsForAppointment(
  db: ClinicDb,
  tenantId: string,
  appointmentId: string,
): AllocationRow[] {
  return db
    .all<AllocSql>(
      `SELECT * FROM appointment_allocations
       WHERE tenant_id = ? AND appointment_id = ?
       ORDER BY resource_kind, resource_id`,
      tenantId,
      appointmentId,
    )
    .map(toAllocation)
}
