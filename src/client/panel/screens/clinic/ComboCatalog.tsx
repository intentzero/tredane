import { useState } from 'react'
import {
  Button,
  Input,
  Label,
  Radio,
  RadioGroup,
  TextField,
  ToggleButton,
} from 'react-aria-components'
import { ChevronRight } from 'lucide-react'
import {
  COMBO_MIN_ZONES,
  defaultComboGender,
  suggestComboName,
  zoneFitsComboGender,
  type ComboGenderFilter,
} from '../../../../clinic/catalog/combo'
import { variantKindLabels } from '../../../../clinic/catalog/variant-kind'
import { ClinicCheck } from './ClinicCheck'
import { formatPriceCents, parsePriceToCents } from './format'
import { MoneyField } from './MoneyField'
import type { ZoneDraft } from './VariantCatalog'

export type ComboDraft = {
  key: string
  id?: string
  name: string
  price: string
  /** Chaves dos rascunhos de variante (`ZoneDraft.key`). */
  zoneKeys: string[]
  active: boolean
  /** Filtro «Para quem» (só UI; o servidor continua a validar M≠F). */
  gender: ComboGenderFilter
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

const GENDER_HELP: Record<ComboGenderFilter, string> = {
  feminino: 'Mostra zonas femininas e «Todos». Masculino fica de fora.',
  masculino: 'Mostra zonas masculinas e «Todos». Feminino fica de fora.',
  ambos: 'Só zonas «Todos» — o combo serve os dois públicos.',
}

const GENDER_DROP_TOAST = 'Saíram as zonas que não servem neste género.'

function comboZoneNames(combo: ComboDraft, zones: ZoneDraft[]): string[] {
  return combo.zoneKeys
    .map((key) => zones.find((z) => z.key === key)?.name)
    .filter((n): n is string => Boolean(n?.trim()))
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
  const [genderToastKey, setGenderToastKey] = useState<string | null>(null)
  const labels = variantKindLabels({ variantKind: singular, variantKindPlural: plural })
  const lower = labels.singular.toLocaleLowerCase('pt-BR')
  const pluralLower = labels.plural.toLocaleLowerCase('pt-BR')
  const usable = zones.filter((z) => z.name.trim())

  function patch(key: string, change: Partial<ComboDraft>) {
    onCombos((prev) => prev.map((row) => (row.key === key ? { ...row, ...change } : row)))
  }

  function add() {
    const key = crypto.randomUUID()
    onCombos((prev) => [
      ...prev,
      {
        key,
        name: '',
        price: '',
        zoneKeys: [],
        active: true,
        gender: defaultComboGender(usable),
      },
    ])
    setOpenKey(key)
    setGenderToastKey(null)
  }

  function setGender(combo: ComboDraft, gender: ComboGenderFilter) {
    if (gender === combo.gender) return
    const kept = combo.zoneKeys.filter((key) => {
      const z = zones.find((row) => row.key === key)
      return z ? zoneFitsComboGender(z.audience, gender) : false
    })
    const dropped = kept.length !== combo.zoneKeys.length
    patch(combo.key, { gender, zoneKeys: kept })
    setGenderToastKey(dropped ? combo.key : null)
  }

  function finish(combo: ComboDraft) {
    const name = combo.name.trim() || suggestComboName(comboZoneNames(combo, zones))
    if (name !== combo.name) {
      onCombos((prev) => prev.map((row) => (row.key === combo.key ? { ...row, name } : row)))
    }
    setOpenKey(null)
    setGenderToastKey(null)
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
            const names = comboZoneNames(combo, zones).join(' + ')
            const visible = usable.filter((z) => zoneFitsComboGender(z.audience, combo.gender))
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
                          placeholder={names ? `Sugestão: ${names}` : 'Opcional — ex.: Verão'}
                          onChange={(e) => patch(combo.key, { name: e.target.value })}
                        />
                      </TextField>
                      <MoneyField
                        label="Preço do combo"
                        value={combo.price}
                        onChange={(price) => patch(combo.key, { price })}
                      />
                    </div>
                    <RadioGroup
                      className="vc-combo-gender"
                      orientation="horizontal"
                      value={combo.gender}
                      onChange={(v) => {
                        if (v === 'feminino' || v === 'masculino' || v === 'ambos') {
                          setGender(combo, v)
                        }
                      }}
                    >
                      <Label className="vc-label">Para quem</Label>
                      <div className="vc-seg">
                        <Radio value="feminino" className="vc-seg-item">
                          Feminino
                        </Radio>
                        <Radio value="masculino" className="vc-seg-item">
                          Masculino
                        </Radio>
                        <Radio value="ambos" className="vc-seg-item">
                          Ambos
                        </Radio>
                      </div>
                      <p className="clinic-footnote">{GENDER_HELP[combo.gender]}</p>
                    </RadioGroup>
                    {genderToastKey === combo.key ? (
                      <p className="clinic-warn" role="status">
                        {GENDER_DROP_TOAST}
                      </p>
                    ) : null}
                    <div
                      className="vc-audience"
                      role="group"
                      aria-label={`O que entra no combo (${combo.zoneKeys.length})`}
                    >
                      <span>O que entra ({combo.zoneKeys.length})</span>
                      <div className="vc-chips">
                        {visible.map((z) => {
                          const on = combo.zoneKeys.includes(z.key)
                          const showTodos = z.audience === 'ambos' && combo.gender !== 'ambos'
                          return (
                            <ToggleButton
                              key={z.key}
                              className="vc-chip"
                              isSelected={on}
                              onChange={(selected) =>
                                patch(combo.key, {
                                  zoneKeys: selected
                                    ? [...combo.zoneKeys, z.key]
                                    : combo.zoneKeys.filter((key) => key !== z.key),
                                })
                              }
                            >
                              {z.name}
                              {showTodos ? <span className="vc-chip-mini">Todos</span> : null}
                            </ToggleButton>
                          )
                        })}
                      </div>
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
                          setGenderToastKey(null)
                        }}
                      >
                        Remover
                      </Button>
                      <Button className="panel-btn panel-btn-secondary" onPress={() => finish(combo)}>
                        Pronto
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button className="vc-row" onPress={() => setOpenKey(combo.key)}>
                    <span className="vc-row-copy">
                      <strong>{combo.name || names || 'Sem nome'}</strong>
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
