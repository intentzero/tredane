import { useState } from 'react'
import { Button, Input, Label, TextField, ToggleButton } from 'react-aria-components'
import { ChevronRight } from 'lucide-react'
import { COMBO_MIN_ZONES } from '../../../../clinic/catalog/combo'
import { variantKindLabels } from '../../../../clinic/catalog/variant-kind'
import { ClinicCheck } from './ClinicCheck'
import { formatPriceCents, parsePriceToCents } from './format'
import type { ZoneDraft } from './VariantCatalog'

export type ComboDraft = {
  key: string
  id?: string
  name: string
  price: string
  /** Chaves dos rascunhos de variante (`ZoneDraft.key`). */
  zoneKeys: string[]
  active: boolean
}

type Props = {
  singular: string
  plural: string
  zones: ZoneDraft[]
  combos: ComboDraft[]
  onCombos: (update: (prev: ComboDraft[]) => ComboDraft[]) => void
}

type Facts = {
  listCents: number | null
  priceCents: number | null
  saveCents: number | null
  warn: string | null
}

function factsOf(combo: ComboDraft, zones: ZoneDraft[], lower: string, pluralLower: string): Facts {
  const members = combo.zoneKeys
    .map((key) => zones.find((z) => z.key === key))
    .filter((z): z is ZoneDraft => Boolean(z))
  const priced = members.length > 0 && members.every((z) => z.price.trim() !== '')
  const listCents = priced
    ? members.reduce((sum, z) => sum + (parsePriceToCents(z.price) ?? 0), 0)
    : null
  const priceCents = combo.price.trim() ? parsePriceToCents(combo.price) : null
  const saveCents = listCents != null && priceCents != null ? listCents - priceCents : null
  let warn: string | null = null
  if (members.length < COMBO_MIN_ZONES) warn = `Escolha pelo menos ${COMBO_MIN_ZONES} ${pluralLower}.`
  else if (members.some((z) => !z.active)) warn = `Inclui ${lower} fora de uso: o combo não aparece para marcar.`
  else if (listCents == null) warn = `Toda ${lower} do combo precisa de preço.`
  else if (priceCents == null || priceCents <= 0) warn = 'Defina o preço do combo.'
  else if (saveCents != null && saveCents <= 0) warn = 'O combo não sai mais barato que a soma.'
  return { listCents, priceCents, saveCents, warn }
}

/** Combos de variantes (DEC-080): conjuntos com preço próprio, aplicados sozinhos na visita. */
export function ComboCatalog({ singular, plural, zones, combos, onCombos }: Props) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const labels = variantKindLabels({ variantKind: singular, variantKindPlural: plural })
  const lower = labels.singular.toLocaleLowerCase('pt-BR')
  const pluralLower = labels.plural.toLocaleLowerCase('pt-BR')
  const usable = zones.filter((z) => z.name.trim())

  function patch(key: string, change: Partial<ComboDraft>) {
    onCombos((prev) => prev.map((row) => (row.key === key ? { ...row, ...change } : row)))
  }

  function add() {
    const key = crypto.randomUUID()
    onCombos((prev) => [...prev, { key, name: '', price: '', zoneKeys: [], active: true }])
    setOpenKey(key)
  }

  return (
    <section className="vc" aria-labelledby="svc-combos">
      <div className="vc-head">
        <div className="vc-kind">
          <h3 id="svc-combos" className="clinic-section-title">
            Combos
          </h3>
          <p className="clinic-footnote">
            Conjuntos de {pluralLower} com preço próprio, numa visita só. O combo entra sozinho quando
            todas as {pluralLower} dele são escolhidas; as outras saem pelo preço normal.
          </p>
        </div>
        <Button className="panel-btn panel-btn-secondary" isDisabled={usable.length < COMBO_MIN_ZONES} onPress={add}>
          Criar combo
        </Button>
      </div>

      {combos.length > 0 ? (
        <ul className="vc-list" aria-label="Combos">
          {combos.map((combo) => {
            const open = openKey === combo.key
            const facts = factsOf(combo, zones, lower, pluralLower)
            const names = combo.zoneKeys
              .map((key) => zones.find((z) => z.key === key)?.name)
              .filter(Boolean)
              .join(' + ')
            const hasMasculine = combo.zoneKeys.some(
              (key) => zones.find((z) => z.key === key)?.audience === 'masculino',
            )
            const hasFeminine = combo.zoneKeys.some(
              (key) => zones.find((z) => z.key === key)?.audience === 'feminino',
            )
            return (
              <li
                key={combo.key}
                className="vc-item"
                data-open={open || undefined}
                data-off={!combo.active || undefined}
              >
                {open ? (
                  <div className="vc-edit">
                    <div className="clinic-field-row">
                      <TextField className="clinic-field">
                        <Label>Nome do combo</Label>
                        <Input
                          value={combo.name}
                          placeholder="Ex.: Verão"
                          onChange={(e) => patch(combo.key, { name: e.target.value })}
                        />
                      </TextField>
                      <TextField className="clinic-field">
                        <Label>Preço do combo</Label>
                        <Input
                          value={combo.price}
                          inputMode="decimal"
                          placeholder="R$ 0,00"
                          onChange={(e) => patch(combo.key, { price: e.target.value })}
                        />
                      </TextField>
                    </div>
                    <div className="vc-audience" role="group" aria-label={`O que entra no combo (${combo.zoneKeys.length})`}>
                      <span>O que entra ({combo.zoneKeys.length})</span>
                      <div className="vc-chips">
                        {usable.map((z) => {
                          const on = combo.zoneKeys.includes(z.key)
                          const blocked =
                            !on &&
                            ((hasMasculine && z.audience === 'feminino') ||
                              (hasFeminine && z.audience === 'masculino'))
                          return (
                            <ToggleButton
                              key={z.key}
                              className="vc-chip"
                              isSelected={on}
                              isDisabled={blocked}
                              onChange={(selected) =>
                                patch(combo.key, {
                                  zoneKeys: selected
                                    ? [...combo.zoneKeys, z.key]
                                    : combo.zoneKeys.filter((key) => key !== z.key),
                                })
                              }
                            >
                              {z.name}
                            </ToggleButton>
                          )
                        })}
                      </div>
                      <span className="clinic-footnote">Feminino e masculino não entram no mesmo combo.</span>
                    </div>
                    <dl className="vc-sums">
                      <div>
                        <dt>Separadas</dt>
                        <dd>{facts.listCents == null ? '—' : formatPriceCents(facts.listCents)}</dd>
                      </div>
                      <div>
                        <dt>No combo</dt>
                        <dd>{facts.priceCents == null ? '—' : formatPriceCents(facts.priceCents)}</dd>
                      </div>
                      <div>
                        <dt>Economia</dt>
                        <dd>
                          {facts.saveCents != null && facts.saveCents > 0
                            ? formatPriceCents(facts.saveCents)
                            : '—'}
                        </dd>
                      </div>
                    </dl>
                    {facts.warn ? (
                      <p className="clinic-warn" role="status">
                        {facts.warn}
                      </p>
                    ) : null}
                    <ClinicCheck
                      className="clinic-check"
                      isSelected={combo.active}
                      onChange={(selected) => patch(combo.key, { active: selected })}
                    >
                      Em uso
                    </ClinicCheck>
                    <div className="vc-actions">
                      <span className="vc-spacer" />
                      <Button
                        className="panel-btn panel-btn-ghost vc-remove"
                        onPress={() => {
                          onCombos((prev) => prev.filter((row) => row.key !== combo.key))
                          setOpenKey(null)
                        }}
                      >
                        Remover
                      </Button>
                      <Button className="panel-btn panel-btn-secondary" onPress={() => setOpenKey(null)}>
                        Pronto
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button className="vc-row" onPress={() => setOpenKey(combo.key)}>
                    <span className="vc-row-copy">
                      <strong>{combo.name || 'Sem nome'}</strong>
                      <span className="vc-row-meta">
                        <span>{names || 'Nada escolhido'}</span>
                        {!combo.active ? <span>Fora de uso</span> : null}
                        {facts.warn && combo.active ? <span>{facts.warn}</span> : null}
                      </span>
                    </span>
                    <span className="vc-price">
                      {facts.priceCents == null ? 'Sem preço' : formatPriceCents(facts.priceCents)}
                      {facts.saveCents != null && facts.saveCents > 0 ? (
                        <span className="vc-save">economia {formatPriceCents(facts.saveCents)}</span>
                      ) : null}
                    </span>
                    <ChevronRight aria-hidden size={18} />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
