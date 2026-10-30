/**
 * Zonas de um serviço (DEC-078 / #293).
 * A visita é um bloco: soma das durações + o intervalo do serviço uma vez.
 */
import type { Clock } from '../../db/clock'
import { ValidationError } from '../errors'
import { newId } from '../ids'
import type { ClinicDb } from '../store'
import {
  isVariantAudience,
  type ServiceRow,
  type ServiceZoneInput,
  type ServiceZoneRow,
  type VariantAudience,
  type ZoneSnapshot,
} from './types'

export type ZoneOwnerKind = 'appointment' | 'proposal' | 'pix_charge' | 'scheduling_intent'

type ZoneSql = {
  id: string
  tenant_id: string
  service_id: string
  name: string
  duration_minutes: number
  price_cents: number | null
  audience?: string | null
  active: number
  sort_order: number
}

type SnapSql = {
  zone_id: string | null
  name: string
  duration_minutes: number
  price_cents: number | null
  audience?: string | null
  sort_order: number
}

function mapZone(row: ZoneSql): ServiceZoneRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    serviceId: row.service_id,
    name: row.name,
    durationMinutes: row.duration_minutes,
    priceCents: row.price_cents,
    audience: readAudience(row.audience),
    active: row.active === 1,
    sortOrder: row.sort_order,
  }
}

export function listZones(db: ClinicDb, tenantId: string, serviceId: string): ServiceZoneRow[] {
  return db
    .all<ZoneSql>(
      `SELECT * FROM service_zones
       WHERE tenant_id = ? AND service_id = ?
       ORDER BY sort_order, name COLLATE NOCASE, id`,
      tenantId,
      serviceId,
    )
    .map(mapZone)
}

function readAudience(value: string | null | undefined): VariantAudience {
  return isVariantAudience(value) ? value : 'ambos'
}

function requireAudience(value: unknown): VariantAudience {
  if (isVariantAudience(value)) return value
  throw new ValidationError(
    'invalid_variant_audience',
    'cada variante é masculina, feminina ou ambos',
  )
}

/** `ambos` combina com qualquer um. Masculino e feminino juntos recusam a visita. */
export function variantAudiencesConflict(
  zones: readonly { audience: VariantAudience }[],
): boolean {
  let feminino = false
  let masculino = false
  for (const zone of zones) {
    if (zone.audience === 'feminino') feminino = true
    if (zone.audience === 'masculino') masculino = true
  }
  return feminino && masculino
}

function assertDuration(minutes: number): void {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60) {
    throw new ValidationError(
      'invalid_zone_duration',
      'a duração é um número inteiro de minutos, de 1 a 24 h',
      { durationMinutes: minutes },
    )
  }
}

function zoneInUse(db: ClinicDb, tenantId: string, zoneId: string): boolean {
  const row = db.get<{ id: string }>(
    `SELECT id FROM visit_zone_snapshots WHERE tenant_id = ? AND zone_id = ? LIMIT 1`,
    tenantId,
    zoneId,
  )
  return Boolean(row)
}

/**
 * Substitui o catálogo. Lista vazia só é aceite se nenhuma zona foi usada
 * numa visita, proposta ou cobrança — o serviço volta à duração da linha.
 */
export function replaceZones(
  db: ClinicDb,
  tenantId: string,
  service: Pick<ServiceRow, 'id' | 'durationMinutes' | 'priceCents' | 'variantKind'>,
  input: ServiceZoneInput[],
  clock: Clock,
): ServiceZoneRow[] {
  const existing = listZones(db, tenantId, service.id)
  const now = clock.nowMs()
  const names = new Set<string>()
  const kept = new Set<string>()

  if (input.length === 0) {
    for (const zone of existing) {
      if (zoneInUse(db, tenantId, zone.id)) {
        throw new ValidationError(
          'zone_in_use',
          'esta zona já entrou numa visita e não pode ser removida',
          { zoneId: zone.id },
        )
      }
    }
    db.run(`DELETE FROM service_zones WHERE tenant_id = ? AND service_id = ?`, tenantId, service.id)
    db.run(
      `UPDATE services SET variant_kind = NULL, updated_at = ? WHERE tenant_id = ? AND id = ?`,
      now,
      tenantId,
      service.id,
    )
    return []
  }

  if (!service.variantKind?.trim()) {
    throw new ValidationError(
      'variant_kind_required',
      'dê um nome ao tipo das variantes',
    )
  }

  const rows: ServiceZoneRow[] = []
  input.forEach((item, index) => {
    const name = item.name.trim()
    if (!name || name.length > 80) {
      throw new ValidationError('invalid_zone_name', 'o nome da zona é obrigatório', { name })
    }
    const key = name.toLocaleLowerCase('pt-BR')
    if (names.has(key)) {
      throw new ValidationError('zone_name_taken', 'já existe uma zona com esse nome neste procedimento', {
        name,
      })
    }
    names.add(key)

    const prior = item.id ? existing.find((z) => z.id === item.id) : undefined
    if (item.id && !prior) {
      throw new ValidationError('zone_not_found', 'zona não encontrada neste procedimento', { zoneId: item.id })
    }
    const firstOfEmpty = existing.length === 0 && index === 0
    const durationMinutes = item.durationMinutes ?? (firstOfEmpty ? service.durationMinutes : prior?.durationMinutes)
    if (durationMinutes == null) {
      throw new ValidationError('invalid_zone_duration', 'a duração da zona é obrigatória')
    }
    assertDuration(durationMinutes)
    const priceCents =
      item.priceCents === undefined
        ? firstOfEmpty
          ? service.priceCents
          : (prior?.priceCents ?? null)
        : item.priceCents
    if (priceCents != null && (!Number.isInteger(priceCents) || priceCents < 0)) {
      throw new ValidationError('invalid_price', 'preço da variante inválido', { priceCents })
    }
    const audience = requireAudience(item.audience)

    const id = prior?.id ?? newId('zone')
    kept.add(id)
    const active = item.active === false ? 0 : 1
    if (prior) {
      db.run(
        `UPDATE service_zones
         SET name = ?, duration_minutes = ?, price_cents = ?, audience = ?, active = ?, sort_order = ?, updated_at = ?
         WHERE tenant_id = ? AND id = ?`,
        name,
        durationMinutes,
        priceCents,
        audience,
        active,
        index,
        now,
        tenantId,
        id,
      )
    } else {
      db.run(
        `INSERT INTO service_zones (
          id, tenant_id, service_id, name, duration_minutes, price_cents, audience, active, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        tenantId,
        service.id,
        name,
        durationMinutes,
        priceCents,
        audience,
        active,
        index,
        now,
        now,
      )
    }
    rows.push({
      id,
      tenantId,
      serviceId: service.id,
      name,
      durationMinutes,
      priceCents,
      audience,
      active: active === 1,
      sortOrder: index,
    })
  })

  for (const zone of existing) {
    if (kept.has(zone.id)) continue
    if (zoneInUse(db, tenantId, zone.id)) {
      throw new ValidationError(
        'zone_in_use',
        'esta zona já entrou numa visita e não pode ser removida',
        { zoneId: zone.id },
      )
    }
    db.run(`DELETE FROM service_zones WHERE tenant_id = ? AND id = ?`, tenantId, zone.id)
  }
  return rows
}

export type VisitQuote = {
  durationMinutes: number
  priceCents: number | null
  zones: ZoneSnapshot[]
}

/** Duração e preço da visita. Sem zonas, usa a linha do serviço. */
export function quoteVisit(
  db: ClinicDb,
  tenantId: string,
  service: Pick<ServiceRow, 'id' | 'durationMinutes' | 'priceCents'>,
  zoneIds: readonly string[] | null | undefined,
): VisitQuote {
  const catalog = listZones(db, tenantId, service.id)
  const ids = [...(zoneIds ?? [])]
  if (catalog.length === 0) {
    if (ids.length > 0) {
      throw new ValidationError(
        'zones_not_on_service',
        'este procedimento não tem zonas',
        { serviceId: service.id },
      )
    }
    return { durationMinutes: service.durationMinutes, priceCents: service.priceCents, zones: [] }
  }
  const active = catalog.filter((z) => z.active)
  if (active.length === 0) {
    throw new ValidationError(
      'zones_unavailable',
      'todas as zonas deste procedimento estão inativas',
      { serviceId: service.id },
    )
  }
  if (ids.length === 0) {
    throw new ValidationError('zones_required', 'escolha ao menos uma zona', { serviceId: service.id })
  }
  if (new Set(ids).size !== ids.length) {
    throw new ValidationError('zone_repeated', 'cada zona só pode entrar uma vez')
  }
  const byId = new Map(catalog.map((z) => [z.id, z]))
  const chosen: ServiceZoneRow[] = []
  for (const id of ids) {
    const zone = byId.get(id)
    if (!zone || zone.tenantId !== tenantId || zone.serviceId !== service.id) {
      throw new ValidationError(
        'zone_not_on_service',
        'zona de outro procedimento ou de outra clínica',
        { zoneId: id, serviceId: service.id },
      )
    }
    if (!zone.active) {
      throw new ValidationError('zone_inactive', 'zona inativa', { zoneId: id })
    }
    chosen.push(zone)
  }
  if (variantAudiencesConflict(chosen)) {
    throw new ValidationError(
      'variant_audience_conflict',
      'a mesma visita não mistura variante masculina e feminina',
    )
  }
  chosen.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt-BR'))
  const priceCents = chosen.every((z) => z.priceCents != null)
    ? chosen.reduce((sum, z) => sum + (z.priceCents ?? 0), 0)
    : null
  return {
    durationMinutes: chosen.reduce((sum, z) => sum + z.durationMinutes, 0),
    priceCents,
    zones: chosen.map((z) => ({
      zoneId: z.id,
      name: z.name,
      durationMinutes: z.durationMinutes,
      priceCents: z.priceCents,
      audience: z.audience,
      sortOrder: z.sortOrder,
    })),
  }
}

export function writeZoneSnapshots(
  db: ClinicDb,
  tenantId: string,
  ownerKind: ZoneOwnerKind,
  ownerId: string,
  zones: readonly ZoneSnapshot[],
): void {
  db.run(
    `DELETE FROM visit_zone_snapshots WHERE tenant_id = ? AND owner_kind = ? AND owner_id = ?`,
    tenantId,
    ownerKind,
    ownerId,
  )
  zones.forEach((zone, index) => {
    db.run(
      `INSERT INTO visit_zone_snapshots (
        id, tenant_id, owner_kind, owner_id, zone_id, name, duration_minutes, price_cents, audience, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId('vz'),
      tenantId,
      ownerKind,
      ownerId,
      zone.zoneId,
      zone.name,
      zone.durationMinutes,
      zone.priceCents,
      zone.audience,
      index,
    )
  })
}

export function readZoneSnapshots(
  db: ClinicDb,
  tenantId: string,
  ownerKind: ZoneOwnerKind,
  ownerId: string,
): ZoneSnapshot[] {
  return db
    .all<SnapSql>(
      `SELECT zone_id, name, duration_minutes, price_cents, audience, sort_order
       FROM visit_zone_snapshots
       WHERE tenant_id = ? AND owner_kind = ? AND owner_id = ?
       ORDER BY sort_order, name`,
      tenantId,
      ownerKind,
      ownerId,
    )
    .map((row) => ({
      zoneId: row.zone_id,
      name: row.name,
      durationMinutes: row.duration_minutes,
      priceCents: row.price_cents,
      audience: readAudience(row.audience),
      sortOrder: row.sort_order,
    }))
}

export function snapshotDuration(zones: readonly ZoneSnapshot[]): number | null {
  if (zones.length === 0) return null
  return zones.reduce((sum, z) => sum + z.durationMinutes, 0)
}

export function zoneLabel(serviceName: string, zones: readonly { name: string }[]): string {
  if (zones.length === 0) return serviceName
  return `${serviceName} · ${zones.map((z) => z.name).join(', ')}`
}

function foldZoneName(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Nomes de zona que aparecem no texto, como palavras. O nome mais longo ganha. A ordem é a do catálogo. */
export function zonesNamedInText(text: string, zones: readonly ServiceZoneRow[]): ServiceZoneRow[] {
  const candidates = zones.filter((z) => z.active && z.name.trim().length >= 2)
  const byLength = [...candidates].sort(
    (a, b) => foldZoneName(b.name).length - foldZoneName(a.name).length,
  )
  let rest = foldZoneName(text)
  const hit = new Set<string>()
  for (const zone of byLength) {
    const name = foldZoneName(zone.name.trim())
    const re = new RegExp(`(?<![a-z0-9])${escapeRegExp(name)}(?![a-z0-9])`, 'g')
    if (!re.test(rest)) continue
    hit.add(zone.id)
    rest = rest.replace(re, ' ')
  }
  return zones.filter((z) => hit.has(z.id))
}

/** A cópia deixou de bater com o catálogo (duração, preço, nome ou zona inativa). */
export function zoneSnapshotsDrifted(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
  snapshots: readonly ZoneSnapshot[],
): boolean {
  if (snapshots.length === 0) return false
  const catalog = listZones(db, tenantId, serviceId)
  const byId = new Map(catalog.map((z) => [z.id, z]))
  for (const snap of snapshots) {
    const live = snap.zoneId ? byId.get(snap.zoneId) : undefined
    if (!live || !live.active) return true
    if (live.name !== snap.name) return true
    if (live.durationMinutes !== snap.durationMinutes) return true
    if ((live.priceCents ?? null) !== (snap.priceCents ?? null)) return true
    if (live.audience !== snap.audience) return true
  }
  return false
}
