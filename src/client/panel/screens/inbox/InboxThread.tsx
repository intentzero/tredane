import { ChevronLeft } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Button, TextArea, TextField } from 'react-aria-components'
import type { InboxConversationDetail, InboxMessage, PanelApi } from '../../api'
import { navigatePanel } from '../../routes'
import { ErrorState, LoadingState } from '../../states/StatusScreens'
import {
  assigneeLine,
  contactLabel,
  statusClass,
  statusLabel,
} from './format'

type Props = {
  tenantId: string
  conversationId: string
  api: PanelApi
  generation: number
  viewerClerkUserId: string
}

/** Texto sempre como nó React — nunca HTML (XSS / conteúdo externo). */
function PlainText({ text }: { text: string }) {
  return <>{text}</>
}

function MessageBubble({ m }: { m: InboxMessage }) {
  if (m.direction === 'system') {
    return (
      <div className="inbox-msg-system" role="status">
        <PlainText text={m.body} />
      </div>
    )
  }
  const outbound = m.direction === 'outbound'
  return (
    <div
      className={outbound ? 'inbox-msg inbox-msg-out' : 'inbox-msg inbox-msg-in'}
    >
      <p className="inbox-msg-body">
        <PlainText text={m.body} />
      </p>
      <span className="inbox-msg-meta">
        {new Date(m.createdAt).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        })}
        {outbound ? ` · ${m.deliveryState}` : ''}
      </span>
    </div>
  )
}

export function InboxThread({
  tenantId,
  conversationId,
  api,
  generation,
  viewerClerkUserId,
}: Props) {
  const [detail, setDetail] = useState<InboxConversationDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const composerId = useId()

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getInboxConversation(
        tenantId,
        conversationId,
        { messageLimit: 100 },
        { generation, expectGeneration: () => generation },
      )
      setDetail(res)
      if (res.unreadCount > 0) {
        void api
          .markInboxRead(tenantId, conversationId, {
            generation,
            expectGeneration: () => generation,
          })
          .then((r) =>
            setDetail((prev) =>
              prev ? { ...prev, ...r.conversation, messages: prev.messages } : prev,
            ),
          )
          .catch(() => {
            /* leitura best-effort */
          })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao abrir conversa')
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [tenantId, conversationId, generation])

  async function assume() {
    if (!detail) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await api.assignInboxConversation(
        tenantId,
        conversationId,
        { expectedAssignmentVersion: detail.assignmentVersion },
        { generation, expectGeneration: () => generation },
      )
      if (res.versionMatched === false) {
        setNotice(
          `${res.conversation.assigneeDisplayName ?? 'Outra pessoa'} assumiu esta conversa antes de você.`,
        )
      }
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              ...res.conversation,
              messages: [...prev.messages, res.systemMessage],
            }
          : prev,
      )
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Falha ao assumir')
    } finally {
      setBusy(false)
    }
  }

  async function closeConv() {
    if (!detail) return
    setBusy(true)
    try {
      const res = await api.closeInboxConversation(tenantId, conversationId, {
        generation,
        expectGeneration: () => generation,
      })
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              ...res.conversation,
              messages: [...prev.messages, res.systemMessage],
            }
          : prev,
      )
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Falha ao encerrar')
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    const body = draft.trim()
    if (!body || !detail) return
    setBusy(true)
    setNotice(null)
    const clientRequestId = `client:${crypto.randomUUID()}`
    try {
      const res = await api.sendInboxMessage(
        tenantId,
        conversationId,
        { body, clientRequestId },
        { generation, expectGeneration: () => generation },
      )
      setDraft('')
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              ...res.conversation,
              messages: res.duplicate
                ? prev.messages
                : [...prev.messages, res.message],
            }
          : prev,
      )
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Falha ao enviar')
    } finally {
      setBusy(false)
    }
  }

  if (loading && !detail) {
    return <LoadingState label="A abrir conversa…" />
  }
  if (error && !detail) {
    return (
      <ErrorState
        title="Conversa indisponível"
        description={error}
        actionLabel="Voltar à lista"
        onAction={() =>
          navigatePanel({
            kind: 'area',
            area: 'conversas',
            tenantId,
            section: 'lista',
          })
        }
      />
    )
  }
  if (!detail) return null

  const label = contactLabel(detail.contact)
  const isMine =
    detail.assigneeClerkUserId != null &&
    detail.assigneeClerkUserId === viewerClerkUserId

  return (
    <div className="inbox-thread">
      <header className="inbox-thread-header">
        <Button
          className="panel-icon-btn"
          aria-label="Voltar às conversas"
          onPress={() =>
            navigatePanel({
              kind: 'area',
              area: 'conversas',
              tenantId,
              section: 'lista',
            })
          }
        >
          <ChevronLeft aria-hidden size={22} strokeWidth={2} />
        </Button>
        <button
          type="button"
          className="inbox-thread-title"
          onClick={() =>
            navigatePanel({
              kind: 'area',
              area: 'conversas',
              tenantId,
              section: 'contato',
              conversationId: detail.id,
              contactId: detail.contactId,
            })
          }
        >
          <span className="inbox-thread-name">{label}</span>
          <span className="inbox-thread-sub">
            <span className={statusClass(detail.status)}>{statusLabel(detail.status)}</span>
            {' · '}
            {assigneeLine(detail, viewerClerkUserId)}
          </span>
        </button>
      </header>

      {notice ? (
        <div className="inbox-notice" role="status">
          {notice}
          {!isMine && detail.status !== 'closed' ? (
            <Button className="panel-btn-secondary" onPress={() => void assume()} isDisabled={busy}>
              Assumir mesmo assim
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="inbox-thread-actions">
        {!isMine && detail.status !== 'closed' ? (
          <Button
            className="panel-btn-primary"
            onPress={() => void assume()}
            isDisabled={busy}
          >
            {busy ? 'Assumindo…' : 'Assumir'}
          </Button>
        ) : null}
        {detail.status !== 'closed' ? (
          <Button
            className="panel-btn-secondary"
            onPress={() => void closeConv()}
            isDisabled={busy}
          >
            Encerrar
          </Button>
        ) : null}
      </div>

      <div className="inbox-timeline" aria-live="polite">
        {detail.messagesHasMore ? (
          <p className="inbox-timeline-more">Há mensagens mais antigas no histórico.</p>
        ) : null}
        {detail.messages.map((m) => (
          <MessageBubble key={m.id} m={m} />
        ))}
      </div>

      {detail.status !== 'closed' ? (
        <form
          className="inbox-composer"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <TextField
            className="inbox-composer-field"
            aria-label="Mensagem"
            value={draft}
            onChange={setDraft}
          >
            <TextArea
              id={composerId}
              className="inbox-composer-input"
              placeholder="Escreva uma resposta…"
              rows={2}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void send()
                }
              }}
            />
          </TextField>
          <Button
            className="panel-btn-primary"
            type="submit"
            isDisabled={busy || !draft.trim()}
          >
            Enviar
          </Button>
        </form>
      ) : (
        <p className="inbox-composer-closed">Conversa encerrada. Nova mensagem do contacto reabre o histórico.</p>
      )}
    </div>
  )
}
