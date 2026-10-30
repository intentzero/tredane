import type { Clock } from '../../db/clock'
import { assertValidSignalConfig } from '../../pix/money'
import {
  isServiceAudience,
  normalizeServiceAudience,
  type ServiceAudience,
} from '../catalog/audience'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import { serviceDeleteBlocker } from './service-history'
import { newId } from '../ids'
import type { ClinicDb } from '../store'
import type {
  RoomRequirement,
  ServiceRow,
  ServiceSignalKind,
  TempoCeu,
  TempoTemperatura,
  UpsertServiceInput,
} from './types'
import { listServiceWeeklyWindows, setServiceWeeklyWindows } from './service-windows'
import { listCombos } from './combos'
import { listZones } from './zones'
import { VARIANT_KIND_MAX } from '../catalog/variant-kind'
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
  audiencia?: string | null
  tempo_ceu?: string | null
  tempo_temperatura?: string | null
  tempo_celsius?: number | null
  price_cents: number | null
  client_explanation: string | null
  active: number
  requires_signal?: number
  signal_kind?: string | null
  signal_fixed_cents?: number | null
  signal_percent?: number | null
  duration_adjustable?: number
  duration_min_minutes?: number | null
  duration_max_minutes?: number | null
  variant_kind?: string | null
  variant_kind_plural?: string | null
  created_at: number
  updated_at: number
}

function loadSpace(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
): { roomRequirement: RoomRequirement; equipmentResourceId: string | null } {
  const rows = db.all<{ mode: string; resource_id: string }>(
    `SELECT mode, resource_id FROM service_room_requirements
     WHERE tenant_id = ? AND service_id = ?`,
    tenantId,
    serviceId,
  )
  const equipment =
    rows.find((r) => r.mode === 'equipment' && r.resource_id)?.resource_id ?? null
  if (rows.some((r) => r.mode === 'none')) {
    return { roomRequirement: { mode: 'none' }, equipmentResourceId: equipment }
  }
  const resourceIds = rows
    .filter((r) => r.mode === 'room' && r.resource_id)
    .map((r) => r.resource_id)
  if (rows.some((r) => r.mode === 'rooms') || resourceIds.length > 0) {
    return { roomRequirement: { mode: 'rooms', resourceIds }, equipmentResourceId: equipment }
  }
  return { roomRequirement: { mode: 'none' }, equipmentResourceId: equipment }
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
    audiencia: normalizeServiceAudience(row.audiencia),
    tempoCeu: row.tempo_ceu === 'sol' || row.tempo_ceu === 'chuva' ? row.tempo_ceu : 'tanto_faz',
    tempoTemperatura:
      row.tempo_temperatura === 'acima' || row.tempo_temperatura === 'abaixo'
        ? row.tempo_temperatura
        : 'tanto_faz',
    tempoCelsius:
      row.tempo_temperatura === 'acima' || row.tempo_temperatura === 'abaixo'
        ? (row.tempo_celsius ?? null)
        : null,
    priceCents: row.price_cents,
    clientExplanation: row.client_explanation,
    active: row.active === 1,
    requiresSignal,
    signalKind: requiresSignal ? signalKind : null,
    signalFixedCents: requiresSignal ? (row.signal_fixed_cents ?? null) : null,
    signalPercent: requiresSignal ? (row.signal_percent ?? null) : null,
    // DEC-076: o cadastro já não oferece duração ajustável. Colunas antigas são ignoradas.
    durationAdjustable: false,
    durationMinMinutes: null,
    durationMaxMinutes: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    professionalIds: loadProfessionals(db, row.tenant_id, row.id),
    ...loadSpace(db, row.tenant_id, row.id),
    weeklyWindows: loadServiceWeeklyWindows(db, row.tenant_id, row.id),
    deletable: serviceDeleteBlocker(db, row.tenant_id, row.id) === null,
    variantKind: row.variant_kind?.trim() || null,
    variantKindPlural: row.variant_kind_plural?.trim() || null,
    zones: listZones(db, row.tenant_id, row.id),
    combos: listCombos(db, row.tenant_id, row.id),
  }
}

function loadServiceWeeklyWindows(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
): Array<{ dayOfWeek: number; startMinute: number; endMinute: number }> {
  return listServiceWeeklyWindows(db, tenantId, serviceId).map((w) => ({
    dayOfWeek: w.dayOfWeek,
    startMinute: w.startMinute,
    endMinute: w.endMinute,
  }))
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
  // Com variantes o preço da linha fica vazio; o valor do sinal sai da visita.
  if (kind === 'percent' && input.variantKind?.trim() && !(priceCents != null && priceCents > 0)) {
    if (percent === null || !Number.isInteger(percent) || percent < 1 || percent > 100) {
      throw new ValidationError('invalid_percent', 'configuração de sinal inválida: invalid_percent', {
        signalKind: kind,
        signalPercent: percent,
      })
    }
    return {
      requiresSignal: 1,
      signalKind: 'percent',
      signalFixedCents: null,
      signalPercent: percent,
    }
  }
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

/** DEC-076: o pedido pode ainda trazer o campo antigo; a gravação limpa-o. */
function normalizeDurationFields(): {
  adjustable: number
  min: number | null
  max: number | null
} {
  return { adjustable: 0, min: null, max: null }
}

/**
 * DEC-076: a marcação nova usa a duração do cadastro.
 * `null` quando o pedido omite ou repete essa duração.
 */
export function assertAppliedDuration(service: ServiceRow, minutes: number | null | undefined): number | null {
  if (minutes == null || minutes === service.durationMinutes) return null
  throw new ValidationError('duration_not_adjustable', 'a duração do procedimento não se ajusta ao agendar', {
    serviceId: service.id,
    durationMinutes: service.durationMinutes,
  })
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

function assertServiceRooms(
  db: ClinicDb,
  tenantId: string,
  req: RoomRequirement,
  already: readonly string[],
): void {
  if (req.mode !== 'rooms') return
  const kept = new Set(already)
  for (const id of req.resourceIds) {
    const row = db.get<{ kind: string; active: number }>(
      `SELECT kind, active FROM resources WHERE tenant_id = ? AND id = ?`,
      tenantId,
      id,
    )
    if (!row || row.kind !== 'room' || (row.active !== 1 && !kept.has(id))) {
      throw new ValidationError(
        'invalid_room_ref',
        'A lista só aceita salas ativas desta clínica.',
        { resourceId: id },
      )
    }
  }
}

function assertEquipment(
  db: ClinicDb,
  tenantId: string,
  equipmentId: string | null,
  already: string | null,
): void {
  if (!equipmentId) return
  const row = db.get<{ kind: string; active: number }>(
    `SELECT kind, active FROM resources WHERE tenant_id = ? AND id = ?`,
    tenantId,
    equipmentId,
  )
  if (!row || row.kind !== 'equipment' || (row.active !== 1 && equipmentId !== already)) {
    throw new ValidationError(
      'invalid_room_ref',
      'O equipamento não está ativo nesta clínica.',
      { resourceId: equipmentId },
    )
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

function writeSpace(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
  req: RoomRequirement,
  equipmentId: string | null,
): void {
  db.run(
    `DELETE FROM service_room_requirements WHERE tenant_id = ? AND service_id = ?`,
    tenantId,
    serviceId,
  )
  if (req.mode === 'none') {
    db.run(
      `INSERT INTO service_room_requirements (tenant_id, service_id, mode, resource_id)
       VALUES (?, ?, 'none', '')`,
      tenantId,
      serviceId,
    )
  } else {
    db.run(
      `INSERT INTO service_room_requirements (tenant_id, service_id, mode, resource_id)
       VALUES (?, ?, 'rooms', '')`,
      tenantId,
      serviceId,
    )
    for (const id of req.resourceIds) {
      db.run(
        `INSERT INTO service_room_requirements (tenant_id, service_id, mode, resource_id)
         VALUES (?, ?, 'room', ?)`,
        tenantId,
        serviceId,
        id,
      )
    }
  }
  if (equipmentId) {
    db.run(
      `INSERT INTO service_room_requirements (tenant_id, service_id, mode, resource_id)
       VALUES (?, ?, 'equipment', ?)`,
      tenantId,
      serviceId,
      equipmentId,
    )
  }
}

function resolveRoomRequirement(
  input: UpsertServiceInput,
  existing: ServiceRow | null,
): RoomRequirement {
  if (input.roomRequirement === undefined) {
    if (existing) return existing.roomRequirement
    throw new ValidationError(
      'invalid_room_requirement',
      'Escolha uma ou mais salas, ou Sem espaço definido.',
    )
  }
  return normalizeRoomRequirement(input.roomRequirement)
}

function resolveEquipment(
  input: UpsertServiceInput,
  existing: ServiceRow | null,
): string | null {
  if (input.equipmentResourceId === undefined) return existing?.equipmentResourceId ?? null
  if (input.equipmentResourceId === null || input.equipmentResourceId === '') return null
  return input.equipmentResourceId.trim()
}

function resolveAudience(
  input: UpsertServiceInput,
  existing: ServiceRow | null,
): ServiceAudience {
  if (input.audiencia === undefined) return existing?.audiencia ?? 'qualquer'
  if (!isServiceAudience(input.audiencia)) {
    throw new ValidationError(
      'invalid_audiencia',
      'Audiência deve ser feminino, masculino ou qualquer',
      { audiencia: input.audiencia },
    )
  }
  return input.audiencia
}

function resolveTempo(
  input: UpsertServiceInput,
  existing: ServiceRow | null,
): { ceu: TempoCeu; temperatura: TempoTemperatura; celsius: number | null } {
  const omitted =
    input.tempoCeu === undefined &&
    input.tempoTemperatura === undefined &&
    input.tempoCelsius === undefined
  if (omitted) {
    return {
      ceu: existing?.tempoCeu ?? 'tanto_faz',
      temperatura: existing?.tempoTemperatura ?? 'tanto_faz',
      celsius: existing?.tempoCelsius ?? null,
    }
  }
  const ceu = input.tempoCeu ?? existing?.tempoCeu ?? 'tanto_faz'
  const temperatura = input.tempoTemperatura ?? existing?.tempoTemperatura ?? 'tanto_faz'
  if (ceu !== 'tanto_faz' && ceu !== 'sol' && ceu !== 'chuva') {
    throw new ValidationError('invalid_tempo', 'Céu deve ser Tanto faz, Sol ou Chuva.', {
      tempoCeu: ceu,
    })
  }
  if (temperatura !== 'tanto_faz' && temperatura !== 'acima' && temperatura !== 'abaixo') {
    throw new ValidationError(
      'invalid_tempo',
      'Temperatura deve ser Tanto faz, Acima de ou Abaixo de.',
      { tempoTemperatura: temperatura },
    )
  }
  if (temperatura === 'tanto_faz') {
    return { ceu, temperatura, celsius: null }
  }
  const raw = input.tempoCelsius === undefined ? existing?.tempoCelsius : input.tempoCelsius
  if (raw == null || typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new ValidationError('invalid_tempo', 'Informe os graus em número inteiro.')
  }
  return { ceu, temperatura, celsius: raw }
}


function resolveKindText(
  value: string | null | undefined,
  existing: string | null | undefined,
): string | null {
  if (value === undefined) return existing ?? null
  if (value === null) return null
  const text = value.trim()
  if (!text) return null
  if (text.length > VARIANT_KIND_MAX) {
    throw new ValidationError(
      'invalid_variant_kind',
      'o singular e o plural do tipo têm no máximo 40 caracteres',
    )
  }
  return text
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
  assertProfessionalsBelong(db, tenantId, input.professionalIds)

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
  const dur = normalizeDurationFields()
  const existing = input.id ? getService(db, tenantId, input.id) : null
  if (input.id && !existing) {
    throw new NotFoundError('service_not_found', `serviço ${input.id} não encontrado`)
  }
  const roomRequirement = resolveRoomRequirement(input, existing)
  const equipmentId = resolveEquipment(input, existing)
  assertServiceRooms(
    db,
    tenantId,
    roomRequirement,
    existing?.roomRequirement.mode === 'rooms' ? existing.roomRequirement.resourceIds : [],
  )
  assertEquipment(db, tenantId, equipmentId, existing?.equipmentResourceId ?? null)
  const audiencia = resolveAudience(input, existing)
  const tempo = resolveTempo(input, existing)
  const variantKind = resolveKindText(input.variantKind, existing?.variantKind)
  let variantKindPlural = resolveKindText(input.variantKindPlural, existing?.variantKindPlural)
  if (!variantKind) variantKindPlural = null
  if (
    existing &&
    listZones(db, tenantId, existing.id).length > 0 &&
    (!variantKind || !variantKindPlural)
  ) {
    throw new ValidationError(
      'variant_kind_required',
      'dê o singular e o plural do tipo das variantes',
    )
  }

  if (input.id) {
    db.run(
      `UPDATE services SET
        name = ?, duration_minutes = ?, buffer_minutes = ?, audiencia = ?,
        tempo_ceu = ?, tempo_temperatura = ?, tempo_celsius = ?,
        price_cents = ?, client_explanation = ?, active = ?,
        requires_signal = ?, signal_kind = ?, signal_fixed_cents = ?, signal_percent = ?,
        duration_adjustable = ?, duration_min_minutes = ?, duration_max_minutes = ?,
        variant_kind = ?, variant_kind_plural = ?, updated_at = ?
       WHERE tenant_id = ? AND id = ?`,
      name,
      input.durationMinutes,
      input.bufferMinutes,
      audiencia,
      tempo.ceu,
      tempo.temperatura,
      tempo.celsius,
      priceCents,
      explanation,
      active,
      signal.requiresSignal,
      signal.signalKind,
      signal.signalFixedCents,
      signal.signalPercent,
      dur.adjustable,
      dur.min,
      dur.max,
      variantKind,
      variantKindPlural,
      now,
      tenantId,
      input.id,
    )
    writeProfessionals(db, tenantId, input.id, input.professionalIds)
    writeSpace(db, tenantId, input.id, roomRequirement, equipmentId)
    if (input.weeklyWindows !== undefined) {
      setServiceWeeklyWindows(db, tenantId, input.id, input.weeklyWindows)
    }
    return getService(db, tenantId, input.id)!
  }

  const id = newId('svc')
  db.run(
    `INSERT INTO services (
      id, tenant_id, name, duration_minutes, buffer_minutes, audiencia,
      tempo_ceu, tempo_temperatura, tempo_celsius,
      price_cents, client_explanation, active,
      requires_signal, signal_kind, signal_fixed_cents, signal_percent,
      duration_adjustable, duration_min_minutes, duration_max_minutes,
      variant_kind, variant_kind_plural, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    tenantId,
    name,
    input.durationMinutes,
    input.bufferMinutes,
    audiencia,
    tempo.ceu,
    tempo.temperatura,
    tempo.celsius,
    priceCents,
    explanation,
    active,
    signal.requiresSignal,
    signal.signalKind,
    signal.signalFixedCents,
    signal.signalPercent,
    dur.adjustable,
    dur.min,
    dur.max,
    variantKind,
    variantKindPlural,
    now,
    now,
  )
  writeProfessionals(db, tenantId, id, input.professionalIds)
  writeSpace(db, tenantId, id, roomRequirement, equipmentId)
  if (input.weeklyWindows !== undefined) {
    setServiceWeeklyWindows(db, tenantId, id, input.weeklyWindows)
  }
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
 * Apaga um serviço sem histórico e os seus vínculos. Chamar dentro de transação.
 * Com marcações, Pix ou proposta pendente: 409 (só desativar).
 */
export function deleteService(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
): ServiceRow {
  const existing = getService(db, tenantId, serviceId)
  if (!existing) {
    throw new NotFoundError('service_not_found', `serviço ${serviceId} não encontrado`)
  }
  const blocker = serviceDeleteBlocker(db, tenantId, serviceId)
  if (blocker) {
    throw new ConflictError(blocker.code, blocker.message, { serviceId })
  }
  db.run(`DELETE FROM service_professionals WHERE tenant_id = ? AND service_id = ?`, tenantId, serviceId)
  db.run(`DELETE FROM service_room_requirements WHERE tenant_id = ? AND service_id = ?`, tenantId, serviceId)
  db.run(`DELETE FROM service_weekly_windows WHERE tenant_id = ? AND service_id = ?`, tenantId, serviceId)
  db.run(`DELETE FROM services WHERE tenant_id = ? AND id = ?`, tenantId, serviceId)
  return existing
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
      'serviço inativo ou inexistente para novos agendamentos',
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
      'profissional inativo ou de outro tenant',
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

  if (service.roomRequirement.mode === 'none') {
    if (opts.roomResourceId) {
      throw new ValidationError(
        'room_requirement_mismatch',
        'Este serviço não ocupa sala.',
        { serviceId: opts.serviceId },
      )
    }
    return
  }
  if (!opts.roomResourceId || !service.roomRequirement.resourceIds.includes(opts.roomResourceId)) {
    throw new ValidationError(
      'room_requirement_mismatch',
      'A sala não está na lista deste serviço.',
      { roomResourceId: opts.roomResourceId, serviceId: opts.serviceId },
    )
  }
  const room = db.get<{ kind: string; active: number }>(
    `SELECT kind, active FROM resources WHERE tenant_id = ? AND id = ?`,
    tenantId,
    opts.roomResourceId,
  )
  if (!room || room.kind !== 'room' || room.active !== 1) {
    throw new ValidationError(
      'room_unusable',
      'sala inactiva ou de outro tenant',
      { roomResourceId: opts.roomResourceId },
    )
  }
}
