import { useState } from 'react'
import { Button, Input, Label, NumberField, Radio, RadioGroup, TextField } from 'react-aria-components'
import { ClinicSheet } from './ClinicSheet'
import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react'
import { variantKindLabels } from '../../../../clinic/catalog/variant-kind'
import { ClinicCheck } from './ClinicCheck'
import { SynonymsField } from './SynonymsField'
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
  /** DEC-110 — nomes populares da variante. */
  synonyms: string[]
}

const AUDIENCE_LABEL: Record<VariantAudience, string> = {
  ambos: 'Ambos',
  feminino: 'Feminino',
  masculino: 'Masculino',
}

const DURATION_PRESETS = [30, 45, 60, 90]

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
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkDuration, setBulkDuration] = useState(60)
  const [bulkPrice, setBulkPrice] = useState('')
  const labels = variantKindLabels({ variantKind: singular, variantKindPlural: plural })
  const lower = labels.singular.toLocaleLowerCase('pt-BR')

  const editingIndex = zones.findIndex((z) => z.key === openKey)
  const editing = editingIndex >= 0 ? zones[editingIndex]! : null
  const activeZones = zones.filter((z) => z.active)
  const first = activeZones[0]
  const uniform =
    first && activeZones.length > 1 &&
    activeZones.every(
      (z) => z.durationMinutes === first.durationMinutes && z.price.trim() === first.price.trim(),
    )
      ? { durationMinutes: first.durationMinutes, priceCents: parsePriceToCents(first.price) }
      : null

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
        synonyms: [],
      },
    ])
    setNewName('')
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

      {zones.length > 1 ? (
        <div className="vc-bulk">
          {uniform ? (
            <p className="vc-summary">
              Todos com <strong>{uniform.durationMinutes} min</strong> e{' '}
              <strong>{uniform.priceCents != null ? formatPriceCents(uniform.priceCents) : 'sem preço'}</strong>.
            </p>
          ) : null}
          {bulkOpen ? (
            <div className="vc-bulk-form">
              <NumberField
                className="clinic-field"
                minValue={1}
                maxValue={24 * 60}
                step={1}
                formatOptions={{ maximumFractionDigits: 0 }}
                value={bulkDuration}
                onChange={(v) => {
                  if (Number.isInteger(v) && v >= 1 && v <= 24 * 60) setBulkDuration(v)
                }}
              >
                <Label>Duração de todos (min)</Label>
                <Input />
              </NumberField>
              <TextField className="clinic-field">
                <Label>Preço de todos</Label>
                <Input
                  value={bulkPrice}
                  inputMode="decimal"
                  placeholder="Sem preço"
                  onChange={(e) => setBulkPrice(e.target.value)}
                />
              </TextField>
              <div className="vc-actions">
                <Button className="panel-btn panel-btn-ghost" onPress={() => setBulkOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  className="panel-btn panel-btn-primary"
                  onPress={() => {
                    onZones((prev) =>
                      prev.map((row) => ({ ...row, durationMinutes: bulkDuration, price: bulkPrice })),
                    )
                    setBulkOpen(false)
                  }}
                >
                  Aplicar a todos
                </Button>
              </div>
            </div>
          ) : (
            <Button
              className="panel-btn panel-btn-ghost"
              onPress={() => {
                setBulkDuration(first?.durationMinutes ?? 60)
                setBulkPrice(first?.price ?? '')
                setBulkOpen(true)
              }}
            >
              Alterar todos
            </Button>
          )}
        </div>
      ) : null}

      <ul className="vc-list" aria-label={labels.plural}>
        {zones.map((z) => {
          const priceCents = parsePriceToCents(z.price)
          return (
            <li key={z.key} className="vc-item" data-off={!z.active || undefined}>
              <Button className="vc-row" onPress={() => setOpenKey(z.key)}>
                <span className="vc-row-copy">
                  <strong>{z.name || 'Sem nome'}</strong>
                  <span className="vc-row-meta">
                    {z.audience !== 'ambos' ? (
                      <span className="vc-pill" data-audience={z.audience}>
                        {AUDIENCE_LABEL[z.audience]}
                      </span>
                    ) : null}
                    <span>{z.durationMinutes} min</span>
                    {!z.active ? <span>Fora de uso</span> : null}
                  </span>
                </span>
                <span className="vc-price">
                  {priceCents != null ? formatPriceCents(priceCents) : 'Sem preço'}
                </span>
                <ChevronRight aria-hidden size={18} />
              </Button>
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
      <ClinicSheet
        isOpen={editing != null}
        onOpenChange={(o) => {
          if (!o) setOpenKey(null)
        }}
        title={`Editar ${lower}`}
      >
        {editing ? (
          <div className="vc-edit">
            <TextField className="clinic-field">
              <Label>Nome</Label>
              <Input value={editing.name} onChange={(e) => patch(editing.key, { name: e.target.value })} />
            </TextField>
            <div className="vc-audience">
              <span>Duração</span>
              <div className="vc-pills" role="group" aria-label="Duração rápida">
                {DURATION_PRESETS.map((m) => (
                  <Button
                    key={m}
                    className="vc-pill-btn"
                    data-selected={editing.durationMinutes === m || undefined}
                    aria-pressed={editing.durationMinutes === m}
                    onPress={() => patch(editing.key, { durationMinutes: m })}
                  >
                    {m} min
                  </Button>
                ))}
              </div>
            </div>
            <NumberField
              className="clinic-field"
              minValue={1}
              maxValue={24 * 60}
              step={1}
              formatOptions={{ maximumFractionDigits: 0 }}
              value={editing.durationMinutes}
              onChange={(value) => {
                if (!Number.isInteger(value) || value < 1 || value > 24 * 60) return
                patch(editing.key, { durationMinutes: value })
              }}
            >
              <Label>Duração (min)</Label>
              <Input />
            </NumberField>
            <TextField className="clinic-field">
              <Label>Preço</Label>
              <Input
                value={editing.price}
                placeholder="Sem preço"
                inputMode="decimal"
                onChange={(e) => patch(editing.key, { price: e.target.value })}
              />
            </TextField>
            <RadioGroup
              className="vc-audience"
              aria-label={`Gênero de ${editing.name || lower}`}
              value={editing.audience}
              onChange={(v) => {
                if (v === 'feminino' || v === 'masculino' || v === 'ambos') {
                  patch(editing.key, { audience: v })
                }
              }}
            >
              <Label>Para quem</Label>
              <div className="vc-seg">
                {(['ambos', 'feminino', 'masculino'] as const).map((a) => (
                  <Radio key={a} value={a} className="vc-seg-item">
                    {a === 'ambos' ? 'Todos' : AUDIENCE_LABEL[a]}
                  </Radio>
                ))}
              </div>
              <span className="clinic-footnote">
                Só mude se for só para um público. A lista mostra o selo quando não é «Todos».
              </span>
            </RadioGroup>
            <ClinicCheck
              className="clinic-check"
              isSelected={editing.active}
              onChange={(selected) => patch(editing.key, { active: selected })}
            >
              Em uso
            </ClinicCheck>
            <SynonymsField
              label="Sinônimos"
              value={editing.synonyms}
              onChange={(synonyms) => patch(editing.key, { synonyms })}
              placeholder="Adicionar…"
              hint="Só ajudam a IA a entender o pedido; a cliente vê o nome do catálogo."
            />
            <div className="vc-actions">
              <Button
                className="panel-btn panel-btn-ghost"
                aria-label={`Subir ${editing.name || lower}`}
                isDisabled={editingIndex === 0}
                onPress={() => move(editing.key, -1)}
              >
                <ArrowUp aria-hidden size={16} />
              </Button>
              <Button
                className="panel-btn panel-btn-ghost"
                aria-label={`Descer ${editing.name || lower}`}
                isDisabled={editingIndex === zones.length - 1}
                onPress={() => move(editing.key, 1)}
              >
                <ArrowDown aria-hidden size={16} />
              </Button>
              <span className="vc-spacer" />
              <Button
                className="panel-btn panel-btn-ghost vc-remove"
                onPress={() => {
                  const key = editing.key
                  setOpenKey(null)
                  onZones((prev) => prev.filter((row) => row.key !== key))
                }}
              >
                Remover
              </Button>
              <Button className="panel-btn panel-btn-primary" onPress={() => setOpenKey(null)}>
                Pronto
              </Button>
            </div>
          </div>
        ) : null}
      </ClinicSheet>

      <p className="clinic-footnote">
        Quando várias entram na mesma visita, não se mistura masculino com feminino. «Ambos» serve para os dois.
      </p>
    </div>
  )
}
