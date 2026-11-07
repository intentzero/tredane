import { ChevronLeft, ChevronRight, Ellipsis, Eye, EyeOff, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { consumeSummaryFocus } from './summaryFocus'
import { AiWorking } from '../../ui/AiWorking'
import { Button, Menu, MenuItem, MenuTrigger, Popover, Separator } from 'react-aria-components'
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
import { contactLabel, initials, maskPhone, relativeTime, statusTone, statusLabel } from './format'
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

function formatPhone(waId: string): string {
  const d = waId.replace(/\D/g, '')
  if (d.length === 13 && d.startsWith('55')) return `+55 ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`
  if (d.length === 12 && d.startsWith('55')) return `+55 ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`
  return `+${d}`
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
      {title ? <h3 className="inbox-contact-h3">{title}</h3> : null}
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
  const [showPhone, setShowPhone] = useState(false)
  const [showPast, setShowPast] = useState(false)

  // A ficha reusa a mesma instância ao trocar de cliente (Clientes 2 colunas /
  // sidepane). Sem reset, «Mostrar telefone» e o resumo da IA vazavam.
  useEffect(() => {
    setShowPhone(false)
    setShowPast(false)
    setSummary(null)
    setSummaryBusy(false)
    setSummaryError(null)
    setConfirmOpen(false)
    setDeleteError(null)
    setBlockOpen(false)
    setBlockError(null)
  }, [contactId])

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
  const focusConversation = data.conversations.find((c) => c.id === summaryConversationId) ?? null
  const otherConversations = data.conversations.filter((c) => c.id !== focusConversation?.id)
  const nextAppointment = upcoming[0] ?? null

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
        <MenuTrigger>
          <Button className="panel-icon-btn" aria-label="Mais ações">
            <Ellipsis aria-hidden size={22} strokeWidth={2} />
          </Button>
          <Popover className="panel-popover" placement="bottom end">
            <Menu
              className="panel-menu"
              aria-label="Mais ações do contato"
              onAction={(key) => {
                if (key === 'acomp') {
                  navigatePanel({
                    kind: 'area',
                    area: 'acompanhamento',
                    tenantId,
                    section: 'quadro',
                  })
                } else if (key === 'block') {
                  setBlockError(null)
                  setBlockOpen(true)
                } else if (key === 'delete') {
                  setDeleteError(null)
                  setConfirmOpen(true)
                }
              }}
            >
              <MenuItem id="acomp" className="panel-menu-item">
                Ver no Acompanhamento
                <ChevronRight aria-hidden size={16} />
              </MenuItem>
              {data.contact.blockedAt == null || isOwner ? (
                <Separator className="panel-menu-separator" />
              ) : null}
              {data.contact.blockedAt == null ? (
                <MenuItem id="block" className="panel-menu-item panel-menu-item--danger">
                  Bloquear contato
                </MenuItem>
              ) : null}
              {isOwner ? (
                <MenuItem id="delete" className="panel-menu-item panel-menu-item--danger">
                  Excluir contato
                </MenuItem>
              ) : null}
            </Menu>
          </Popover>
        </MenuTrigger>
      </header>

      <div className="ic-id">
        <span className="ic-avatar" aria-hidden="true">
          {initials(label)}
        </span>
        <h2 className="ic-name">{label}</h2>
        <span className="ic-phone">
          <span aria-live="polite">
            {showPhone ? formatPhone(data.contact.waId) : maskPhone(data.contact.waId)}
          </span>
          <Button
            className="panel-icon-btn ic-eye"
            aria-label={showPhone ? 'Ocultar telefone' : 'Mostrar telefone'}
            onPress={() => setShowPhone((v) => !v)}
          >
            {showPhone ? <EyeOff aria-hidden size={16} /> : <Eye aria-hidden size={16} />}
          </Button>
        </span>
        <span className="ic-since">
          Primeiro contato{' '}
          {new Date(data.contact.createdAt).toLocaleString('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short',
          })}
        </span>
      </div>

      {data.contact.blockedAt != null ? (
        <div className="ic-blocked" role="status">
          <p className="ic-blocked-text">
            <strong>Contato bloqueado.</strong> Bloqueado por{' '}
            {data.contact.blockedByDisplayName ?? 'uma pessoa da equipe'}. Mensagens novas não
            aparecem e ninguém consegue responder.
          </p>
          {blockError ? (
            <p className="inbox-notice" role="alert">
              {blockError}
            </p>
          ) : null}
          <Button
            className="panel-btn-secondary"
            isDisabled={blockBusy}
            onPress={() => void handleUnblock()}
          >
            {blockBusy ? 'Desbloqueando…' : 'Desbloquear contato'}
          </Button>
        </div>
      ) : null}

      <dl className="ic-now" aria-label="Situação">
        {focusConversation ? (
          <>
            <div>
              <dt>Conversa</dt>
              <dd>
                <Badge tone={statusTone(focusConversation.status)}>
                  {statusLabel(focusConversation.status)}
                </Badge>
              </dd>
            </div>
            {focusConversation.status !== 'closed' ? (
              <div>
                <dt>Atendendo</dt>
                <dd>{focusConversation.assigneeDisplayName ?? 'Ninguém assumiu'}</dd>
              </div>
            ) : null}
          </>
        ) : null}
        <div>
          <dt>Próximo horário</dt>
          <dd>
            {nextAppointment ? (
              <button
                type="button"
                className="ic-link"
                onClick={() =>
                  navigatePanel({
                    kind: 'area',
                    area: 'agenda',
                    tenantId,
                    section: 'compromisso',
                    appointmentId: nextAppointment.id,
                  })
                }
              >
                {formatAppointmentWhen(nextAppointment.startsAt, nextAppointment.endsAt)}
              </button>
            ) : (
              <span className="ic-muted">Nenhum marcado</span>
            )}
          </dd>
        </div>
      </dl>

      {summaryConversationId ? (
        <section className="ic-ai" aria-labelledby="resumo-ia">
          <div className="ic-ai-head">
            <Sparkles aria-hidden size={16} />
            <h2
              className="ic-ai-title"
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
            {summary ? (
              <span className="ic-ai-time">
                {new Date(summary.createdAt).toLocaleString('pt-BR', { timeStyle: 'short' })}
              </span>
            ) : null}
          </div>
          {summary ? (
            <>
              <p className="ai-block-text">{summary.suggestedText}</p>
              <p className="ai-block-source">Pode conter erros. Confira na conversa.</p>
            </>
          ) : (
            <p className="ai-block-source">A IA lê a conversa e resume em poucas linhas.</p>
          )}
          {summaryError ? (
            <p className="ai-block-warn" role="status">
              {summaryError}
            </p>
          ) : null}
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
                    setSummaryError('O resumo não está disponível agora. Tente de novo em instantes.')
                    setSummary(null)
                  } else {
                    setSummary(r.suggestion)
                  }
                })
                .catch(() => {
                  setSummaryError('O resumo não está disponível agora. Tente de novo em instantes.')
                })
                .finally(() => setSummaryBusy(false))
            }}
          >
            {summaryBusy ? (
              <AiWorking compact label="Gerando resumo…" />
            ) : summary ? (
              'Gerar outro resumo'
            ) : (
              'Gerar resumo'
            )}
          </Button>
        </section>
      ) : null}

      {upcoming.length > 1 || past.length > 0 ? (
        <section className="ic-sec" aria-labelledby="ic-hor">
          <h2 id="ic-hor" className="ic-h">
            Horários
          </h2>
          <AppointmentBlock title="" items={upcoming.slice(1)} tenantId={tenantId} />
          {past.length > 0 ? (
            showPast ? (
              <AppointmentBlock title="Anteriores" items={past} tenantId={tenantId} />
            ) : (
              <Button className="ic-more" onPress={() => setShowPast(true)}>
                Ver {past.length} {past.length === 1 ? 'anterior' : 'anteriores'}
              </Button>
            )
          ) : null}
        </section>
      ) : null}

      {otherConversations.length > 0 ? (
        <section className="ic-sec" aria-labelledby="ic-conv">
          <h2 id="ic-conv" className="ic-h">
            Outras conversas
          </h2>
          <ul className="inbox-list">
            {otherConversations.map((c) => (
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
        </section>
      ) : null}

      {upcoming.length === 0 && past.length === 0 && otherConversations.length === 0 ? (
        <p className="inbox-contact-note">Primeira conversa com a clínica. Sem horários anteriores.</p>
      ) : null}

      {deleteError ? (
        <p className="inbox-notice" role="alert">
          {deleteError}
        </p>
      ) : null}
      {blockError && data.contact.blockedAt == null ? (
        <p className="inbox-notice" role="alert">
          {blockError}
        </p>
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
