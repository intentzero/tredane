/**
 * Zonas de um serviço (DEC-078 / #293).
 * A visita é um bloco: soma das durações + o intervalo do serviço uma vez.
 */
import { durationMinutesFromText } from '../catalog/duration'
import { allowsMultipleVariants } from '../catalog/variant-selection'
import { parseTimes } from '../ai/nlu/temporal'
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
import { OPTION_MATCH_STOP } from './option-match-stop'
import {
  assertSynonymsNoCollision,
  foldSynonym,
  listCatalogNameClaims,
  normalizeSynonymList,
  parseSynonymsJson,
  serializeSynonyms,
  textCitesNameOrSynonym,
  type CatalogNameClaim,
} from './synonyms'

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
  synonyms_json?: string | null
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
    synonyms: parseSynonymsJson(row.synonyms_json),
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

/**
 * Zonas citadas em **texto livre** misturam as linhas? (CF-43)
 * Um nome que existe nas duas linhas (homónimo DEC-079, ex. «Axila») sem palavra
 * de linha no texto é ambíguo: pergunta-se a linha (DEC-090), não se recusa mistura.
 * Mistura explícita («axila masculina e pernas femininas», D-04) continua recusada.
 * Para escolhas por id (toque, proposta) use `variantAudiencesConflict`.
 */
export function textNamesMixAudiences(
  text: string,
  named: readonly { name: string; audience: VariantAudience }[],
): boolean {
  if (!variantAudiencesConflict(named)) return false
  const folded = foldZoneName(text)
  if (/\bfeminin[oa]s?\b/.test(folded) && /\bmasculin[oa]s?\b/.test(folded)) return true
  const byName = new Map<string, Set<VariantAudience>>()
  for (const zone of named) {
    const key = foldZoneName(zone.name.trim())
    const set = byName.get(key) ?? new Set<VariantAudience>()
    set.add(zone.audience)
    byName.set(key, set)
  }
  const unambiguous = named.filter((zone) => {
    const audiences = byName.get(foldZoneName(zone.name.trim()))!
    return !(audiences.has('feminino') && audiences.has('masculino'))
  })
  return variantAudiencesConflict(unambiguous)
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

  // Colisões de sinónimos: ignora variantes antigas deste serviço (vamos substituí-las)
  // e acrescenta os nomes/sinónimos do lote novo.
  const baseClaims = listCatalogNameClaims(db, tenantId).filter(
    (c) => !(c.serviceId === service.id && c.zoneId != null),
  )
  const pendingClaims: CatalogNameClaim[] = [...baseClaims]

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
    const synonyms =
      item.synonyms === undefined
        ? (prior?.synonyms ?? [])
        : normalizeSynonymList(item.synonyms)
    const keptSynonyms = assertSynonymsNoCollision({
      synonyms,
      selfName: name,
      selfServiceId: service.id,
      selfZoneId: id,
      claims: pendingClaims,
    })
    const ownerFolded = foldSynonym(name)
    pendingClaims.push({
      folded: ownerFolded,
      label: name,
      serviceId: service.id,
      zoneId: id,
      ownerFolded,
    })
    for (const syn of keptSynonyms) {
      pendingClaims.push({
        folded: foldSynonym(syn),
        label: syn,
        serviceId: service.id,
        zoneId: id,
        ownerFolded,
      })
    }
    if (prior) {
      db.run(
        `UPDATE service_zones
         SET name = ?, duration_minutes = ?, price_cents = ?, audience = ?, active = ?,
             sort_order = ?, synonyms_json = ?, updated_at = ?
         WHERE tenant_id = ? AND id = ?`,
        name,
        durationMinutes,
        priceCents,
        audience,
        active,
        index,
        serializeSynonyms(keptSynonyms),
        now,
        tenantId,
        id,
      )
    } else {
      db.run(
        `INSERT INTO service_zones (
          id, tenant_id, service_id, name, duration_minutes, price_cents, audience, active,
          sort_order, synonyms_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        tenantId,
        service.id,
        name,
        durationMinutes,
        priceCents,
        audience,
        active,
        index,
        serializeSynonyms(keptSynonyms),
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
      synonyms: keptSynonyms,
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
  // Invalida o catálogo compilado (#411 / DEC-110): readCatalogVersion olha services.updated_at.
  db.run(
    `UPDATE services SET updated_at = ? WHERE tenant_id = ? AND id = ?`,
    now,
    tenantId,
    service.id,
  )
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
  service: Pick<ServiceRow, 'id' | 'durationMinutes' | 'priceCents' | 'variantSelection'>,
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
  if (new Set(ids).size !== ids.length) {
    throw new ValidationError('zone_repeated', 'cada zona só pode entrar uma vez')
  }
  // DEC-145 / DEC-149: modo `uma` exige exactamente uma variante activa no orçamento canónico.
  if (!allowsMultipleVariants(service.variantSelection) && ids.length !== 1) {
    throw new ValidationError(
      'variant_selection_uma',
      'este procedimento aceita só uma variante por visita',
      { serviceId: service.id, variantCount: ids.length },
    )
  }
  if (ids.length === 0) {
    throw new ValidationError('zones_required', 'escolha ao menos uma zona', { serviceId: service.id })
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


/**
 * Palavras de linha, período ou pedido. Não escolhem zona.
 * «parte» fica de fora pelo tamanho: «na parte da manhã» não é «Parte íntima».
 */
const ZONE_ALIAS_STOP = new Set([
  'feminina',
  'feminino',
  'masculina',
  'masculino',
  'horario',
  'horarios',
  'agendar',
  'gostaria',
])

function zoneAliasWords(name: string): string[] {
  return foldZoneName(name)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 6 && !ZONE_ALIAS_STOP.has(word))
}

/** Palavras do serviço (nome / sinónimos) a ignorar no alias de variante. */
function foldIgnoreWords(words: readonly string[] | undefined): Set<string> {
  return new Set(
    (words ?? [])
      .flatMap((w) => foldZoneName(w).split(/[^a-z0-9]+/))
      .filter((w) => w.length >= 3),
  )
}

/**
 * Nomes de zona que aparecem no texto, como palavras. O nome mais longo ganha.
 * A ordem é a do catálogo. O mesmo nome inclui cada variante; «feminina» ou
 * «masculino» no texto fica só com esse género.
 * Uma palavra longa e única do nome também conta («íntima» = «Parte íntima»)
 * quando nenhuma outra zona do âmbito usa essa palavra.
 *
 * `ignoreWords`: palavras só do serviço aberto (e sinónimos). Não disparam
 * o alias de variante — «massagem» ≠ «Massagem relaxante». O nome completo
 * da variante e uma palavra distintiva («relaxante») continuam a casar.
 */
export function zonesNamedInText(
  text: string,
  zones: readonly ServiceZoneRow[],
  opts?: { ignoreWords?: readonly string[] },
): ServiceZoneRow[] {
  const folded = foldZoneName(text)
  const hint = audienceHint(folded)
  const minutes = durationMinutesFromText(text)
  const ignoreAlias = foldIgnoreWords(opts?.ignoreWords)
  const candidates = zones.filter((z) => z.active && z.name.trim().length >= 2)
  const byLength = [...candidates].sort(
    (a, b) => foldZoneName(b.name).length - foldZoneName(a.name).length,
  )
  let rest = folded
  const hit = new Set<string>()
  const matched = new Set<string>()
  const accept = (zone: ServiceZoneRow): void => {
    if (hint != null && zone.audience !== hint) return
    if (minutes != null && zone.durationMinutes !== minutes) return
    hit.add(zone.id)
  }
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
    accept(zone)
  }
  // DEC-110: sinónimos (ex. «buço» → «Lábio superior») — só interpretação.
  const bySynonymLength = [...candidates].sort((a, b) => {
    const aMax = Math.max(0, ...(a.synonyms ?? []).map((s) => foldZoneName(s).length))
    const bMax = Math.max(0, ...(b.synonyms ?? []).map((s) => foldZoneName(s).length))
    return bMax - aMax
  })
  for (const zone of bySynonymLength) {
    const name = foldZoneName(zone.name.trim())
    if (matched.has(name)) continue
    const hitSyn = (zone.synonyms ?? []).some((syn) => textCitesNameOrSynonym(rest, syn, []))
    if (!hitSyn) continue
    matched.add(name)
    for (const syn of zone.synonyms ?? []) {
      const s = foldZoneName(syn.trim())
      if (s.length < 2) continue
      rest = rest.replace(new RegExp(`(?<![a-z0-9])${escapeRegExp(s)}(?![a-z0-9])`, 'g'), ' ')
    }
    accept(zone)
  }
  const namesByWord = new Map<string, Set<string>>()
  for (const zone of candidates) {
    const name = foldZoneName(zone.name.trim())
    for (const word of zoneAliasWords(zone.name)) {
      // Nome do serviço aberto não escolhe variante por alias (Paulo 07/11/2026).
      if (ignoreAlias.has(word)) continue
      const set = namesByWord.get(word) ?? new Set<string>()
      set.add(name)
      namesByWord.set(word, set)
    }
  }
  for (const [word, names] of namesByWord) {
    if (names.size !== 1) continue
    const name = [...names][0]!
    if (matched.has(name)) continue
    const re = new RegExp(`(?<![a-z0-9])${escapeRegExp(word)}(?![a-z0-9])`)
    if (!re.test(folded)) continue
    matched.add(name)
    for (const zone of candidates) {
      if (foldZoneName(zone.name.trim()) !== name) continue
      accept(zone)
    }
  }
  return zones.filter((z) => hit.has(z.id))
}

/**
 * DEC-137 — plural leve do nome («Axila» → «axilas»).
 * Não é distância de edição: nomes diferentes não casam.
 */
function lightPluralPhrase(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word.length < 3 || word.endsWith('s')) return word
      if (word.endsWith('m')) return `${word.slice(0, -1)}ns`
      if (word.endsWith('ao')) return `${word.slice(0, -2)}oes`
      if (word.endsWith('r') || word.endsWith('z')) return `${word}es`
      if (word.endsWith('l')) return `${word.slice(0, -1)}is`
      return `${word}s`
    })
    .join(' ')
}

/**
 * Inverso leve do plural («Pernas» → «perna», «Braços» → «braco»).
 * Confirmado Paulo 10/11/2026 (opção 1): singular↔plural nos nomes curtos.
 * Sem fuzzy 1-edit; só morfologia espelhada de `lightPluralPhrase`.
 */
function lightSingularPhrase(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word.length < 4) return word
      if (word.endsWith('oes') && word.length >= 5) return `${word.slice(0, -3)}ao`
      if (word.endsWith('ns') && word.length >= 4) return `${word.slice(0, -2)}m`
      if (word.endsWith('ais') && word.length >= 5) return `${word.slice(0, -2)}l`
      if (word.endsWith('eis') && word.length >= 5) return `${word.slice(0, -2)}el`
      if (word.endsWith('ois') && word.length >= 5) return `${word.slice(0, -2)}ol`
      if (word.endsWith('uis') && word.length >= 5) return `${word.slice(0, -2)}ul`
      if (word.endsWith('is') && word.length >= 4) return `${word.slice(0, -2)}l`
      if ((word.endsWith('res') || word.endsWith('zes')) && word.length >= 4) {
        return word.slice(0, -2)
      }
      if (word.endsWith('s')) return word.slice(0, -1)
      return word
    })
    .join(' ')
}

/** Palavras de cumprimento, pedido ou linha. Não são zona citada. */
const ZONE_MENTION_STOP = new Set([
  ...OPTION_MATCH_STOP,
  'tudo',
  'bem',
  'fazer',
  'minuto',
  'minutos',
  'mais',
  'so',
  'apenas',
  'tambem',
  'sim',
  'nao',
  'certo',
  'corrigir',
  'entendi',
  'isso',
  'essa',
  'esse',
  'meu',
  'minha',
  'seu',
  'sua',
  'voce',
  'voces',
  'depilacao',
  'limpeza',
  'massagem',
  'pele',
  'zona',
  'zonas',
  'linha',
  // Audience words: leftover must not echo «feminina»; detection uses other paths.
  'feminina',
  'feminino',
  'masculina',
  'masculino',
  'opcao',
  'opcoes',
  // «todas»/«tudo» não viram sobra; o atalho lê o texto cru (`claimsWholeCatalog`).
  'todas',
  'todos',
  'completo',
  'completa',
  // «as duas» / «as três» (COUNTED_CATALOG_CHOICE) — não são sobra de zona (#509)
  'duas',
  'tres',
  'ambos',
  'ambas',
  'amanha',
  'hoje',
  'depois',
  'segunda',
  'terca',
  'quarta',
  'quinta',
  'sexta',
  'sabado',
  'domingo',
  // Sufixo de dia da semana («quarta feira» / «quarta-feira») — não é zona.
  'feira',
  // Verbos de existência / disponibilidade («tem horário…») — não são zona.
  'tem',
  'tera',
  'tinha',
  'existe',
  'existem',
  'cedo',
  'logo',
  'agora',
  'semana',
  'proxima',
  'proximo',
  'parte',
  // Prefixo de toque Meta («[Lista] Axila», «[Botão] Feminina»)
  'lista',
  'botao',
  // DEC-137, leitura 06/11/2026: partícula que não nomeia zona não é sobra.
  'entao',
  'valeu',
  'prefiro',
  'verdade',
  'servico',
  // Determinantes da mesma classe que «uma» (review #597 M1).
  'esta',
  'este',
  'estes',
  'estas',
  'alguma',
  'algum',
  'alguns',
  'algumas',
  // «outra»/«outro» não é variante nem troca de serviço (Paulo 07/11/2026).
  'outra',
  'outro',
  // Despedida / fecho — não disparam «Não encontrei tchau…».
  'tchau',
  'adeus',
  'flw',
  'vlw',
  'bye',
  // DEC-147: abandono educado («Deixa estar», «Podes encerrar a sessão»).
  'deixa',
  'estar',
  'podes',
  'encerrar',
  'sessao',
  'desisto',
  'desistir',
  // DEC-152: «Terminar» (hint mid-funnel) nunca é sobra de zona/tipo.
  'terminar',
  // DEC-147 C: «não serve» não é sobra de zona.
  'serve',
])

/**
 * Hora, não zona que sobrou. Consulta `parseTimes`: o token inteiro é relógio
 * quando o relógio único o consome («10h», «10hrs», «10hs», «0900»).
 * Frases («lá pelas 10», «9 e meia», «meio-dia», «o das 10») saem antes,
 * pelo mascaramento dos trechos, não por esta função isolada.
 */
function isClockToken(word: string): boolean {
  if (!word) return false
  const parsed = parseTimes(word)
  if (parsed.times.length === 0 && parsed.spans.length === 0) return false
  return parsed.spans.some((span) => span.start === 0 && span.end === word.length)
}

/** Apaga os trechos que `parseTimes` consumiu, para não virarem sobra de zona. */
function maskClockSpans(folded: string): string {
  const { spans } = parseTimes(folded)
  if (spans.length === 0) return folded
  const chars = folded.split('')
  for (const span of spans) {
    for (let i = span.start; i < span.end && i < chars.length; i++) chars[i] = ' '
  }
  return chars.join('')
}

/**
 * Typos a 1 edição do sufixo «feira» («feora», «feria», «fiera» por transposição).
 * Não é fuzzy de zona — só evita option-miss em fragmentos de «terça-feira».
 */
function editDistanceAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1
      j += 1
      continue
    }
    edits += 1
    if (edits > 1) return false
    if (a.length === b.length) {
      // Transposição adjacente conta como 1 edição («fiera» ← «feira», P1 rsamp_fa7f138).
      if (a[i + 1] === b[j] && a[i] === b[j + 1]) {
        i += 2
        j += 2
        continue
      }
      i += 1
      j += 1
    } else if (a.length > b.length) i += 1
    else j += 1
  }
  if (i < a.length || j < b.length) edits += 1
  return edits <= 1
}

function isMentionStopToken(word: string): boolean {
  if (ZONE_MENTION_STOP.has(word)) return true
  // «feira» já está na stop-list; typos comuns (staging «feora») também.
  return editDistanceAtMostOne(word, 'feira')
}

function mentionContentTokens(folded: string): string[] {
  return maskClockSpans(folded)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !isMentionStopToken(word) && !isClockToken(word))
}

function stripPhrase(text: string, phrase: string): string {
  const p = phrase.trim()
  if (p.length < 2) return text
  return text.replace(new RegExp(`(?<![a-z0-9])${escapeRegExp(p)}(?![a-z0-9])`, 'g'), ' ')
}

function stripZoneWords(text: string, zone: ServiceZoneRow): string {
  let rest = stripPhrase(text, foldZoneName(zone.name.trim()))
  for (const word of foldZoneName(zone.name).split(/[^a-z0-9]+/)) {
    if (word.length >= 3) rest = stripPhrase(rest, word)
  }
  for (const syn of zone.synonyms ?? []) {
    const folded = foldZoneName(syn.trim())
    if (folded.length >= 2) rest = stripPhrase(rest, folded)
  }
  return rest
}

export type ZoneMentionResolution = {
  /**
   * Zonas aceites neste turno, na ordem do âmbito.
   * Com `unrecognized`, mantém o que casou (Paulo 10/11/2026 opção 2) —
   * a sobra bloqueia Horários, mas não descarta o enunciado inteiro.
   */
  zones: ServiceZoneRow[]
  /** Algum aceite veio do singular/plural leve, não do nome exacto. */
  approx: boolean
  /**
   * Um item da lista (ex. «e» / vírgula) não mapeou para uma zona única.
   * Bloqueia Horários; as zonas em `zones` ficam para eco / quadro.
   */
  unrecognized: boolean
  /**
   * Primeira palavra citada que não mapeou (para a pergunta «Não encontrei…»).
   * Null quando não há sobra identificável.
   */
  leftover: string | null
}

/**
 * Nomes cujo texto tem «e» ou «ou» («Tórax e Abdômen»).
 * Saem do texto antes do split em itens: senão o «e» interno parte a zona
 * e «torax» fica sobra («Não encontrei torax»), mesmo com Axila e Pernas certas.
 * Só retira a frase quando alguma zona do âmbito a aceita.
 */
function exciseCompoundZonePhrases(
  folded: string,
  zones: readonly ServiceZoneRow[],
  hint: VariantAudience | null,
  minutes: number | null,
): { rest: string; ids: Set<string> } {
  const byPhrase = new Map<string, ServiceZoneRow[]>()
  const addPhrase = (phrase: string, zone: ServiceZoneRow) => {
    if (phrase.length < 2 || !/\b(?:e|ou)\b/.test(phrase)) return
    const list = byPhrase.get(phrase) ?? []
    if (!list.some((item) => item.id === zone.id)) list.push(zone)
    byPhrase.set(phrase, list)
  }
  for (const zone of zones) {
    if (!zone.active || zone.name.trim().length < 2) continue
    addPhrase(foldZoneName(zone.name.trim()), zone)
    for (const syn of zone.synonyms ?? []) addPhrase(foldZoneName(syn.trim()), zone)
  }
  const ordered = [...byPhrase.entries()].sort((a, b) => b[0].length - a[0].length)
  let rest = folded
  const ids = new Set<string>()
  for (const [phrase, group] of ordered) {
    const accepted = group.filter((zone) => {
      if (hint != null && zone.audience !== hint) return false
      if (minutes != null && zone.durationMinutes !== minutes) return false
      return true
    })
    if (accepted.length === 0) continue
    const re = new RegExp(`(?<![a-z0-9])${escapeRegExp(phrase)}(?![a-z0-9])`, 'g')
    const next = rest.replace(re, ' ')
    if (next === rest) continue
    rest = next
    for (const zone of accepted) ids.add(zone.id)
  }
  return { rest, ids }
}

/**
 * DEC-137 / #509. Nomes exactos (`zonesNamedInText`, sinónimos DEC-110) e, no
 * que sobra, singular↔plural leve único no âmbito passado — a linha já travada
 * (`zonesForAudienceLine`). O mesmo radical em masculino e feminino não casa.
 * Sem fuzzy de outro nome. Se um item citado não resolve, `unrecognized`
 * (nunca Horários com N−1) e as zonas que casaram ficam em `zones`
 * (Paulo 10/11/2026 opções 1+2).
 * Zona composta («Tórax e Abdômen») casa inteira, com ou sem acento, antes
 * de partir a lista no «e».
 *
 * `ignoreWords`: palavras do nome do serviço (e sinónimos) que não contam
 * como zona citada — «Quero bronzeamento…» não dispara «Não encontrei bronzeamento».
 * Também bloqueiam o alias de variante: «massagem» com serviço Massagem aberto
 * não escolhe «Massagem relaxante».
 */
export function resolveZoneMention(
  text: string,
  zones: readonly ServiceZoneRow[],
  opts?: { ignoreWords?: readonly string[] },
): ZoneMentionResolution {
  const active = zones.filter((z) => z.active && z.name.trim().length >= 2)
  const empty = {
    zones: [] as ServiceZoneRow[],
    approx: false,
    unrecognized: false,
    leftover: null as string | null,
  }
  if (active.length === 0 || !text.trim()) return empty
  const ignore = foldIgnoreWords(opts?.ignoreWords)
  const contentTokens = (folded: string): string[] =>
    mentionContentTokens(folded).filter((w) => !ignore.has(w))
  /** Forma aproximada (plural ou singular) → nomes canónicos → zonas. */
  const byApprox = new Map<string, Map<string, ServiceZoneRow[]>>()
  const indexApproxForm = (form: string, name: string, zone: ServiceZoneRow) => {
    if (form.length < 3 || form === name) return
    let names = byApprox.get(form)
    if (!names) {
      names = new Map()
      byApprox.set(form, names)
    }
    const group = names.get(name) ?? []
    group.push(zone)
    names.set(name, group)
  }
  for (const zone of active) {
    const name = foldZoneName(zone.name.trim())
    indexApproxForm(lightPluralPhrase(name), name, zone)
    indexApproxForm(lightSingularPhrase(name), name, zone)
  }
  const approxIndex = new Map<string, ServiceZoneRow[]>()
  for (const [form, names] of byApprox) {
    if (names.size !== 1) continue
    const group = [...names.values()][0]!
    if (variantAudiencesConflict(group)) continue
    approxIndex.set(form, group)
  }
  // Relógio único antes do split no «e»: «9 e meia» não vira sobra «meia».
  const folded = maskClockSpans(foldZoneName(text))
  const excised = exciseCompoundZonePhrases(
    folded,
    active,
    audienceHint(folded),
    durationMinutesFromText(text),
  )
  const parts = excised.rest
    .split(/\s*(?:,|;|\/|\+|\be\b|\bou\b)\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
  // Frase inteira era a zona composta: não voltar a partir o texto original.
  const segments = parts.length > 0 ? parts : excised.ids.size > 0 ? [] : [folded]
  const hit = new Set<string>()
  let approx = false
  let failedSegment = false
  let leftoverWord: string | null = null
  for (const part of segments) {
    if (contentTokens(part).length === 0) continue
    const exact = zonesNamedInText(part, active, opts)
    let rest = part
    for (const zone of exact) rest = stripZoneWords(rest, zone)
    const approxHits: ServiceZoneRow[] = []
    const forms = [...approxIndex.keys()].sort((a, b) => b.length - a.length)
    for (const form of forms) {
      if (!new RegExp(`(?<![a-z0-9])${escapeRegExp(form)}(?![a-z0-9])`).test(rest)) continue
      const group = approxIndex.get(form)!
      for (const zone of group) {
        if (!exact.some((item) => item.id === zone.id) && !approxHits.some((item) => item.id === zone.id)) {
          approxHits.push(zone)
        }
      }
      rest = stripPhrase(rest, form)
      for (const word of form.split(/[^a-z0-9]+/)) {
        if (word.length >= 3) rest = stripPhrase(rest, word)
      }
    }
    const matched = exact.length + approxHits.length > 0
    const leftoverTokens = contentTokens(rest)
    if (matched && leftoverTokens.length > 0) {
      // Parcial no mesmo segmento («Axila cotovelo»): guarda o que casou + sobra.
      failedSegment = true
      for (const zone of exact) hit.add(zone.id)
      for (const zone of approxHits) {
        hit.add(zone.id)
        approx = true
      }
      if (leftoverWord == null) leftoverWord = leftoverTokens[0]!
      continue
    }
    if (!matched) {
      failedSegment = true
      if (leftoverWord == null) leftoverWord = contentTokens(part)[0] ?? null
      continue
    }
    for (const zone of exact) hit.add(zone.id)
    for (const zone of approxHits) {
      hit.add(zone.id)
      approx = true
    }
  }
  const kept = active.filter((z) => hit.has(z.id) || excised.ids.has(z.id))
  // Sobra após match (lista «e»/vírgula ou parcial no segmento) → pergunta;
  // mantém as zonas casadas (Paulo 10/11/2026 opção 2).
  if (failedSegment && leftoverWord) {
    return {
      zones: kept,
      approx,
      unrecognized: true,
      leftover: leftoverWord,
    }
  }
  if (failedSegment) {
    return { zones: [], approx: false, unrecognized: false, leftover: null }
  }
  return {
    zones: kept,
    approx,
    unrecognized: false,
    leftover: null,
  }
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
