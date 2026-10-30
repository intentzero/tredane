import { useState } from 'react'
import { Button, Input, Label, NumberField, Radio, RadioGroup, TextField } from 'react-aria-components'
import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react'
import { variantKindLabels } from '../../../../clinic/catalog/variant-kind'
import { ClinicCheck } from './ClinicCheck'
import { formatPriceCents, parsePriceToCents } from './format'

export type VariantAudience = 'feminino' | 'masculino' | 'ambos'

export type ZoneDraft = {
  key: string
  id?: string
  name: string
  durationMinutes: number
  price: string
  audience: VariantAudience
  active: boolean
}

const AUDIENCE_LABEL: Record<VariantAudience, string> = {
  ambos: 'Ambos',
  feminino: 'Feminino',
  masculino: 'Masculino',
}

type Props = {
  singular: string
  plural: string
  pluralTouched: boolean
  onSingular: (value: string) => void
  onPlural: (value: string) => void
  zones: ZoneDraft[]
  onZones: (update: (prev: ZoneDraft[]) => ZoneDraft[]) => void
  /** Duração e preço da linha, copiados para a primeira variante. */
  seed: { durationMinutes: number; price: string }
}

/** Catálogo de variantes do serviço (DEC-078 / DEC-079): uma linha por variante. */
export function VariantCatalog({
  singular,
  plural,
  pluralTouched,
  onSingular,
  onPlural,
  zones,
  onZones,
  seed,
}: Props) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const labels = variantKindLabels({ variantKind: singular, variantKindPlural: plural })
  const lower = labels.singular.toLocaleLowerCase('pt-BR')

  function patch(key: string, change: Partial<ZoneDraft>) {
    onZones((prev) => prev.map((row) => (row.key === key ? { ...row, ...change } : row)))
  }

  function move(key: string, delta: -1 | 1) {
    onZones((prev) => {
      const from = prev.findIndex((row) => row.key === key)
      const to = from + delta
      if (from < 0 || to < 0 || to >= prev.length) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item!)
      return next
    })
  }

  function add() {
    const name = newName.trim()
    if (!name) return
    const key = crypto.randomUUID()
    onZones((prev) => [
      ...prev,
      {
        key,
        name,
        durationMinutes: prev.length === 0 ? seed.durationMinutes : 15,
        price: prev.length === 0 ? seed.price : '',
        audience: 'ambos',
        active: true,
      },
    ])
    setNewName('')
    setOpenKey(key)
  }

  return (
    <div className="vc">
      <div className="vc-kind">
        <div className="clinic-field-row">
          <TextField className="clinic-field">
            <Label>Nome no singular</Label>
            <Input
              autoComplete="off"
              value={singular}
              placeholder="Ex.: Zona"
              onChange={(e) => onSingular(e.target.value)}
            />
          </TextField>
          <TextField className="clinic-field">
            <Label>No plural</Label>
            <Input
              autoComplete="off"
              value={plural}
              placeholder="Ex.: Zonas"
              onChange={(e) => onPlural(e.target.value)}
            />
          </TextField>
        </div>
        <p className="clinic-footnote">
          Na tela: «{labels.count(1)}», «{labels.count(2)}», «Adicionar{' '}
          {lower}».{pluralTouched ? '' : ' O plural é sugerido; corrija se precisar.'}
        </p>
      </div>

      <ul className="vc-list" aria-label={labels.plural}>
        {zones.map((z, index) => {
          const open = openKey === z.key
          return (
            <li key={z.key} className="vc-item" data-open={open || undefined} data-off={!z.active || undefined}>
              {open ? (
                <div className="vc-edit">
                  <div className="clinic-field-row">
                    <TextField className="clinic-field">
                      <Label>Nome</Label>
                      <Input
                        value={z.name}
                        onChange={(e) => patch(z.key, { name: e.target.value })}
                      />
                    </TextField>
                    <TextField className="clinic-field">
                      <Label>Preço</Label>
                      <Input
                        value={z.price}
                        placeholder="Sem preço"
                        inputMode="decimal"
                        onChange={(e) => patch(z.key, { price: e.target.value })}
                      />
                    </TextField>
                  </div>
                  <NumberField
                    className="clinic-field"
                    minValue={1}
                    maxValue={24 * 60}
                    step={1}
                    formatOptions={{ maximumFractionDigits: 0 }}
                    value={z.durationMinutes}
                    onChange={(value) => {
                      if (!Number.isInteger(value) || value < 1 || value > 24 * 60) return
                      patch(z.key, { durationMinutes: value })
                    }}
                  >
                    <Label>Duração (min)</Label>
                    <Input />
                  </NumberField>
                  <RadioGroup
                    className="vc-audience"
                    aria-label={`Gênero de ${z.name || lower}`}
                    value={z.audience}
                    onChange={(v) => {
                      if (v === 'feminino' || v === 'masculino' || v === 'ambos') {
                        patch(z.key, { audience: v })
                      }
                    }}
                  >
                    <Label>Gênero</Label>
                    <div className="vc-seg">
                      {(['ambos', 'feminino', 'masculino'] as const).map((a) => (
                        <Radio key={a} value={a} className="vc-seg-item">
                          {AUDIENCE_LABEL[a]}
                        </Radio>
                      ))}
                    </div>
                  </RadioGroup>
                  <ClinicCheck
                    className="clinic-check"
                    isSelected={z.active}
                    onChange={(selected) => patch(z.key, { active: selected })}
                  >
                    Em uso
                  </ClinicCheck>
                  <div className="vc-actions">
                    <Button
                      className="panel-btn panel-btn-ghost"
                      aria-label={`Subir ${z.name || lower}`}
                      isDisabled={index === 0}
                      onPress={() => move(z.key, -1)}
                    >
                      <ArrowUp aria-hidden size={16} />
                    </Button>
                    <Button
                      className="panel-btn panel-btn-ghost"
                      aria-label={`Descer ${z.name || lower}`}
                      isDisabled={index === zones.length - 1}
                      onPress={() => move(z.key, 1)}
                    >
                      <ArrowDown aria-hidden size={16} />
                    </Button>
                    <span className="vc-spacer" />
                    <Button
                      className="panel-btn panel-btn-ghost vc-remove"
                      onPress={() => {
                        onZones((prev) => prev.filter((row) => row.key !== z.key))
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
                <Button className="vc-row" onPress={() => setOpenKey(z.key)}>
                  <span className="vc-row-copy">
                    <strong>{z.name || 'Sem nome'}</strong>
                    <span className="vc-row-meta">
                      <span className="vc-pill" data-audience={z.audience}>
                        {AUDIENCE_LABEL[z.audience]}
                      </span>
                      <span>{z.durationMinutes} min</span>
                      {!z.active ? <span>Fora de uso</span> : null}
                    </span>
                  </span>
                  <span className="vc-price">
                    {z.price.trim() ? formatPriceCents(parsePriceToCents(z.price)) : 'Sem preço'}
                  </span>
                  <ChevronRight aria-hidden size={18} />
                </Button>
              )}
            </li>
          )
        })}
      </ul>

      <div className="vc-add">
        <TextField className="clinic-field" aria-label={`Adicionar ${lower}`}>
          <Input
            autoComplete="off"
            value={newName}
            placeholder={`Adicionar ${lower}… (ex.: Virilha)`}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
          />
        </TextField>
        <Button className="panel-btn panel-btn-secondary" isDisabled={!newName.trim()} onPress={add}>
          Adicionar
        </Button>
      </div>
      <p className="clinic-footnote">
        Várias entram no mesmo horário, sem misturar masculino e feminino. Ambos combina com os dois.
      </p>
    </div>
  )
}
