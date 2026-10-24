import type { Clock } from '../../db/clock'
import { assertValidSignalConfig } from '../../pix/money'
import { NotFoundError, ValidationError } from '../errors'
import { newId } from '../ids'
import type { ClinicDb } from '../store'
import type {
  RoomRequirement,
  ServiceRow,
  ServiceSignalKind,
  UpsertServiceInput,
} from './types'
import {
  assertBufferMinutes,
  assertNonEmptyName,
  assertPositiveDuration,
  normalizeRoomRequirement,
} from './validation'

type ServiceSql = {
  id: string
  tenant_id: string
  name: string
  duration_minutes: number
  buffer_minutes: number
  price_cents: number | null
  client_explanation: string | null
  active: number
  requires_signal?: number
  signal_kind?: string | null
  signal_fixed_cents?: number | null
  signal_percent?: number | null
  created_at: number
  updated_at: number
}

function mapRoomRequirement(
  mode: string | undefined,
  category: string | null | undefined,
  resourceId: string | null | undefined,
): RoomRequirement {
  if (mode === 'category' && category) return { mode: 'category', category }
  if (mode === 'resource' && resourceId) {
    return { mode: 'resource', resourceId }
  }
  return { mode: 'none' }
}

function loadProfessionals(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
): string[] {
  return db
    .all<{ professional_id: string }>(
      `SELECT professional_id FROM service_professionals
       WHERE tenant_id = ? AND service_id = ?
       ORDER BY professional_id`,
      tenantId,
      serviceId,
    )
    .map((r) => r.professional_id)
}

function loadRoomRequirement(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
): RoomRequirement {
  const row = db.get<{
    mode: string
    category: string | null
    resource_id: string | null
  }>(
    `SELECT mode, category, resource_id FROM service_room_requirements
     WHERE tenant_id = ? AND service_id = ?`,
    tenantId,
    serviceId,
  )
  if (!row) return { mode: 'none' }
  return mapRoomRequirement(row.mode, row.category, row.resource_id)
}

function toServiceRow(
  db: ClinicDb,
  row: ServiceSql,
): ServiceRow {
  const requiresSignal = (row.requires_signal ?? 0) === 1
  const signalKind =
    row.signal_kind === 'fixed' || row.signal_kind === 'percent'
      ? (row.signal_kind as ServiceSignalKind)
      : null
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    durationMinutes: row.duration_minutes,
    bufferMinutes: row.buffer_minutes,
    priceCents: row.price_cents,
    clientExplanation: row.client_explanation,
    active: row.active === 1,
    requiresSignal,
    signalKind: requiresSignal ? signalKind : null,
    signalFixedCents: requiresSignal ? (row.signal_fixed_cents ?? null) : null,
    signalPercent: requiresSignal ? (row.signal_percent ?? null) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    professionalIds: loadProfessionals(db, row.tenant_id, row.id),
    roomRequirement: loadRoomRequirement(db, row.tenant_id, row.id),
  }
}

function normalizeSignalFields(
  input: UpsertServiceInput,
  priceCents: number | null,
): {
  requiresSignal: number
  signalKind: string | null
  signalFixedCents: number | null
  signalPercent: number | null
} {
  const requiresSignal = input.requiresSignal === true
  if (!requiresSignal) {
    return {
      requiresSignal: 0,
      signalKind: null,
      signalFixedCents: null,
      signalPercent: null,
    }
  }
  const kind = input.signalKind ?? null
  const fixed =
    kind === 'fixed' && input.signalFixedCents != null
      ? Math.trunc(input.signalFixedCents)
      : null
  const percent =
    kind === 'percent' && input.signalPercent != null
      ? Math.trunc(input.signalPercent)
      : null
  const err = assertValidSignalConfig(
    {
      requiresSignal: true,
      kind,
      fixedCents: fixed,
      percent,
    },
    priceCents,
  )
  if (err) {
    throw new ValidationError(err, `configuração de sinal inválida: ${err}`, {
      signalKind: kind,
      signalFixedCents: fixed,
      signalPercent: percent,
      priceCents,
    })
  }
  return {
    requiresSignal: 1,
    signalKind: kind,
    signalFixedCents: kind === 'fixed' ? fixed : null,
    signalPercent: kind === 'percent' ? percent : null,
  }
}

export function listServices(db: ClinicDb, tenantId: string): ServiceRow[] {
  const rows = db.all<ServiceSql>(
    `SELECT * FROM services WHERE tenant_id = ? ORDER BY name COLLATE NOCASE, id`,
    tenantId,
  )
  return rows.map((r) => toServiceRow(db, r))
}

export function getService(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
): ServiceRow | null {
  const row = db.get<ServiceSql>(
    `SELECT * FROM services WHERE tenant_id = ? AND id = ?`,
    tenantId,
    serviceId,
  )
  return row ? toServiceRow(db, row) : null
}

function assertProfessionalsBelong(
  db: ClinicDb,
  tenantId: string,
  professionalIds: string[],
): void {
  const unique = [...new Set(professionalIds)]
  for (const id of unique) {
    const row = db.get<{ kind: string; active: number }>(
      `SELECT kind, active FROM resources WHERE tenant_id = ? AND id = ?`,
      tenantId,
      id,
    )
    if (!row || row.kind !== 'professional') {
      throw new ValidationError(
        'invalid_professional_ref',
        `profissional inexistente neste tenant: ${id}`,
        { professionalId: id },
      )
    }
  }
}

function assertRoomRequirementRefs(
  db: ClinicDb,
  tenantId: string,
  req: RoomRequirement,
): void {
  if (req.mode === 'resource') {
    const row = db.get<{ kind: string }>(
      `SELECT kind FROM resources WHERE tenant_id = ? AND id = ?`,
      tenantId,
      req.resourceId,
    )
    if (!row || (row.kind !== 'room' && row.kind !== 'equipment')) {
      throw new ValidationError(
        'invalid_room_ref',
        `sala/equipamento inexistente neste tenant: ${req.resourceId}`,
        { resourceId: req.resourceId },
      )
    }
  }
}

function writeProfessionals(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
  professionalIds: string[],
): void {
  db.run(
    `DELETE FROM service_professionals WHERE tenant_id = ? AND service_id = ?`,
    tenantId,
    serviceId,
  )
  for (const pid of new Set(professionalIds)) {
    db.run(
      `INSERT INTO service_professionals (tenant_id, service_id, professional_id)
       VALUES (?, ?, ?)`,
      tenantId,
      serviceId,
      pid,
    )
  }
}

function writeRoomRequirement(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
  req: RoomRequirement,
): void {
  db.run(
    `DELETE FROM service_room_requirements WHERE tenant_id = ? AND service_id = ?`,
    tenantId,
    serviceId,
  )
  db.run(
    `INSERT INTO service_room_requirements
      (tenant_id, service_id, mode, category, resource_id)
     VALUES (?, ?, ?, ?, ?)`,
    tenantId,
    serviceId,
    req.mode,
    req.mode === 'category' ? req.category : null,
    req.mode === 'resource' ? req.resourceId : null,
  )
}

export function upsertService(
  db: ClinicDb,
  tenantId: string,
  input: UpsertServiceInput,
  clock: Clock,
): ServiceRow {
  const name = assertNonEmptyName(input.name)
  assertPositiveDuration(input.durationMinutes)
  assertBufferMinutes(input.bufferMinutes)
  const roomRequirement = normalizeRoomRequirement(input.roomRequirement)
  assertProfessionalsBelong(db, tenantId, input.professionalIds)
  assertRoomRequirementRefs(db, tenantId, roomRequirement)

  const priceCents =
    input.priceCents === undefined || input.priceCents === null
      ? null
      : Math.trunc(input.priceCents)
  if (priceCents !== null && (priceCents < 0 || !Number.isFinite(priceCents))) {
    throw new ValidationError('invalid_price', 'preço inválido', { priceCents })
  }

  const explanation =
    input.clientExplanation === undefined || input.clientExplanation === null
      ? null
      : input.clientExplanation.trim() || null

  const now = clock.nowMs()
  const active = input.active === false ? 0 : 1
  const signal = normalizeSignalFields(input, priceCents)

  if (input.id) {
    const existing = getService(db, tenantId, input.id)
    if (!existing) {
      throw new NotFoundError('service_not_found', `serviço ${input.id} não encontrado`)
    }
    db.run(
      `UPDATE services SET
        name = ?, duration_minutes = ?, buffer_minutes = ?,
        price_cents = ?, client_explanation = ?, active = ?,
        requires_signal = ?, signal_kind = ?, signal_fixed_cents = ?, signal_percent = ?,
        updated_at = ?
       WHERE tenant_id = ? AND id = ?`,
      name,
      input.durationMinutes,
      input.bufferMinutes,
      priceCents,
      explanation,
      active,
      signal.requiresSignal,
      signal.signalKind,
      signal.signalFixedCents,
      signal.signalPercent,
      now,
      tenantId,
      input.id,
    )
    writeProfessionals(db, tenantId, input.id, input.professionalIds)
    writeRoomRequirement(db, tenantId, input.id, roomRequirement)
    return getService(db, tenantId, input.id)!
  }

  const id = newId('svc')
  db.run(
    `INSERT INTO services (
      id, tenant_id, name, duration_minutes, buffer_minutes,
      price_cents, client_explanation, active,
      requires_signal, signal_kind, signal_fixed_cents, signal_percent,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    tenantId,
    name,
    input.durationMinutes,
    input.bufferMinutes,
    priceCents,
    explanation,
    active,
    signal.requiresSignal,
    signal.signalKind,
    signal.signalFixedCents,
    signal.signalPercent,
    now,
    now,
  )
  writeProfessionals(db, tenantId, id, input.professionalIds)
  writeRoomRequirement(db, tenantId, id, roomRequirement)
  return getService(db, tenantId, id)!
}

export function setServiceActive(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
  active: boolean,
  clock: Clock,
): ServiceRow {
  const existing = getService(db, tenantId, serviceId)
  if (!existing) {
    throw new NotFoundError('service_not_found', `serviço ${serviceId} não encontrado`)
  }
  db.run(
    `UPDATE services SET active = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`,
    active ? 1 : 0,
    clock.nowMs(),
    tenantId,
    serviceId,
  )
  return getService(db, tenantId, serviceId)!
}

/**
 * Recursos activos usáveis em novos agendamentos (DEC-042 / AC-38).
 * Inactivos ou de outro tenant são recusados.
 */
export function assertResourcesUsableForBooking(
  db: ClinicDb,
  tenantId: string,
  opts: {
    professionalId: string
    roomResourceId?: string | null
    serviceId: string
  },
): void {
  const service = getService(db, tenantId, opts.serviceId)
  if (!service || !service.active) {
    throw new ValidationError(
      'service_inactive_or_missing',
      'serviço inactivo ou inexistente para novos agendamentos',
      { serviceId: opts.serviceId },
    )
  }

  const pro = db.get<{ kind: string; active: number }>(
    `SELECT kind, active FROM resources WHERE tenant_id = ? AND id = ?`,
    tenantId,
    opts.professionalId,
  )
  if (!pro || pro.kind !== 'professional' || pro.active !== 1) {
    throw new ValidationError(
      'professional_unusable',
      'profissional inactivo ou de outro tenant',
      { professionalId: opts.professionalId },
    )
  }
  if (
    service.professionalIds.length > 0
    && !service.professionalIds.includes(opts.professionalId)
  ) {
    throw new ValidationError(
      'professional_not_linked',
      'profissional não habilitado para este serviço',
      { professionalId: opts.professionalId, serviceId: opts.serviceId },
    )
  }

  if (opts.roomResourceId) {
    const room = db.get<{ kind: string; active: number; category: string | null }>(
      `SELECT kind, active, category FROM resources WHERE tenant_id = ? AND id = ?`,
      tenantId,
      opts.roomResourceId,
    )
    if (
      !room
      || (room.kind !== 'room' && room.kind !== 'equipment')
      || room.active !== 1
    ) {
      throw new ValidationError(
        'room_unusable',
        'sala/equipamento inactivo ou de outro tenant',
        { roomResourceId: opts.roomResourceId },
      )
    }
    const req = service.roomRequirement
    if (req.mode === 'resource' && req.resourceId !== opts.roomResourceId) {
      throw new ValidationError(
        'room_requirement_mismatch',
        'recurso não corresponde ao exigido pelo serviço',
      )
    }
    if (req.mode === 'category' && room.category !== req.category) {
      throw new ValidationError(
        'room_category_mismatch',
        'categoria do recurso não corresponde à exigida',
        { required: req.category, actual: room.category },
      )
    }
  } else if (service.roomRequirement.mode !== 'none') {
    throw new ValidationError(
      'room_required',
      'serviço exige sala/equipamento para novos agendamentos',
    )
  }
}
