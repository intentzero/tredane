import { useEffect, useState } from 'react'
import { Button } from 'react-aria-components'
import type { ClinicService, PanelApi, UnmatchedTermSuggestion } from '../../api'
import { friendlyError } from '../../copy/errors'
import { PanelSelect } from '../../ui/PanelSelect'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  services: ClinicService[]
  /** Depois de gravar: a lista de serviços relê os sinónimos. */
  onSaved: () => void
}

/**
 * Palavras que a assistente não reconheceu (DEC-141, M-16 lista de Serviços).
 * Só a responsável vê (DEC-042). O serviço provável vem pré-escolhido, então
 * gravar é um toque; o sistema nunca grava sozinho. Copy **Proposta** (DEC-104).
 */
export function UnmatchedTermsCard({ tenantId, api, generation, services, onSaved }: Props) {
  const [items, setItems] = useState<UnmatchedTermSuggestion[] | null>(null)
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<{ id: string; text: string } | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .listUnmatchedTerms(tenantId, { generation, expectGeneration: () => generation })
      .then((list) => {
        if (alive) setItems(list)
      })
      .catch(() => {
        // Sugestão opcional: sem lista, o cartão não aparece (a ficha continua a funcionar).
        if (alive) setItems([])
      })
    return () => {
      alive = false
    }
  }, [api, tenantId, generation])

  const active = services.filter((s) => s.active)
  if (!items || items.length === 0 || active.length === 0) {
    return note ? (
      <p className="clinic-footnote" role="status">
        {note}
      </p>
    ) : null
  }

  const options = active.map((s) => ({ id: s.id, label: s.name }))
  const nameOf = (id: string | null | undefined) => active.find((s) => s.id === id)?.name ?? null

  async function save(item: UnmatchedTermSuggestion) {
    const serviceId = choice[item.id] ?? item.suggestedServiceId
    if (!serviceId) return
    setBusyId(item.id)
    setError(null)
    try {
      const row = await api.acceptUnmatchedTerm(tenantId, item.id, serviceId, {
        generation,
        expectGeneration: () => generation,
      })
      setItems((list) => (list ?? []).filter((i) => i.id !== item.id))
      setNote(`«${item.term}» gravado em ${row.name}.`)
      onSaved()
    } catch (err) {
      setError({ id: item.id, text: friendlyError(err, 'Não foi possível gravar. Tente de novo.') })
    } finally {
      setBusyId(null)
    }
  }

  async function dismiss(item: UnmatchedTermSuggestion) {
    setBusyId(item.id)
    setError(null)
    try {
      await api.dismissUnmatchedTerm(tenantId, item.id, {
        generation,
        expectGeneration: () => generation,
      })
      setItems((list) => (list ?? []).filter((i) => i.id !== item.id))
      setNote(`«${item.term}» descartado.`)
    } catch (err) {
      setError({ id: item.id, text: friendlyError(err, 'Não foi possível descartar. Tente de novo.') })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="panel-card unmatched-terms" aria-labelledby="unmatched-terms-t">
      <h2 id="unmatched-terms-t" className="panel-title-md">
        Palavras que a assistente não reconheceu
      </h2>
      <p className="panel-muted-sm">
        Clientes escreveram estas palavras e a assistente não achou o serviço. Grave como nome
        popular para ela entender da próxima vez. As clientes continuam vendo o nome do serviço.
      </p>
      <ul className="unmatched-terms-list">
        {items.map((item) => {
          const selected = choice[item.id] ?? item.suggestedServiceId ?? null
          const target = nameOf(selected)
          const busy = busyId === item.id
          return (
            <li key={item.id} className="unmatched-term">
              <div className="unmatched-term-head">
                <strong>«{item.term}»</strong>
                <span className="panel-muted-sm">
                  {item.hits === 1 ? '1 vez' : `${item.hits} vezes`}
                </span>
              </div>
              <PanelSelect
                label={`Serviço para «${item.term}»`}
                hideLabel
                options={options}
                value={selected}
                placeholder="Escolha o serviço"
                onChange={(id) => setChoice((c) => ({ ...c, [item.id]: id }))}
                isDisabled={busy}
              />
              <div className="unmatched-term-actions">
                <Button
                  className="panel-btn panel-btn-secondary"
                  onPress={() => void save(item)}
                  isDisabled={busy || !target}
                >
                  {target ? `Gravar em ${target}` : 'Gravar'}
                </Button>
                <Button
                  className="panel-btn panel-btn-ghost"
                  onPress={() => void dismiss(item)}
                  isDisabled={busy}
                >
                  Descartar
                </Button>
              </div>
              {error?.id === item.id ? (
                <p className="clinic-footnote clinic-footnote-warn" role="alert">
                  {error.text}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
      {note ? (
        <p className="clinic-footnote" role="status">
          {note}
        </p>
      ) : null}
    </section>
  )
}
