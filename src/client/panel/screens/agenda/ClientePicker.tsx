import { Check, ChevronDown, Search } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import {
  Dialog,
  Heading,
  Input,
  ListBox,
  ListBoxItem,
  Modal,
  ModalOverlay,
  SearchField,
} from 'react-aria-components'
import type { InboxDirectoryContact, PanelApi } from '../../api'
import { friendlyError } from '../../copy/errors'
import { contactLabel, maskPhone } from '../inbox/format'
import { useVisualViewportSheet } from '../../ui/useVisualViewportSheet'

type Fo = { generation: number; expectGeneration: () => number }

/**
 * Cliente da marcação manual na Agenda (DEC-203).
 * O gatilho e a folha são os de `PanelSelect`; a busca é a da lista Clientes.
 * Só um item da lista conta como cliente — o texto da busca não.
 */
export function ClientePicker({
  api,
  tenantId,
  fo,
  value,
  onPick,
}: {
  api: PanelApi
  tenantId: string
  fo: Fo
  value: InboxDirectoryContact | null
  onPick: (contact: InboxDirectoryContact) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [items, setItems] = useState<InboxDirectoryContact[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const labelId = useId()
  const valueId = useId()
  const sheetStyle = useVisualViewportSheet(open, { mode: 'lift' })
  const chosen = value ? contactLabel(value) : null

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const handle = window.setTimeout(() => {
      void (async () => {
        setLoading(true)
        try {
          const res = await api.listInboxContacts(
            tenantId,
            { q: q.trim() || undefined },
            fo,
          )
          if (cancelled) return
          setItems(res.contacts)
          setError(null)
        } catch (err) {
          if (!cancelled) {
            setItems(null)
            setError(friendlyError(err, 'Não foi possível carregar os clientes.'))
          }
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
    }, q.trim() ? 200 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [open, q, api, tenantId, fo])

  const selectedId = value && items?.some((c) => c.id === value.id) ? value.id : null

  return (
    <section className="panel-choice" aria-labelledby={labelId}>
      <h2 id={labelId} className="agd-label">
        Cliente
      </h2>
      <button
        type="button"
        className="panel-select-trigger panel-choice-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${valueId}`}
        onClick={() => {
          setQ('')
          setOpen(true)
        }}
      >
        <span id={valueId} className="panel-choice-value" data-placeholder={chosen ? undefined : true}>
          {chosen ?? 'Escolha a cliente'}
        </span>
        <ChevronDown aria-hidden size={18} strokeWidth={2} />
      </button>
      <ModalOverlay
        isOpen={open}
        onOpenChange={setOpen}
        isDismissable
        className="panel-overlay panel-choice-overlay"
      >
        <Modal className="panel-choice-modal">
          <Dialog
            className="panel-sheet panel-choice-sheet"
            data-size="tall"
            style={sheetStyle}
            aria-labelledby={`${labelId}-title`}
          >
            <span className="panel-sheet-handle" aria-hidden="true" />
            <Heading slot="title" id={`${labelId}-title`} className="panel-title panel-choice-title">
              Escolher cliente
            </Heading>
            <SearchField
              className="inbox-search agd-client-search"
              aria-label="Buscar pelo nome"
              value={q}
              onChange={setQ}
              autoFocus
            >
              <Search aria-hidden size={18} strokeWidth={2} className="inbox-search-icon" />
              <Input
                className="inbox-search-input"
                placeholder="Buscar pelo nome"
                autoComplete="off"
              />
            </SearchField>
            {error ? (
              <p className="agd-note" role="alert">
                {error}
              </p>
            ) : null}
            {loading && !items ? <p className="panel-meta">Carregando clientes…</p> : null}
            {items && items.length === 0 ? (
              <p className="agd-note" role="status">
                {q.trim() ? 'Nenhum cliente com esse nome.' : 'Nenhum cliente ainda.'}
              </p>
            ) : null}
            {items && items.length > 0 ? (
              <ListBox
                aria-label="Clientes"
                className="panel-choice-list"
                selectionMode="single"
                selectedKeys={selectedId ? [selectedId] : []}
                onSelectionChange={(keys) => {
                  if (keys === 'all') return
                  const next = [...keys][0]
                  if (next == null) return
                  const hit = items.find((c) => c.id === String(next))
                  if (!hit) return
                  onPick(hit)
                  setOpen(false)
                }}
              >
                {items.map((c) => {
                  const label = contactLabel(c)
                  const hint = c.displayName?.trim()
                    ? maskPhone(c.waId)
                    : c.blockedAt != null
                      ? 'Bloqueada'
                      : null
                  return (
                    <ListBoxItem key={c.id} id={c.id} className="panel-choice-item" textValue={label}>
                      {({ isSelected }) => (
                        <>
                          <span className="panel-choice-item-text">
                            {label}
                            {hint || c.blockedAt != null ? (
                              <span className="panel-choice-hint">
                                {[hint, c.blockedAt != null && hint !== 'Bloqueada' ? 'Bloqueada' : null]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            ) : null}
                          </span>
                          {isSelected ? <Check aria-hidden size={18} strokeWidth={2.4} /> : null}
                        </>
                      )}
                    </ListBoxItem>
                  )
                })}
              </ListBox>
            ) : null}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </section>
  )
}
