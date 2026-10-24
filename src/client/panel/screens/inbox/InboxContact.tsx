import { ChevronLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from 'react-aria-components'
import type { InboxContactDetail, PanelApi } from '../../api'
import { navigatePanel } from '../../routes'
import { ErrorState, LoadingState } from '../../states/StatusScreens'
import { contactLabel, maskPhone, relativeTime, statusClass, statusLabel } from './format'

type Props = {
  tenantId: string
  contactId: string
  conversationId?: string
  api: PanelApi
  generation: number
}

export function InboxContactScreen({
  tenantId,
  contactId,
  conversationId,
  api,
  generation,
}: Props) {
  const [data, setData] = useState<InboxContactDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await api.getInboxContact(tenantId, contactId, {
          generation,
          expectGeneration: () => generation,
        })
        if (!cancelled) setData(res)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Falha ao carregar contacto')
          setData(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [api, tenantId, contactId, generation])

  if (loading && !data) return <LoadingState label="A carregar contacto…" />
  if (error && !data) {
    return (
      <ErrorState
        title="Contacto indisponível"
        description={error}
        actionLabel="Voltar"
        onAction={() =>
          navigatePanel(
            conversationId
              ? {
                  kind: 'area',
                  area: 'conversas',
                  tenantId,
                  section: 'thread',
                  conversationId,
                }
              : { kind: 'area', area: 'conversas', tenantId, section: 'lista' },
          )
        }
      />
    )
  }
  if (!data) return null

  const label = contactLabel(data.contact)

  return (
    <div className="inbox-contact">
      <header className="inbox-thread-header">
        <Button
          className="panel-icon-btn"
          aria-label="Voltar"
          onPress={() =>
            navigatePanel(
              conversationId
                ? {
                    kind: 'area',
                    area: 'conversas',
                    tenantId,
                    section: 'thread',
                    conversationId,
                  }
                : { kind: 'area', area: 'conversas', tenantId, section: 'lista' },
            )
          }
        >
          <ChevronLeft aria-hidden size={22} strokeWidth={2} />
        </Button>
        <div className="inbox-thread-title">
          <span className="inbox-thread-name">{label}</span>
          <span className="inbox-thread-sub">Informações do contacto</span>
        </div>
      </header>

      <dl className="inbox-contact-dl">
        <div>
          <dt>Nome</dt>
          <dd>{data.contact.displayName?.trim() || '—'}</dd>
        </div>
        <div>
          <dt>Telefone</dt>
          <dd>{maskPhone(data.contact.waId)}</dd>
        </div>
        <div>
          <dt>Criado em</dt>
          <dd>
            {new Date(data.contact.createdAt).toLocaleString('pt-BR', {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </dd>
        </div>
      </dl>

      <h2 className="inbox-contact-h">Acompanhamento</h2>
      <p className="inbox-contact-note">
        O quadro de contactos em andamento está em Acompanhamento. A agenda completa chega nas
        fatias #35/#36.
      </p>
      <Button
        className="panel-btn-secondary"
        style={{ margin: '0 16px 12px' }}
        onPress={() =>
          navigatePanel({
            kind: 'area',
            area: 'acompanhamento',
            tenantId,
            section: 'quadro',
          })
        }
      >
        Abrir Acompanhamento
      </Button>

      <h2 className="inbox-contact-h">Conversas</h2>
      <ul className="inbox-list">
        {data.conversations.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="inbox-row"
              onClick={() =>
                navigatePanel({
                  kind: 'area',
                  area: 'conversas',
                  tenantId,
                  section: 'thread',
                  conversationId: c.id,
                })
              }
            >
              <span className="inbox-row-main">
                <span className="inbox-row-top">
                  <span className={statusClass(c.status)}>{statusLabel(c.status)}</span>
                  <span className="inbox-row-time">{relativeTime(c.lastMessageAt)}</span>
                </span>
                <span className="inbox-row-preview">{c.lastMessagePreview ?? '—'}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
