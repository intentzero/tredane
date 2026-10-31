import { ChevronLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { consumeSummaryFocus } from './summaryFocus'
import { AiWorking } from '../../ui/AiWorking'
import { Button } from 'react-aria-components'
import {
  PanelApiError,
  type AiSuggestion,
  type ContactAppointmentItem,
  type InboxContactDetail,
  type PanelApi,
} from '../../api'
import { navigatePanel } from '../../routes'
import { ErrorState, LoadingState } from '../../states/StatusScreens'
import { BlockContactDialog } from './BlockContactDialog'
import { DeleteContactDialog } from './DeleteContactDialog'
import { contactLabel, maskPhone, relativeTime, statusTone, statusLabel } from './format'
import { friendlyError } from '../../copy/errors'
import { Badge } from '../../states/Badge'

type Props = {
  tenantId: string
  contactId: string
  conversationId?: string
  api: PanelApi
  generation: number
  /** Só owner vê e executa exclusão (clinic.contacts.delete). */
  isOwner: boolean
  /**
   * Origem da ficha: Conversas (sidepane / Contato) ou Clientes (directório).
   * Mesmo conteúdo canónico (Opção C Confirmada).
   */
  origin?: 'conversas' | 'clientes'
}

function formatAppointmentWhen(startsAt: number, endsAt: number): string {
  const start = new Date(startsAt)
  const end = new Date(endsAt)
  const day = start.toLocaleString('pt-BR', { dateStyle: 'short' })
  const from = start.toLocaleString('pt-BR', { timeStyle: 'short' })
  const to = end.toLocaleString('pt-BR', { timeStyle: 'short' })
  return `${day}, ${from}–${to}`
}

function AppointmentBlock({
  title,
  items,
  tenantId,
}: {
  title: string
  items: ContactAppointmentItem[]
  tenantId: string
}) {
  if (items.length === 0) return null
  return (
    <div className="inbox-contact-appts">
      <h3 className="inbox-contact-h3">{title}</h3>
      <ul className="inbox-contact-appt-list">
        {items.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              className="inbox-contact-appt"
              onClick={() =>
                navigatePanel({
                  kind: 'area',
                  area: 'agenda',
                  tenantId,
                  section: 'compromisso',
                  appointmentId: a.id,
                })
              }
            >
              <strong>
                {formatAppointmentWhen(a.startsAt, a.endsAt)} · {a.serviceName}
              </strong>
              <span>
                {a.status === 'confirmed' ? 'Confirmado' : 'Cancelado'}
                {a.professionalName ? ` · ${a.professionalName}` : ''}
                {a.roomResourceName ? ` · ${a.roomResourceName}` : ''}
                {a.changeReason ? ` · ${a.changeReason}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
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
  origin = 'conversas',
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
  const [focusSummary] = useState(consumeSummaryFocus)
  const [blockOpen, setBlockOpen] = useState(false)
  const [blockBusy, setBlockBusy] = useState(false)
  const [blockError, setBlockError] = useState<string | null>(null)

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
          setError(friendlyError(err, 'Não foi possível abrir este contato.'))
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
            origin === 'clientes'
              ? { kind: 'area', area: 'clientes', tenantId, section: 'lista' }
              : conversationId
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
  const summaryConversationId =
    conversationId ??
    data.conversations.find((c) => c.status !== 'closed')?.id ??
    data.conversations[0]?.id
  const upcoming = data.appointments?.upcoming ?? []
  const past = data.appointments?.past ?? []

  async function handleBlock(reason: string | null) {
    setBlockBusy(true)
    setBlockError(null)
    try {
      const res = await api.blockInboxContact(
        tenantId,
        contactId,
        { reason },
        { generation, expectGeneration: () => generation },
      )
      setData((prev) => (prev ? { ...prev, contact: { ...prev.contact, ...res.contact } } : prev))
      setBlockOpen(false)
    } catch {
      setBlockError('Não foi possível bloquear agora. Tente de novo.')
    } finally {
      setBlockBusy(false)
    }
  }

  async function handleUnblock() {
    setBlockBusy(true)
    setBlockError(null)
    try {
      const res = await api.unblockInboxContact(tenantId, contactId, {
        generation,
        expectGeneration: () => generation,
      })
      setData((prev) => (prev ? { ...prev, contact: { ...prev.contact, ...res.contact } } : prev))
    } catch {
      setBlockError('Não foi possível desbloquear agora. Tente de novo.')
    } finally {
      setBlockBusy(false)
    }
  }

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
      // Voltar já à lista — evita thread/pipeline em cache com o contato ainda aberto.
      navigatePanel(
        origin === 'clientes'
          ? { kind: 'area', area: 'clientes', tenantId, section: 'lista' }
          : { kind: 'area', area: 'conversas', tenantId, section: 'lista' },
      )
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
              origin === 'clientes'
                ? { kind: 'area', area: 'clientes', tenantId, section: 'lista' }
                : conversationId
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

      {summaryConversationId ? (
        <>
          <h2
            className="inbox-contact-h"
            id="resumo-ia"
            tabIndex={-1}
            ref={(el) => {
              if (el && focusSummary && !el.dataset.focused) {
                el.dataset.focused = '1'
                el.scrollIntoView?.({ block: 'start' })
                el.focus({ preventScroll: true })
              }
            }}
          >
            Resumo da IA
          </h2>
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
                Gerado sob demanda. As respostas de agendamento podem sair sozinhas no WhatsApp.
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
                      summaryConversationId,
                      {
                        clientRequestId: crypto.randomUUID(),
                        actorDisplayName: 'Atendente',
                      },
                      { generation, expectGeneration: () => generation },
                    )
                    .then((r) => {
                      if (r.suggestion.status === 'failed') {
                        setSummaryError(
                          'O resumo não está disponível agora. Tente de novo em instantes.',
                        )
                        setSummary(null)
                      } else {
                        setSummary(r.suggestion)
                      }
                    })
                    .catch(() => {
                      setSummaryError(
                        'O resumo não está disponível agora. Tente de novo em instantes.',
                      )
                    })
                    .finally(() => setSummaryBusy(false))
                }}
              >
                {summaryBusy ? <AiWorking compact label="Gerando resumo…" /> : summary ? 'Gerar outro resumo' : 'Gerar resumo'}
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

      <h2 className="inbox-contact-h">Horários</h2>
      {upcoming.length === 0 && past.length === 0 ? (
        <p className="inbox-contact-note">Nenhum horário marcado para este contato.</p>
      ) : (
        <>
          <AppointmentBlock title="Próximos" items={upcoming} tenantId={tenantId} />
          <AppointmentBlock title="Anteriores" items={past} tenantId={tenantId} />
        </>
      )}

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
                  <Badge tone={statusTone(c.status)}>{statusLabel(c.status)}</Badge>
                  <span className="inbox-row-time">{relativeTime(c.lastMessageAt)}</span>
                </span>
                <span className="inbox-row-preview">{c.lastMessagePreview ?? '—'}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <section className="inbox-contact-danger" aria-labelledby="block-contact-h">
        <h2 id="block-contact-h" className="inbox-contact-h">
          {data.contact.blockedAt != null ? 'Contato bloqueado' : 'Bloquear contato'}
        </h2>
        <p className="inbox-contact-note">
          {data.contact.blockedAt != null
            ? `Bloqueado por ${data.contact.blockedByDisplayName ?? 'uma pessoa da equipe'}. Mensagens novas não aparecem no painel e ninguém consegue responder.`
            : 'Mensagens novas deste número deixam de aparecer e a conversa é encerrada. O histórico e os horários marcados continuam.'}
        </p>
        {blockError ? (
          <p className="inbox-notice" role="alert" style={{ marginBottom: 12 }}>
            {blockError}
          </p>
        ) : null}
        {data.contact.blockedAt != null ? (
          <Button
            className="panel-btn-secondary"
            isDisabled={blockBusy}
            onPress={() => void handleUnblock()}
          >
            {blockBusy ? 'Desbloqueando…' : 'Desbloquear contato'}
          </Button>
        ) : (
          <Button
            className="panel-btn-danger"
            onPress={() => {
              setBlockError(null)
              setBlockOpen(true)
            }}
          >
            Bloquear contato
          </Button>
        )}
      </section>

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
            onPress={() => {
              setDeleteError(null)
              setConfirmOpen(true)
            }}
          >
            Excluir contato
          </Button>
        </section>
      ) : null}

      <BlockContactDialog
        open={blockOpen}
        contactLabel={label}
        busy={blockBusy}
        hasPendingPix={data?.hasPendingPix === true}
        error={blockError}
        onClose={() => setBlockOpen(false)}
        onConfirm={(reason) => {
          void handleBlock(reason)
        }}
      />

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
