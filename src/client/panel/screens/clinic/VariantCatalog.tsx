import { useState } from 'react'
import { Button, Checkbox, Input, Label, NumberField, TextField } from 'react-aria-components'
import { ClinicSheet } from './ClinicSheet'
import { ArrowDown, ArrowUp, Check, ChevronRight, TriangleAlert } from 'lucide-react'
import {
  suggestVariantKindSingular,
  variantKindLabels,
} from '../../../../clinic/catalog/variant-kind'
import { SynonymsField } from './SynonymsField'
import { formatPriceCents, parsePriceToCents } from './format'
import {
  foldWord,
  groupInactive,
  groupPriceLine,
  groupSynonyms,
  groupZones,
  type VariantGroup,
} from './variantGroups'

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
  ambos: 'Todos',
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
  /** DEC-176 — textos e exemplos dependem do modo. */
  selection: 'uma' | 'varias'
  /** Onde mais a palavra está, vista a partir do grupo `groupKey`. */
  takenBy?: (groupKey: string, word: string) => string | null
}

/** Cópia de trabalho do grupo aberto na folha; só entra no rascunho com «Aplicar». */
type GroupEdit = {
  groupKey: string
  originalKeys: string[]
  name: string
  synonyms: string[]
  members: ZoneDraft[]
  error: string | null
  confirmRemove: boolean
}

/**
 * Catálogo de opções do serviço (DEC-078 / DEC-079), agrupado pelo nome
 * (DEC-176): uma linha por nome, com o tempo e o preço de cada público.
 */
export function VariantCatalog({
  singular,
  plural,
  pluralTouched,
  onSingular,
  onPlural,
  zones,
  onZones,
  seed,
  selection,
  takenBy,
}: Props) {
  const [edit, setEdit] = useState<GroupEdit | null>(null)
  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkDuration, setBulkDuration] = useState(60)
  const [bulkPrice, setBulkPrice] = useState('')
  const labels = variantKindLabels({ variantKind: singular, variantKindPlural: plural })
  const lower = labels.singular.toLocaleLowerCase('pt-BR')
  const groups = groupZones(zones)
  const kindClash =
    singular.trim() !== '' && foldWord(singular) === foldWord(plural)
  const singularFix = kindClash ? suggestVariantKindSingular(plural) : ''

  const activeZones = zones.filter((z) => z.active)
  const first = activeZones[0]
  const uniform =
    first && activeZones.length > 1 &&
    activeZones.every(
      (z) => z.durationMinutes === first.durationMinutes && z.price.trim() === first.price.trim(),
    )
      ? { durationMinutes: first.durationMinutes, priceCents: parsePriceToCents(first.price) }
      : null

  function open(group: VariantGroup) {
    setEdit({
      groupKey: group.key,
      originalKeys: group.members.map((m) => m.key),
      name: group.name,
      synonyms: groupSynonyms(group),
      members: group.members.map((m) => ({ ...m })),
      error: null,
      confirmRemove: false,
    })
  }

  function patchEdit(change: Partial<GroupEdit>) {
    setEdit((cur) => (cur ? { ...cur, ...change } : cur))
  }

  function patchMember(key: string, change: Partial<ZoneDraft>) {
    setEdit((cur) =>
      cur
        ? {
            ...cur,
            error: null,
            members: cur.members.map((m) => (m.key === key ? { ...m, ...change } : m)),
          }
        : cur,
    )
  }

  /** Liga ou desliga um público. Desligar uma variante gravada só a tira de uso. */
  function toggleAudience(audience: 'feminino' | 'masculino', on: boolean) {
    setEdit((cur) => {
      if (!cur) return cur
      const existing = cur.members.find((m) => m.audience === audience)
      if (existing) {
        if (on) {
          return { ...cur, error: null, members: cur.members.map((m) => (m === existing ? { ...m, active: true } : m)) }
        }
        return existing.id
          ? { ...cur, error: null, members: cur.members.map((m) => (m === existing ? { ...m, active: false } : m)) }
          : { ...cur, error: null, members: cur.members.filter((m) => m !== existing) }
      }
      if (!on) return cur
      const sibling = cur.members[0]
      return {
        ...cur,
        error: null,
        members: [
          ...cur.members,
          {
            key: crypto.randomUUID(),
            name: cur.name,
            durationMinutes: sibling?.durationMinutes ?? 15,
            price: sibling?.price ?? '',
            audience,
            active: true,
            synonyms: cur.synonyms,
          },
        ].sort((a, b) => (a.audience === 'feminino' ? -1 : b.audience === 'feminino' ? 1 : 0)),
      }
    })
  }

  /** «Todos» → Feminino + Masculino; a variante gravada fica como Feminino. */
  function splitByAudience() {
    setEdit((cur) => {
      if (!cur || cur.members.length !== 1 || cur.members[0]!.audience !== 'ambos') return cur
      const only = cur.members[0]!
      return {
        ...cur,
        members: [
          { ...only, audience: 'feminino' },
          { ...only, key: crypto.randomUUID(), id: undefined, audience: 'masculino' },
        ],
      }
    })
  }

  function apply() {
    if (!edit) return
    const name = edit.name.trim()
    if (!name) {
      patchEdit({ error: `Dê um nome a esta ${lower}.` })
      return
    }
    const clash = groups.find((g) => g.key !== edit.groupKey && g.key === foldWord(name))
    if (clash) {
      patchEdit({ error: `Já existe «${clash.name}» nesta lista. Abra essa linha para mudar.` })
      return
    }
    const members = edit.members.map((m) => ({ ...m, name, synonyms: edit.synonyms }))
    const original = new Set(edit.originalKeys)
    onZones((prev) => {
      const next: ZoneDraft[] = []
      let placed = false
      for (const row of prev) {
        if (!original.has(row.key)) {
          next.push(row)
          continue
        }
        if (!placed) {
          next.push(...members)
          placed = true
        }
      }
      if (!placed) next.push(...members)
      return next
    })
    setEdit(null)
  }

  function removeGroup() {
    if (!edit) return
    const original = new Set(edit.originalKeys)
    onZones((prev) => prev.filter((row) => !original.has(row.key)))
    setEdit(null)
  }

  function moveGroup(groupKey: string, delta: -1 | 1) {
    onZones((prev) => {
      const list = groupZones(prev)
      const from = list.findIndex((g) => g.key === groupKey)
      const to = from + delta
      if (from < 0 || to < 0 || to >= list.length) return prev
      const [item] = list.splice(from, 1)
      list.splice(to, 0, item!)
      const order = new Map(list.map((g, i) => [g.key, i]))
      return [...prev].sort(
        (a, b) => (order.get(foldWord(a.name)) ?? 0) - (order.get(foldWord(b.name)) ?? 0),
      )
    })
  }

  function add() {
    const name = newName.trim()
    if (!name) return
    const clash = groups.find((g) => g.key === foldWord(name))
    if (clash) {
      setAddError(`«${clash.name}» já está na lista. Toque nela para mudar o público ou o preço.`)
      return
    }
    setAddError(null)
    onZones((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
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

  const editIndex = edit ? groups.findIndex((g) => g.key === edit.groupKey) : -1
  const split = edit?.members.some((m) => m.audience !== 'ambos') ?? false

  return (
    <div className="vc">
      <div className="vc-kind" role="group" aria-labelledby="vc-kind-t">
        <span id="vc-kind-t" className="vc-label">
          Como se chama cada opção
        </span>
        <div className="clinic-field-row">
          <TextField className="clinic-field">
            <Label>
              Uma<span className="visually-hidden"> (nome no singular)</span>
            </Label>
            <Input
              autoComplete="off"
              value={singular}
              placeholder="Ex.: Zona"
              data-invalid={kindClash || undefined}
              onChange={(e) => onSingular(e.target.value)}
            />
          </TextField>
          <TextField className="clinic-field">
            <Label>
              Várias<span className="visually-hidden"> (nome no plural)</span>
            </Label>
            <Input
              autoComplete="off"
              value={plural}
              placeholder="Ex.: Zonas"
              onChange={(e) => onPlural(e.target.value)}
            />
          </TextField>
        </div>
        {kindClash ? (
          <p className="vc-kind-warn" role="alert">
            <span>
              «{plural.trim()}» nos dois dá «1 {plural.trim().toLocaleLowerCase('pt-BR')}».
              {singularFix && foldWord(singularFix) !== foldWord(plural)
                ? ` Para uma, use «${singularFix}».`
                : ' Escreva o nome de uma só.'}
            </span>
            {singularFix && foldWord(singularFix) !== foldWord(plural) ? (
              <Button className="vc-kind-fix" onPress={() => onSingular(singularFix)}>
                Usar «{singularFix}»
              </Button>
            ) : null}
          </p>
        ) : (
          <p className="clinic-footnote">
            Na tela: «{labels.count(1)}», «{labels.count(2)}».
            {pluralTouched ? '' : ' O plural é sugerido; corrija se precisar.'}
          </p>
        )}
      </div>

      <div className="vc-head">
        <h3 className="vc-title">
          {labels.plural} · {groups.length}
        </h3>
        {zones.length > 1 && !bulkOpen ? (
          <Button
            className="panel-link-btn"
            onPress={() => {
              setBulkDuration(first?.durationMinutes ?? 60)
              setBulkPrice(first?.price ?? '')
              setBulkOpen(true)
            }}
          >
            Mudar todos…
          </Button>
        ) : null}
      </div>
      <p className="clinic-footnote vc-mode-note">
        {selection === 'varias'
          ? 'A cliente pode juntar várias. Na mesma visita não se mistura feminino com masculino; «Todos» serve para os dois.'
          : 'A cliente escolhe uma por visita.'}
      </p>
      {uniform && !bulkOpen ? (
        <p className="vc-summary">
          Todas com <strong>{uniform.durationMinutes} min</strong> e{' '}
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
            <Label>Duração de todas (min)</Label>
            <Input />
          </NumberField>
          <TextField className="clinic-field">
            <Label>Preço de todas</Label>
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
              Aplicar a todas
            </Button>
          </div>
        </div>
      ) : null}

      {groups.length > 0 ? (
        <ul className="vc-list" aria-label={labels.plural}>
          {groups.map((group) => {
            const synonyms = groupSynonyms(group)
            return (
              <li key={group.key} className="vc-item" data-off={groupInactive(group) || undefined}>
                <Button
                  className="vc-row"
                  aria-label={`Editar ${group.name || 'sem nome'}`}
                  onPress={() => open(group)}
                >
                  <span className="vc-row-copy">
                    <strong>{group.name || 'Sem nome'}</strong>
                    <span className="vc-row-meta">{groupPriceLine(group)}</span>
                    <span className="vc-row-syn" data-empty={synonyms.length === 0 || undefined}>
                      {synonyms.length > 0 ? `Também: ${synonyms.join(', ')}` : 'Sem sinônimos'}
                    </span>
                  </span>
                  <ChevronRight aria-hidden size={18} />
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}

      <div className="vc-add">
        <TextField className="clinic-field" aria-label={`Adicionar ${lower}`}>
          <Input
            autoComplete="off"
            value={newName}
            placeholder={`Nome (ex.: ${selection === 'varias' ? 'Virilha' : 'Relaxante'})`}
            onChange={(e) => {
              setNewName(e.target.value)
              if (addError) setAddError(null)
            }}
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
      {addError ? (
        <p className="clinic-field-error" role="alert">
          {addError}
        </p>
      ) : null}

      <ClinicSheet
        isOpen={edit != null}
        onOpenChange={(o) => {
          if (!o) setEdit(null)
        }}
        title={edit ? `${labels.singular} · ${edit.name.trim() || 'sem nome'}` : labels.singular}
      >
        {edit ? (
          <div className="vc-edit">
            <TextField className="clinic-field">
              <Label>Nome</Label>
              <Input
                autoComplete="off"
                value={edit.name}
                onChange={(e) => patchEdit({ name: e.target.value, error: null })}
              />
            </TextField>
            <SynonymsField
              label="Também chamam de"
              value={edit.synonyms}
              onChange={(synonyms) => patchEdit({ synonyms })}
              placeholder="ex.: sovaco"
              hint={`${
                split ? 'Valem para feminino e masculino. ' : ''
              }A resposta usa sempre «${edit.name.trim() || labels.singular}».`}
              takenBy={takenBy ? (word) => takenBy(edit.groupKey, word) : undefined}
            />
            <div className="vc-who" role="group" aria-labelledby="vc-who-t">
              <span id="vc-who-t" className="vc-label">
                Para quem, tempo e preço
              </span>
              {(split
                ? (['feminino', 'masculino'] as const).map(
                    (aud) => edit.members.find((m) => m.audience === aud) ?? aud,
                  )
                : edit.members
              ).map((row) => {
                const member = typeof row === 'string' ? null : row
                const audience = member?.audience ?? (row as 'feminino' | 'masculino')
                const on = member?.active ?? false
                const label = AUDIENCE_LABEL[audience]
                return (
                  <div key={member?.key ?? audience} className="vc-who-row" data-off={!on || undefined}>
                    {audience === 'ambos' ? (
                      <Checkbox
                        className="vc-who-check"
                        isSelected={on}
                        onChange={(sel) => member && patchMember(member.key, { active: sel })}
                      >
                        <span className="vc-who-box" aria-hidden>
                          <Check size={14} strokeWidth={3} />
                        </span>
                        {label}
                      </Checkbox>
                    ) : (
                      <Checkbox
                        className="vc-who-check"
                        isSelected={on}
                        onChange={(sel) => toggleAudience(audience, sel)}
                      >
                        <span className="vc-who-box" aria-hidden>
                          <Check size={14} strokeWidth={3} />
                        </span>
                        {label}
                      </Checkbox>
                    )}
                    <NumberField
                      className="clinic-field"
                      minValue={1}
                      maxValue={24 * 60}
                      step={1}
                      formatOptions={{ maximumFractionDigits: 0 }}
                      value={member?.durationMinutes ?? edit.members[0]?.durationMinutes ?? 15}
                      isDisabled={!on || !member}
                      onChange={(value) => {
                        if (!member || !Number.isInteger(value) || value < 1 || value > 24 * 60) return
                        patchMember(member.key, { durationMinutes: value })
                      }}
                    >
                      <Label>
                        Minutos<span className="visually-hidden"> ({label})</span>
                      </Label>
                      <Input />
                    </NumberField>
                    <TextField className="clinic-field" isDisabled={!on || !member}>
                      <Label>
                        Preço<span className="visually-hidden"> ({label})</span>
                      </Label>
                      <Input
                        value={member?.price ?? ''}
                        placeholder="R$"
                        inputMode="decimal"
                        onChange={(e) => member && patchMember(member.key, { price: e.target.value })}
                      />
                    </TextField>
                  </div>
                )
              })}
              <p className="clinic-footnote">
                {split
                  ? 'Desmarque um público para deixar de oferecer a ele. As marcações antigas ficam.'
                  : 'Desmarque para deixar de oferecer. As marcações antigas ficam.'}
              </p>
              {!split && edit.members.length === 1 ? (
                <Button className="panel-link-btn vc-split" onPress={splitByAudience}>
                  Separar feminino e masculino
                </Button>
              ) : null}
            </div>
            {groups.length > 1 && editIndex >= 0 ? (
              <div className="vc-order" role="group" aria-label="Posição na lista">
                <span className="vc-label">Posição na lista</span>
                <Button
                  className="panel-btn panel-btn-ghost"
                  aria-label={`Subir ${edit.name || lower}`}
                  isDisabled={editIndex === 0}
                  onPress={() => moveGroup(edit.groupKey, -1)}
                >
                  <ArrowUp aria-hidden size={16} />
                </Button>
                <Button
                  className="panel-btn panel-btn-ghost"
                  aria-label={`Descer ${edit.name || lower}`}
                  isDisabled={editIndex === groups.length - 1}
                  onPress={() => moveGroup(edit.groupKey, 1)}
                >
                  <ArrowDown aria-hidden size={16} />
                </Button>
              </div>
            ) : null}
            {edit.error ? (
              <p className="clinic-field-error" role="alert">
                {edit.error}
              </p>
            ) : null}
            {edit.confirmRemove ? (
              <div className="vc-remove-confirm" role="alertdialog" aria-label={`Remover ${edit.name}`}>
                <p>
                  <TriangleAlert aria-hidden size={16} />
                  <span>
                    Tirar «{edit.name.trim() || lower}» da lista? Ao salvar o serviço, sai se nunca entrou numa
                    visita; se já entrou, o servidor recusa e basta desmarcar.
                  </span>
                </p>
                <div className="vc-actions">
                  <Button className="panel-btn panel-btn-ghost" onPress={() => patchEdit({ confirmRemove: false })}>
                    Manter
                  </Button>
                  <Button className="panel-btn panel-btn-danger" onPress={removeGroup}>
                    Remover {lower}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="vc-actions vc-edit-foot">
                <Button className="panel-btn panel-btn-ghost vc-remove" onPress={() => patchEdit({ confirmRemove: true })}>
                  Remover {lower}…
                </Button>
                <span className="vc-spacer" />
                <Button className="panel-btn panel-btn-ghost" onPress={() => setEdit(null)}>
                  Cancelar
                </Button>
                <Button className="panel-btn panel-btn-primary" onPress={apply}>
                  Aplicar
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </ClinicSheet>
    </div>
  )
}
