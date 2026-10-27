import { ChevronLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from 'react-aria-components'
import {
  PanelApiError,
  type AiSuggestion,
  type InboxContactDetail,
  type PanelApi,
} from '../../api'
import { navigatePanel } from '../../routes'
import { ErrorState, LoadingState } from '../../states/StatusScreens'
import { DeleteContactDialog } from './DeleteContactDialog'
import { contactLabel, maskPhone, relativeTime, statusClass, statusLabel } from './format'

type Props = {
  tenantId: string
  contactId: string
  conversationId?: string
  api: PanelApi
  generation: number
  /** Só owner vê e executa exclusão (clinic.contacts.delete). */
  isOwner: boolean
}

function deleteErrorMessage(err: unknown): string {
  if (err instanceof PanelApiError) {
    if (err.code === 'permission_denied' || err.status === 403) {
      return 'Só o responsável pode excluir contatos.'
    }
    if (err.status === 404) {
      return 'Contato já não está disponível.'
    }
    if (err.status === 409) {
      return 'Não foi possível excluir agora. Tente de novo.'
    }
  }
  return 'Não foi possível excluir o contato. Tente de novo.'
}

export function InboxContactScreen({
  tenantId,
  contactId,
  conversationId,
  api,
  generation,
  isOwner,
}: Props) {
  const [data, setData] = useState<InboxContactDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<AiSuggestion | null>(null)
  const [summaryBusy, setSummaryBusy] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null)

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
          setError(err instanceof Error ? err.message : 'Falha ao carregar contato')
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

  if (deleteSuccess) {
    return (
      <div className="inbox-contact">
        <p className="inbox-notice inbox-notice-ok" role="status">
          {deleteSuccess}
        </p>
        <LoadingState label="A voltar à lista…" />
      </div>
    )
  }

  if (loading && !data) return <LoadingState label="Carregando contato…" />
  if (error && !data) {
    return (
      <ErrorState
        title="Contato indisponível"
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

  async function handleDelete() {
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const result = await api.deleteContact(tenantId, contactId, {
        generation,
        expectGeneration: () => generation,
      })
      // Sem PII — só contagens e id de auditoria.
      setDeleteSuccess(
        `Contato excluído. ${result.deletedMessageCount} mensagem(ns) e ${result.deletedAttachmentCount} anexo(s) removidos` +
          (result.anonymizedAppointmentCount > 0
            ? `; ${result.anonymizedAppointmentCount} compromisso(s) anonimizado(s)`
            : '') +
          '.',
      )
      setConfirmOpen(false)
      setData(null)
      window.setTimeout(() => {
        navigatePanel({ kind: 'area', area: 'conversas', tenantId, section: 'lista' })
      }, 1200)
    } catch (err) {
      // Não registar nome/telefone no console — mensagem genérica ao usuário.
      setDeleteError(deleteErrorMessage(err))
      setConfirmOpen(false)
    } finally {
      setDeleteBusy(false)
    }
  }

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
          <span className="inbox-thread-sub">Informações do contato</span>
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

      {conversationId ? (
        <>
          <h2 className="inbox-contact-h">Resumo da IA</h2>
          <div className="ai-block" style={{ marginBottom: 12 }}>
            {summary ? (
              <>
                <p className="ai-block-label">
                  Resumo da IA ·{' '}
                  {new Date(summary.createdAt).toLocaleString('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </p>
                <p className="ai-block-text">{summary.suggestedText}</p>
                <p className="ai-block-source">Pode conter erros. Confira na conversa.</p>
              </>
            ) : (
              <p className="ai-block-source">
                Gerado sob demanda — a IA não envia mensagens.
              </p>
            )}
            {summaryError ? (
              <p className="ai-block-warn" role="status">
                {summaryError}
              </p>
            ) : null}
            <div className="ai-block-actions">
              <Button
                className="panel-btn-secondary ai-btn"
                isDisabled={summaryBusy}
                onPress={() => {
                  setSummaryBusy(true)
                  setSummaryError(null)
                  void api
                    .summarizeAiConversation(
                      tenantId,
                      conversationId,
                      {
                        clientRequestId: crypto.randomUUID(),
                        actorDisplayName: 'Atendente',
                      },
                      { generation, expectGeneration: () => generation },
                    )
                    .then((r) => {
                      if (r.suggestion.status === 'failed') {
                        setSummaryError(
                          'A sugestão não está disponível agora. Você pode responder normalmente.',
                        )
                        setSummary(null)
                      } else {
                        setSummary(r.suggestion)
                      }
                    })
                    .catch(() => {
                      setSummaryError(
                        'A sugestão não está disponível agora. Você pode responder normalmente.',
                      )
                    })
                    .finally(() => setSummaryBusy(false))
                }}
              >
                {summaryBusy ? 'A gerar…' : summary ? 'Gerar outro resumo' : 'Gerar resumo'}
              </Button>
            </div>
          </div>
        </>
      ) : null}

      <h2 className="inbox-contact-h">Acompanhamento</h2>
      <p className="inbox-contact-note">
        O quadro de contatos em andamento está em Acompanhamento.
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

      {isOwner ? (
        <section className="inbox-contact-danger" aria-labelledby="delete-contact-h">
          <h2 id="delete-contact-h" className="inbox-contact-h">
            Zona de risco
          </h2>
          <p className="inbox-contact-note">
            Exclui mensagens, anexos e dados pessoais deste contato. Compromissos
            na agenda ficam como «Contato removido».
          </p>
          {deleteError ? (
            <p className="inbox-notice" role="alert" style={{ marginBottom: 12 }}>
              {deleteError}
            </p>
          ) : null}
          <Button
            className="panel-btn-danger"
            style={{ margin: '0 16px 24px' }}
            onPress={() => {
              setDeleteError(null)
              setConfirmOpen(true)
            }}
          >
            Excluir contato
          </Button>
        </section>
      ) : null}

      <DeleteContactDialog
        open={confirmOpen}
        contactLabel={label}
        busy={deleteBusy}
        onClose={() => {
          if (!deleteBusy) setConfirmOpen(false)
        }}
        onConfirm={() => {
          void handleDelete()
        }}
      />
    </div>
  )
}
