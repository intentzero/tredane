/**
 * Combos de variantes (DEC-080). Regras puras, partilhadas pelo servidor e pelo painel.
 * O servidor decide o preço; o painel só repete a conta para mostrar.
 */

export const COMBO_NAME_MAX = 60
export const COMBO_MIN_ZONES = 2

export type ComboZone = { id: string; priceCents: number | null; active: boolean }

export type ComboDef = {
  id: string
  name: string
  priceCents: number
  zoneIds: readonly string[]
  active: boolean
  sortOrder: number
}

export type AppliedCombo = {
  combo: ComboDef
  /** Soma das variantes do combo pelo preço normal. */
  listCents: number
  discountCents: number
}

export type VisitPrice = {
  /** Total a cobrar. Nulo se alguma variante escolhida não tem preço. */
  priceCents: number | null
  /** Total sem combo. */
  listPriceCents: number | null
  applied: AppliedCombo | null
}

/**
 * Um combo vale quando está ativo, todas as suas variantes foram escolhidas e estão em uso,
 * todas têm preço e o combo sai mais barato que a soma. Vale um combo por visita: o de
 * maior desconto (empate: a ordem do catálogo, depois o id).
 */
export function bestCombo(
  chosen: readonly ComboZone[],
  combos: readonly ComboDef[],
): AppliedCombo | null {
  const byId = new Map(chosen.map((z) => [z.id, z]))
  let best: AppliedCombo | null = null
  for (const combo of combos) {
    if (!combo.active || combo.zoneIds.length < COMBO_MIN_ZONES) continue
    let listCents = 0
    let ok = true
    for (const id of combo.zoneIds) {
      const zone = byId.get(id)
      if (!zone || !zone.active || zone.priceCents == null) {
        ok = false
        break
      }
      listCents += zone.priceCents
    }
    if (!ok) continue
    const discountCents = listCents - combo.priceCents
    if (discountCents <= 0) continue
    if (
      !best ||
      discountCents > best.discountCents ||
      (discountCents === best.discountCents &&
        (combo.sortOrder < best.combo.sortOrder ||
          (combo.sortOrder === best.combo.sortOrder && combo.id < best.combo.id)))
    ) {
      best = { combo, listCents, discountCents }
    }
  }
  return best
}

export function priceVisit(
  chosen: readonly ComboZone[],
  combos: readonly ComboDef[],
): VisitPrice {
  const priced = chosen.length > 0 && chosen.every((z) => z.priceCents != null)
  const listPriceCents = priced ? chosen.reduce((sum, z) => sum + (z.priceCents ?? 0), 0) : null
  const applied = bestCombo(chosen, combos)
  return {
    priceCents: listPriceCents == null ? null : listPriceCents - (applied?.discountCents ?? 0),
    listPriceCents,
    applied,
  }
}
