/**
 * Zonas de um serviço (DEC-078 / #293).
 * A visita é um bloco: soma das durações + o intervalo do serviço uma vez.
 */
import type { Clock } from '../../db/clock'
import { priceVisit } from '../catalog/combo'
import { ValidationError } from '../errors'
import { newId } from '../ids'
import type { ClinicDb } from '../store'
import { listCombos, pruneCombos, writeComboSnapshot } from './combos'
import {
  isVariantAudience,
  type ServiceRow,
  type ServiceZoneInput,
  type ServiceZoneRow,
  type ComboSnapshot,
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
  service: Pick<ServiceRow, 'id' | 'durationMinutes' | 'priceCents' | 'variantKind' | 'variantKindPlural'>,
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
      `UPDATE services SET variant_kind = NULL, variant_kind_plural = NULL, updated_at = ? WHERE tenant_id = ? AND id = ?`,
      now,
      tenantId,
      service.id,
    )
    pruneCombos(db, tenantId, service.id, now)
    return []
  }

  if (!service.variantKind?.trim() || !service.variantKindPlural?.trim()) {
    throw new ValidationError(
      'variant_kind_required',
      'dê o singular e o plural do tipo das variantes',
    )
  }

  const rows: ServiceZoneRow[] = []
  input.forEach((item, index) => {
    const name = item.name.trim()
    if (!name || name.length > 80) {
      throw new ValidationError('invalid_zone_name', 'o nome da zona é obrigatório', { name })
    }

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
    const key = variantIdentity(name, audience, durationMinutes, priceCents)
    if (names.has(key)) {
      throw new ValidationError(
        'zone_name_taken',
        'já existe uma variante com o mesmo nome, género, duração e preço',
        { name, audience },
      )
    }
    names.add(key)

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
  pruneCombos(db, tenantId, service.id, now)
  return rows
}

export type VisitQuote = {
  durationMinutes: number
  /** Total a cobrar, já com o combo (DEC-080). Nulo se alguma variante não tem preço. */
  priceCents: number | null
  zones: ZoneSnapshot[]
  /** Combo aplicado. Vale um por visita: o de maior desconto. */
  combo: ComboSnapshot | null
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
    return {
      durationMinutes: service.durationMinutes,
      priceCents: service.priceCents,
      zones: [],
      combo: null,
    }
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
  const priced = priceVisit(
    chosen,
    listCombos(db, tenantId, service.id).map((c) => ({ ...c })),
  )
  return {
    durationMinutes: chosen.reduce((sum, z) => sum + z.durationMinutes, 0),
    priceCents: priced.priceCents,
    combo: priced.applied
      ? {
          comboId: priced.applied.combo.id,
          name: priced.applied.combo.name,
          priceCents: priced.applied.combo.priceCents,
          listPriceCents: priced.applied.listCents,
        }
      : null,
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
  combo: ComboSnapshot | null = null,
): void {
  writeComboSnapshot(db, tenantId, ownerKind, ownerId, zones.length > 0 ? combo : null)
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

function variantIdentity(
  name: string,
  audience: VariantAudience,
  durationMinutes: number,
  priceCents: number | null,
): string {
  return `${nameKey(name)}\0${audience}\0${durationMinutes}\0${priceCents ?? ''}`
}

function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase('pt-BR')
}

function genderWord(audience: VariantAudience | undefined): string {
  return audience === 'feminino' || audience === 'masculino' ? audience : 'ambos'
}

function centsLabel(cents: number | null | undefined): string {
  if (cents == null) return 'sem preço'
  const [reais, frac] = (cents / 100).toFixed(2).split('.')
  return `R$ ${reais!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${frac}`
}

type LabeledZone = {
  name: string
  audience?: VariantAudience
  durationMinutes?: number
  priceCents?: number | null
}

function sameName(zones: readonly LabeledZone[], name: string): LabeledZone[] {
  const key = nameKey(name)
  return zones.filter((z) => nameKey(z.name) === key)
}

/** Na agenda, o mesmo nome leva género, duração e, se ainda coincidir, o preço. */
export function zoneLabel(serviceName: string, zones: readonly LabeledZone[]): string {
  if (zones.length === 0) return serviceName
  const labels = zones.map((z) => {
    const same = sameName(zones, z.name)
    if (same.length < 2 || z.durationMinutes == null) return z.name
    const gender =
      z.audience === 'feminino' || z.audience === 'masculino' ? ` ${z.audience}` : ''
    const twin = same.filter(
      (o) => o.audience === z.audience && o.durationMinutes === z.durationMinutes,
    )
    const price = twin.length > 1 ? ` ${centsLabel(z.priceCents)}` : ''
    return `${z.name}${gender} ${z.durationMinutes} min${price}`
  })
  return `${serviceName} · ${labels.join(', ')}`
}

/** Na pergunta à cliente, o mesmo nome leva género, duração e, se ainda coincidir, o preço. */
export function variantChoiceLabel(
  zone: Pick<ServiceZoneRow, 'name' | 'audience' | 'durationMinutes' | 'priceCents'>,
  peers: readonly Pick<ServiceZoneRow, 'name' | 'audience' | 'durationMinutes' | 'priceCents'>[],
): string {
  const same = sameName(peers, zone.name)
  if (same.length < 2) return zone.name
  const twin = same.filter(
    (p) => p.audience === zone.audience && p.durationMinutes === zone.durationMinutes,
  )
  const base = `${zone.name} (${genderWord(zone.audience)}, ${zone.durationMinutes} min`
  return twin.length > 1 ? `${base}, ${centsLabel(zone.priceCents)})` : `${base})`
}

function foldZoneName(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function audienceHint(folded: string): VariantAudience | null {
  const fem = /\bfeminin[oa]s?\b/.test(folded)
  const masc = /\bmasculin[oa]s?\b/.test(folded)
  if (fem === masc) return null
  return fem ? 'feminino' : 'masculino'
}

function durationHint(folded: string): number | null {
  const match = folded.match(/\b(\d+)\s*min\b/)
  if (!match) return null
  const minutes = Number(match[1])
  return Number.isInteger(minutes) && minutes > 0 ? minutes : null
}

/** Nomes de zona que aparecem no texto, como palavras. O nome mais longo ganha. A ordem é a do catálogo. O mesmo nome inclui cada variante; «feminina» ou «masculino» no texto fica só com esse género. */
export function zonesNamedInText(text: string, zones: readonly ServiceZoneRow[]): ServiceZoneRow[] {
  const folded = foldZoneName(text)
  const hint = audienceHint(folded)
  const minutes = durationHint(folded)
  const candidates = zones.filter((z) => z.active && z.name.trim().length >= 2)
  const byLength = [...candidates].sort(
    (a, b) => foldZoneName(b.name).length - foldZoneName(a.name).length,
  )
  let rest = folded
  const hit = new Set<string>()
  const matched = new Set<string>()
  for (const zone of byLength) {
    const name = foldZoneName(zone.name.trim())
    const sameName = matched.has(name)
    if (!sameName) {
      const re = new RegExp(`(?<![a-z0-9])${escapeRegExp(name)}(?![a-z0-9])`, 'g')
      if (!re.test(rest)) continue
      re.lastIndex = 0
      matched.add(name)
      rest = rest.replace(re, ' ')
    }
    if (hint != null && zone.audience !== hint) continue
    if (minutes != null && zone.durationMinutes !== minutes) continue
    hit.add(zone.id)
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
