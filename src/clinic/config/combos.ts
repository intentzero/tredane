/**
 * Combos de variantes (DEC-080). Um combo é um conjunto de 2 ou mais variantes do mesmo
 * serviço, sem misturar masculino e feminino, com preço próprio. Só a responsável grava (DEC-042).
 */
import type { Clock } from '../../db/clock'
import { COMBO_MIN_ZONES, COMBO_NAME_MAX } from '../catalog/combo'
import { ValidationError } from '../errors'
import { newId } from '../ids'
import type { ClinicDb } from '../store'
import { listZones, variantAudiencesConflict, type ZoneOwnerKind } from './zones'
import type { ComboSnapshot, ServiceComboInput, ServiceComboRow } from './types'

type ComboSql = {
  id: string
  tenant_id: string
  service_id: string
  name: string
  price_cents: number
  active: number
  sort_order: number
}

function mapCombo(row: ComboSql, zoneIds: string[]): ServiceComboRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    serviceId: row.service_id,
    name: row.name,
    priceCents: row.price_cents,
    zoneIds,
    active: row.active === 1,
    sortOrder: row.sort_order,
  }
}

export function listCombos(db: ClinicDb, tenantId: string, serviceId: string): ServiceComboRow[] {
  const rows = db.all<ComboSql>(
    `SELECT * FROM service_combos WHERE tenant_id = ? AND service_id = ?
     ORDER BY sort_order, name COLLATE NOCASE, id`,
    tenantId,
    serviceId,
  )
  if (rows.length === 0) return []
  const items = db.all<{ combo_id: string; zone_id: string }>(
    `SELECT i.combo_id, i.zone_id FROM service_combo_items i
     JOIN service_combos c ON c.id = i.combo_id AND c.tenant_id = i.tenant_id
     WHERE i.tenant_id = ? AND c.service_id = ?
     ORDER BY i.zone_id`,
    tenantId,
    serviceId,
  )
  const byCombo = new Map<string, string[]>()
  for (const item of items) {
    const list = byCombo.get(item.combo_id) ?? []
    list.push(item.zone_id)
    byCombo.set(item.combo_id, list)
  }
  return rows.map((row) => mapCombo(row, byCombo.get(row.id) ?? []))
}

function comboInUse(db: ClinicDb, tenantId: string, comboId: string): boolean {
  return Boolean(
    db.get<{ id: string }>(
      `SELECT id FROM visit_combo_snapshots WHERE tenant_id = ? AND combo_id = ? LIMIT 1`,
      tenantId,
      comboId,
    ),
  )
}

/**
 * Substitui o catálogo de combos do serviço. Combo que já entrou numa visita, proposta ou
 * cobrança não se apaga: só se desativa (a cópia fica).
 */
export function replaceCombos(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
  input: ServiceComboInput[],
  clock: Clock,
): ServiceComboRow[] {
  const zones = new Map(listZones(db, tenantId, serviceId).map((z) => [z.id, z]))
  const existing = listCombos(db, tenantId, serviceId)
  const existingById = new Map(existing.map((c) => [c.id, c]))
  const now = clock.nowMs()
  const names = new Set<string>()
  const kept = new Set<string>()

  input.forEach((item) => {
    const name = item.name.trim()
    if (!name || name.length > COMBO_NAME_MAX) {
      throw new ValidationError(
        'invalid_combo_name',
        `o nome do combo é obrigatório e tem no máximo ${COMBO_NAME_MAX} caracteres`,
      )
    }
    const key = name.toLocaleLowerCase('pt-BR')
    if (names.has(key)) {
      throw new ValidationError('duplicate_combo_name', 'dois combos com o mesmo nome', { name })
    }
    names.add(key)
    if (!Number.isInteger(item.priceCents) || item.priceCents <= 0) {
      throw new ValidationError('invalid_combo_price', 'o preço do combo é um valor maior que zero', {
        name,
      })
    }
    const ids = [...new Set(item.zoneIds)]
    if (ids.length !== item.zoneIds.length) {
      throw new ValidationError('combo_zone_repeated', 'cada variante só entra uma vez no combo', { name })
    }
    if (ids.length < COMBO_MIN_ZONES) {
      throw new ValidationError('combo_too_small', `o combo tem pelo menos ${COMBO_MIN_ZONES} variantes`, {
        name,
      })
    }
    const chosen = ids.map((id) => zones.get(id))
    if (chosen.some((z) => !z)) {
      throw new ValidationError(
        'combo_zone_not_on_service',
        'variante de outro serviço ou de outra clínica',
        { name },
      )
    }
    if (variantAudiencesConflict(chosen.filter((z): z is NonNullable<typeof z> => Boolean(z)))) {
      throw new ValidationError(
        'variant_audience_conflict',
        'o combo não mistura variante masculina e feminina',
        { name },
      )
    }
    if (item.id && !existingById.has(item.id)) {
      throw new ValidationError('combo_not_on_service', 'combo de outro serviço ou de outra clínica', {
        comboId: item.id,
      })
    }
  })

  // Trocar nomes entre combos não pode bater na restrição de nome único a meio caminho.
  db.run(
    `UPDATE service_combos SET name = id WHERE tenant_id = ? AND service_id = ?`,
    tenantId,
    serviceId,
  )

  for (const [index, item] of input.entries()) {
    const name = item.name.trim()
    const active = item.active === false ? 0 : 1
    const ids = [...new Set(item.zoneIds)]
    let id = item.id
    if (id) {
      db.run(
        `UPDATE service_combos SET name = ?, price_cents = ?, active = ?, sort_order = ?, updated_at = ?
         WHERE tenant_id = ? AND id = ?`,
        name,
        item.priceCents,
        active,
        index,
        now,
        tenantId,
        id,
      )
    } else {
      id = newId('combo')
      db.run(
        `INSERT INTO service_combos (
          id, tenant_id, service_id, name, price_cents, active, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        tenantId,
        serviceId,
        name,
        item.priceCents,
        active,
        index,
        now,
        now,
      )
    }
    kept.add(id)
    db.run(`DELETE FROM service_combo_items WHERE tenant_id = ? AND combo_id = ?`, tenantId, id)
    for (const zoneId of ids) {
      db.run(
        `INSERT INTO service_combo_items (tenant_id, combo_id, zone_id) VALUES (?, ?, ?)`,
        tenantId,
        id,
        zoneId,
      )
    }
  }

  for (const combo of existing) {
    if (kept.has(combo.id)) continue
    if (comboInUse(db, tenantId, combo.id)) {
      throw new ValidationError(
        'combo_in_use',
        'este combo já entrou numa visita e não pode ser removido; desative-o',
        { comboId: combo.id },
      )
    }
    removeCombo(db, tenantId, combo.id)
  }
  return listCombos(db, tenantId, serviceId)
}

function removeCombo(db: ClinicDb, tenantId: string, comboId: string): void {
  db.run(`DELETE FROM service_combo_items WHERE tenant_id = ? AND combo_id = ?`, tenantId, comboId)
  db.run(`DELETE FROM service_combos WHERE tenant_id = ? AND id = ?`, tenantId, comboId)
}

/**
 * Chamada quando variantes saem do catálogo: tira-as dos combos. Combo que fica com menos de
 * 2 variantes é apagado, ou desativado se já foi usado.
 */
export function pruneCombos(db: ClinicDb, tenantId: string, serviceId: string, now: number): void {
  const live = new Set(listZones(db, tenantId, serviceId).map((z) => z.id))
  for (const combo of listCombos(db, tenantId, serviceId)) {
    for (const zoneId of combo.zoneIds) {
      if (!live.has(zoneId)) {
        db.run(
          `DELETE FROM service_combo_items WHERE tenant_id = ? AND combo_id = ? AND zone_id = ?`,
          tenantId,
          combo.id,
          zoneId,
        )
      }
    }
    const remaining = combo.zoneIds.filter((id) => live.has(id)).length
    if (remaining >= COMBO_MIN_ZONES) continue
    if (comboInUse(db, tenantId, combo.id)) {
      db.run(
        `UPDATE service_combos SET active = 0, updated_at = ? WHERE tenant_id = ? AND id = ?`,
        now,
        tenantId,
        combo.id,
      )
    } else {
      removeCombo(db, tenantId, combo.id)
    }
  }
}

export function writeComboSnapshot(
  db: ClinicDb,
  tenantId: string,
  ownerKind: ZoneOwnerKind,
  ownerId: string,
  combo: ComboSnapshot | null,
): void {
  db.run(
    `DELETE FROM visit_combo_snapshots WHERE tenant_id = ? AND owner_kind = ? AND owner_id = ?`,
    tenantId,
    ownerKind,
    ownerId,
  )
  if (!combo) return
  db.run(
    `INSERT INTO visit_combo_snapshots (
      id, tenant_id, owner_kind, owner_id, combo_id, name, price_cents, list_price_cents
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    newId('vc'),
    tenantId,
    ownerKind,
    ownerId,
    combo.comboId,
    combo.name,
    combo.priceCents,
    combo.listPriceCents,
  )
}

export function readComboSnapshot(
  db: ClinicDb,
  tenantId: string,
  ownerKind: ZoneOwnerKind,
  ownerId: string,
): ComboSnapshot | null {
  const row = db.get<{
    combo_id: string | null
    name: string
    price_cents: number
    list_price_cents: number
  }>(
    `SELECT combo_id, name, price_cents, list_price_cents FROM visit_combo_snapshots
     WHERE tenant_id = ? AND owner_kind = ? AND owner_id = ?`,
    tenantId,
    ownerKind,
    ownerId,
  )
  if (!row) return null
  return {
    comboId: row.combo_id,
    name: row.name,
    priceCents: row.price_cents,
    listPriceCents: row.list_price_cents,
  }
}
