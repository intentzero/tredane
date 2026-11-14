/**
 * Combos de variantes (DEC-080). Regras puras, partilhadas pelo servidor e pelo painel.
 * O servidor decide o preço; o painel só repete a conta para mostrar.
 */

export const COMBO_NAME_MAX = 60
export const COMBO_MIN_ZONES = 2

/** Filtro «Para quem» no configurador de combo (Option A, Paulo 14/11/2026). */
export type ComboGenderFilter = 'feminino' | 'masculino' | 'ambos'

export type ComboZone = { id: string; priceCents: number | null; active: boolean }

/**
 * Nome sugerido a partir das zonas escolhidas (mesma junção da linha colapsada).
 * Só se usa quando o campo está vazio; não sobrescreve nome preenchido.
 */
export function suggestComboName(zoneNames: readonly string[]): string {
  const joined = zoneNames
    .map((n) => n.trim())
    .filter(Boolean)
    .join(' + ')
  if (!joined) return ''
  return joined.length <= COMBO_NAME_MAX ? joined : joined.slice(0, COMBO_NAME_MAX)
}

/** Zona visível/compatível com o filtro de género do combo. */
export function zoneFitsComboGender(
  audience: 'feminino' | 'masculino' | 'ambos',
  gender: ComboGenderFilter,
): boolean {
  if (gender === 'ambos') return audience === 'ambos'
  return audience === gender || audience === 'ambos'
}

/** Default ao criar combo: Feminino se houver; senão Masculino; senão Ambos. */
export function defaultComboGender(
  zones: readonly { audience: 'feminino' | 'masculino' | 'ambos' }[],
): ComboGenderFilter {
  if (zones.some((z) => z.audience === 'feminino')) return 'feminino'
  if (zones.some((z) => z.audience === 'masculino')) return 'masculino'
  return 'ambos'
}

/** Infere o filtro a partir das zonas já no combo (edição / reload). */
export function deriveComboGender(
  members: readonly { audience: 'feminino' | 'masculino' | 'ambos' }[],
): ComboGenderFilter {
  if (members.some((z) => z.audience === 'feminino')) return 'feminino'
  if (members.some((z) => z.audience === 'masculino')) return 'masculino'
  return 'ambos'
}

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
