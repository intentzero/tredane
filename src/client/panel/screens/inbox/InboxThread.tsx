import {
  CalendarPlus,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  Clock,
  EllipsisVertical,
  Send,
  Sparkles,
  UserCheck,
} from 'lucide-react'
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { eventConversationId, useInboxRealtime } from '../../realtime/InboxRealtime'
import {
  Button,
  Dialog,
  Heading,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  ModalOverlay,
  Popover,
  TextArea,
  TextField,
} from 'react-aria-components'
import type {
  AiSuggestion,
  InboxConversationDetail,
  InboxMessage,
  PanelApi,
  PixChargeDetail,
  PixPaymentAlert,
  WhatsappTemplateItem,
} from '../../api'
import { PanelApiError } from '../../api'
import { useClinicTimezone } from '../../clinicTimezone'
import { ReservarBlocoSheet } from '../holds/ReservarBlocoSheet'
import { navigatePanel } from '../../routes'
import { ErrorState } from '../../states/StatusScreens'
import {
  assigneeLine,
  avatarTone,
  contactLabel,
  dayLabel,
  deliveryLabel,
  initials,
  sameDay,
  windowHint,
  statusTone,
  statusLabel,
} from './format'
import { friendlyError } from '../../copy/errors'
import { Badge } from '../../states/Badge'
import { Banner } from '../../states/Banner'

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

function DeliveryIcon({ state }: { state: string }) {
  const props = { 'aria-hidden': true, size: 14, strokeWidth: 2, className: 'inbox-delivery-icon' } as const
  switch (state) {
    case 'pending':
      return <Clock {...props} />
    case 'accepted':
      return <Check {...props} />
    case 'delivered':
    case 'read':
      return <CheckCheck {...props} />
    case 'failed':
    case 'unknown':
      return <CircleAlert {...props} />
    default:
      return null
  }
}

function MessageBubble({
  m,
  onRetry,
  busy,
}: {
  m: InboxMessage
  onRetry?: (m: InboxMessage) => void
  busy: boolean
}) {
  if (m.direction === 'system') {
    return (
      <div className="inbox-msg-system" role="status">
        <PlainText text={m.body} />
      </div>
    )
  }
  const outbound = m.direction === 'outbound'
  const failed = outbound && m.deliveryState === 'failed'
  const unknown = outbound && m.deliveryState === 'unknown'
  const delivery = outbound ? deliveryLabel(m.deliveryState) : null
  const stateClass = failed
    ? ' inbox-delivery-failed'
    : unknown
      ? ' inbox-delivery-unknown'
      : m.deliveryState === 'read'
        ? ' inbox-delivery-read'
        : ''
  return (
    <div className={outbound ? 'inbox-msg inbox-msg-out' : 'inbox-msg inbox-msg-in'}>
      <div className={`inbox-msg-bubble${failed ? ' inbox-msg-bubble--failed' : ''}`}>
        <p className="inbox-msg-body">
          <PlainText text={m.body} />
        </p>
        <span className="inbox-msg-meta">
          {new Date(m.createdAt).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
          {delivery ? (
            <span className={`inbox-delivery${stateClass}`}>
              <DeliveryIcon state={m.deliveryState} />
              {delivery}
            </span>
          ) : null}
        </span>
      </div>
      {failed && onRetry ? (
        <Button
          className="inbox-msg-retry"
          onPress={() => onRetry(m)}
          isDisabled={busy}
        >
          Tentar de novo
        </Button>
      ) : null}
      {unknown ? (
        <span className="inbox-msg-unknown-hint" role="status">
          Estamos conferindo se foi enviada. Aguarde um instante.
        </span>
      ) : null}
    </div>
  )
}

type LocalOutbound = {
  localId: string
  body: string
  aiSuggestionId: string | null
  createdAt: number
  status: 'sending' | 'failed'
}

function localToMessage(o: LocalOutbound, d: { tenantId: string; id: string }): InboxMessage {
  return {
    id: o.localId,
    tenantId: d.tenantId,
    conversationId: d.id,
    direction: 'outbound',
    body: o.body,
    externalMessageId: null,
    deliveryState: o.status === 'sending' ? 'pending' : 'failed',
    authorClerkUserId: null,
    authorDisplayName: null,
    createdAt: o.createdAt,
  }
}

/** Esqueleto da conversa (cabeçalho + bolhas) no lugar do spinner. */
function ThreadSkeleton() {
  return (
    <div className="inbox-thread inbox-thread-skeleton" role="status" aria-busy="true">
      <span className="panel-sr-only">Abrindo conversa…</span>
      <div className="inbox-thread-header" aria-hidden="true">
        <span className="panel-skeleton-avatar" />
        <span className="panel-skeleton-lines">
          <span className="panel-skeleton-line panel-skeleton-line--title" />
          <span className="panel-skeleton-line" />
        </span>
      </div>
      <div className="inbox-timeline" aria-hidden="true">
        {(['in', 'out', 'in', 'out', 'in'] as const).map((side, i) => (
          <span
            key={i}
            className={`inbox-skeleton-bubble inbox-skeleton-bubble--${side}`}
            style={{ width: `${[62, 48, 70, 40, 55][i]}%` }}
          />
        ))}
      </div>
      <div className="inbox-composer-wrap" aria-hidden="true">
        <div className="inbox-composer">
          <span className="inbox-skeleton-input" />
        </div>
      </div>
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
  const [templates, setTemplates] = useState<WhatsappTemplateItem[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [reserveOpen, setReserveOpen] = useState(false)
  // Datas e horas no fuso da clínica (Agenda → Horários).
  useClinicTimezone(api, tenantId, generation)
  const [selectedTemplate, setSelectedTemplate] =
    useState<WhatsappTemplateItem | null>(null)
  const [pixCharges, setPixCharges] = useState<PixChargeDetail[]>([])
  const [pixAlerts, setPixAlerts] = useState<PixPaymentAlert[]>([])
  const [templateParams, setTemplateParams] = useState<Record<string, string>>(
    {},
  )
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiUnavailable, setAiUnavailable] = useState(false)
  const [aiNotEnabled, setAiNotEnabled] = useState(false)
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(
    null,
  )
  const composerId = useId()
  const timelineRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const scrolledConversationRef = useRef<string | null>(null)
  const prevLastMessageIdRef = useRef<string | null>(null)
  // Faixa «N não lidas» ancorada na primeira não lida de quando a conversa abriu.
  const [unreadAnchor, setUnreadAnchor] = useState<{ id: string; count: number } | null>(
    null,
  )
  // Mensagens recebidas abaixo da área visível (botão «↓ N»).
  const [belowCount, setBelowCount] = useState(0)
  // Envio de texto otimista: a bolha aparece já («Enviando…»); se falhar fica
  // «Não enviada · Tentar de novo» sem perder o texto.
  const [outbox, setOutbox] = useState<LocalOutbound[]>([])

  async function load(opts?: { quiet?: boolean }) {
    const quiet = opts?.quiet === true
    if (!quiet) {
      setLoading(true)
      setUnreadAnchor(null)
      setBelowCount(0)
    }
    setError(null)
    try {
      const res = await api.getInboxConversation(
        tenantId,
        conversationId,
        { messageLimit: 100 },
        { generation, expectGeneration: () => generation },
      )
      if (!quiet && res.unreadCount > 0) {
        const inbound = res.messages.filter((m) => m.direction === 'inbound')
        const first = inbound[Math.max(0, inbound.length - res.unreadCount)]
        if (first) setUnreadAnchor({ id: first.id, count: inbound.length - inbound.indexOf(first) })
      }
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
      if (!res.messagingWindow?.open) {
        void api
          .listWhatsappTemplates(tenantId, {
            generation,
            expectGeneration: () => generation,
          })
          .then((t) => setTemplates(t.items))
          .catch(() => setTemplates([]))
      }
      void api
        .listConversationPixCharges(tenantId, conversationId, {
          generation,
          expectGeneration: () => generation,
        })
        .then(setPixCharges)
        .catch(() => setPixCharges([]))
      void api
        .listPixPaymentAlerts(tenantId, conversationId, {
          generation,
          expectGeneration: () => generation,
        })
        .then(setPixAlerts)
        .catch(() => setPixAlerts([]))
    } catch (err) {
      // Refetch em tempo real falhado: manter a conversa visível (e o rascunho).
      if (quiet) return
      setError(friendlyError(err, 'Não foi possível abrir esta conversa.'))
      setDetail(null)
    } finally {
      if (!quiet) setLoading(false)
    }
  }

  useEffect(() => {
    setOutbox([])
    void load()
  }, [tenantId, conversationId, generation])

  // Como no WhatsApp: ao abrir, vai para a primeira não lida (com a faixa) ou
  // para o fim; mensagem nova rola até ela se a pessoa já estava no fim ou se
  // foi ela quem enviou. Quem subiu para ler o histórico não é puxado de volta:
  // aparece o botão «↓ N» com a contagem das recebidas.
  const lastMessage = detail?.messages[detail.messages.length - 1]
  const lastMessageId = lastMessage?.id
  const lastMessageOutbound = lastMessage?.direction === 'outbound'
  useEffect(() => {
    const el = timelineRef.current
    if (!el || !detail || !lastMessageId) return
    const opened = scrolledConversationRef.current !== conversationId
    scrolledConversationRef.current = conversationId
    const prevId = prevLastMessageIdRef.current
    prevLastMessageIdRef.current = lastMessageId
    if (opened) {
      const divider = el.querySelector<HTMLElement>('[data-unread-divider]')
      if (divider && unreadAnchor) {
        el.scrollTop = Math.max(0, divider.offsetTop - 16)
        stickToBottomRef.current = false
        setBelowCount(unreadAnchor.count)
      } else {
        el.scrollTop = el.scrollHeight
        stickToBottomRef.current = true
      }
      return
    }
    if (stickToBottomRef.current || lastMessageOutbound) {
      const smooth =
        typeof el.scrollTo === 'function' &&
        !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      else el.scrollTop = el.scrollHeight
      stickToBottomRef.current = true
      setBelowCount(0)
      return
    }
    const prevIndex = prevId ? detail.messages.findIndex((m) => m.id === prevId) : -1
    const added = detail.messages
      .slice(prevIndex + 1)
      .filter((m) => m.direction === 'inbound').length
    if (added > 0) setBelowCount((n) => n + added)
  }, [conversationId, lastMessageId, lastMessageOutbound])

  function scrollToLatest() {
    const el = timelineRef.current
    if (!el) return
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    } else {
      el.scrollTop = el.scrollHeight
    }
    stickToBottomRef.current = true
    setBelowCount(0)
  }

  // Tempo real: (re)ligação/aba visível ou evento desta conversa → refetch
  // silencioso. O rascunho (estado local) e o scroll não são tocados.
  useInboxRealtime((signals) => {
    const relevant = signals.some(
      (s) => s.kind === 'resync' || eventConversationId(s.event) === conversationId,
    )
    if (relevant) void load({ quiet: true })
  })

  async function refundAlert(a: PixPaymentAlert) {
    setBusy(true)
    setNotice(null)
    try {
      const result = await api.refundPixAlert(
        tenantId,
        a.id,
        { clientRequestId: crypto.randomUUID() },
        { generation, expectGeneration: () => generation },
      )
      if (result.refundConfirmed) {
        setNotice('Sinal devolvido.')
        setPixAlerts((prev) => prev.filter((x) => x.id !== a.id))
      } else if (result.uncertain) {
        setNotice(
          'Pedido de devolução enviado. O dinheiro ainda não voltou para a cliente; o status muda aqui quando voltar.',
        )
      } else {
        setNotice(
          result.charge.status === 'refund_failed'
            ? 'A devolução não deu certo. Tente de novo.'
            : 'Pedido de devolução enviado.',
        )
      }
      void api
        .listConversationPixCharges(tenantId, conversationId, {
          generation,
          expectGeneration: () => generation,
        })
        .then(setPixCharges)
        .catch(() => {})
      void api
        .listPixPaymentAlerts(tenantId, conversationId, {
          generation,
          expectGeneration: () => generation,
        })
        .then(setPixAlerts)
        .catch(() => {})
    } catch (err) {
      setNotice(friendlyError(err, 'Não foi possível devolver o sinal.'))
    } finally {
      setBusy(false)
    }
  }

  async function cancelCharge(c: PixChargeDetail) {
    setBusy(true)
    setNotice(null)
    try {
      await api.cancelPixCharge(
        tenantId,
        c.id,
        { clientRequestId: crypto.randomUUID() },
        { generation, expectGeneration: () => generation },
      )
      setNotice('Cobrança cancelada.')
      setPixCharges((prev) =>
        prev.map((x) =>
          x.id === c.id ? { ...x, status: 'cancelled' } : x,
        ),
      )
    } catch (err) {
      setNotice(friendlyError(err, 'Não foi possível cancelar a cobrança.'))
    } finally {
      setBusy(false)
    }
  }

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
      setNotice(friendlyError(err, 'Não foi possível assumir a conversa. Tente de novo.'))
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
      setNotice(friendlyError(err, 'Não foi possível encerrar a conversa. Tente de novo.'))
    } finally {
      setBusy(false)
    }
  }

  async function requestAiSuggestion(parentSuggestionId?: string | null) {
    setAiBusy(true)
    setAiUnavailable(false)
    setNotice(null)
    try {
      const res = await api.suggestAiReply(
        tenantId,
        conversationId,
        {
          clientRequestId: crypto.randomUUID(),
          parentSuggestionId: parentSuggestionId ?? null,
          actorDisplayName: 'Atendente',
        },
        { generation, expectGeneration: () => generation },
      )
      if (res.suggestion.status === 'failed' || !res.suggestion.suggestedText) {
        setAiSuggestion(null)
        setAiUnavailable(true)
      } else {
        setAiSuggestion(res.suggestion)
        setAiUnavailable(false)
      }
    } catch (err) {
      setAiSuggestion(null)
      if (err instanceof PanelApiError && (err.code as string) === 'ai_not_enabled') {
        setAiNotEnabled(true)
      } else {
        setAiUnavailable(true)
      }
    } finally {
      setAiBusy(false)
    }
  }

  async function discardAiSuggestion() {
    if (!aiSuggestion) {
      setAiSuggestion(null)
      return
    }
    setAiBusy(true)
    try {
      await api.decideAiSuggestion(
        tenantId,
        aiSuggestion.id,
        {
          clientRequestId: crypto.randomUUID(),
          decision: 'discard',
          actorDisplayName: 'Atendente',
        },
        { generation, expectGeneration: () => generation },
      )
    } catch {
      /* descarte local mesmo se a API falhar */
    } finally {
      setAiSuggestion(null)
      setActiveSuggestionId(null)
      setAiBusy(false)
    }
  }

  function useAndEditAiSuggestion() {
    if (!aiSuggestion) return
    setDraft(aiSuggestion.suggestedText)
    setActiveSuggestionId(aiSuggestion.id)
    setAiSuggestion(null)
  }

  async function sendPayload(payload: {
    body?: string
    template?: {
      name: string
      language: string
      params: Record<string, string>
    }
    aiSuggestionId?: string | null
  }, opts?: { retryLocalId?: string }) {
    if (!detail) return
    const textOnly = Boolean(payload.body) && !payload.template
    const aiSuggestionId = payload.aiSuggestionId ?? activeSuggestionId
    const localId = textOnly
      ? (opts?.retryLocalId ?? `local:${crypto.randomUUID()}`)
      : null
    if (localId) {
      const body = payload.body ?? ''
      setOutbox((prev) =>
        opts?.retryLocalId
          ? prev.map((o) => (o.localId === localId ? { ...o, status: 'sending' } : o))
          : [
              ...prev,
              { localId, body, aiSuggestionId, createdAt: Date.now(), status: 'sending' },
            ],
      )
      // O texto já está na bolha: o campo fica livre para a próxima mensagem.
      setDraft('')
      setActiveSuggestionId(null)
      setAiSuggestion(null)
      stickToBottomRef.current = true
      requestAnimationFrame(() => {
        const el = timelineRef.current
        if (el) el.scrollTop = el.scrollHeight
      })
    }
    setBusy(true)
    setNotice(null)
    const clientRequestId = `client:${crypto.randomUUID()}`
    try {
      const res = await api.sendInboxMessage(
        tenantId,
        conversationId,
        {
          ...payload,
          clientRequestId,
          aiSuggestionId,
        },
        { generation, expectGeneration: () => generation },
      )
      if (localId) {
        setOutbox((prev) => prev.filter((o) => o.localId !== localId))
      } else {
        setDraft('')
        setActiveSuggestionId(null)
        setAiSuggestion(null)
      }
      setSelectedTemplate(null)
      setTemplateParams({})
      setPickerOpen(false)
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
      if (localId) {
        setOutbox((prev) =>
          prev.map((o) => (o.localId === localId ? { ...o, status: 'failed' } : o)),
        )
      }
      setNotice(friendlyError(err, 'A mensagem não foi enviada. Tente de novo.'))
    } finally {
      setBusy(false)
    }
  }

  async function retryLocal(o: LocalOutbound) {
    if (!detail?.messagingWindow?.open) {
      setNotice('Passaram 24 horas desde a última mensagem da cliente. Use um modelo de mensagem para tentar de novo.')
      setPickerOpen(true)
      return
    }
    await sendPayload({ body: o.body, aiSuggestionId: o.aiSuggestionId }, { retryLocalId: o.localId })
  }

  async function send() {
    const body = draft.trim()
    if (!body || !detail) return
    if (!detail.messagingWindow?.open) {
      setNotice('Passaram 24 horas desde a última mensagem da cliente. Para voltar a falar com ela, envie um modelo de mensagem.')
      return
    }
    await sendPayload({ body })
  }

  async function sendTemplate() {
    if (!selectedTemplate) return
    for (const key of selectedTemplate.paramKeys) {
      if (!templateParams[key]?.trim()) {
        setNotice(`Preencha o parâmetro: ${key}`)
        return
      }
    }
    await sendPayload({
      template: {
        name: selectedTemplate.name,
        language: selectedTemplate.language,
        params: templateParams,
      },
    })
  }

  async function retryFailed(m: InboxMessage) {
    // Nova tentativa = nova intenção (REQ-013); não reutiliza clientRequestId.
    if (detail?.messagingWindow?.open) {
      await sendPayload({ body: m.body })
    } else {
      setNotice('Passaram 24 horas desde a última mensagem da cliente. Use um modelo de mensagem para tentar de novo.')
      setPickerOpen(true)
    }
  }

  if (loading && !detail) {
    return <ThreadSkeleton />
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
  const windowOpen = detail.messagingWindow?.open !== false

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
          className="inbox-thread-person"
          aria-label={`Informações de ${label}`}
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
          <span className={`inbox-avatar inbox-avatar--sm inbox-avatar--${avatarTone(label)}`} aria-hidden>
            {initials(label)}
          </span>
          <span className="inbox-thread-who">
            <span className="inbox-thread-name">{label}</span>
            <span className="inbox-thread-sub">
              <Badge tone={statusTone(detail.status)}>{statusLabel(detail.status)}</Badge>
              <span>{assigneeLine(detail, viewerClerkUserId)}</span>
            </span>
          </span>
        </button>
        {detail.status !== 'closed' ? (
          <Button
            className="panel-icon-btn"
            aria-label="Agendar horário"
            isDisabled={busy}
            onPress={() =>
              navigatePanel({
                kind: 'area',
                area: 'agenda',
                tenantId,
                section: 'agendar',
                conversationId,
                contactId: detail.contactId,
              })
            }
          >
            <CalendarPlus aria-hidden size={22} strokeWidth={2} />
          </Button>
        ) : null}
        {detail.status !== 'closed' ? (
          <MenuTrigger>
            <Button className="panel-icon-btn" aria-label="Mais opções da conversa">
              <EllipsisVertical aria-hidden size={22} strokeWidth={2} />
            </Button>
            <Popover className="panel-popover" placement="bottom end">
              <Menu
                className="panel-menu"
                aria-label="Opções da conversa"
                onAction={(key) => {
                  if (key === 'close') setConfirmClose(true)
                  if (key === 'hold') setReserveOpen(true)
                }}
              >
                <MenuItem id="hold" className="panel-menu-item">
                  Reservar bloco
                </MenuItem>
                <MenuItem id="close" className="panel-menu-item panel-menu-item--danger">
                  Encerrar conversa
                </MenuItem>
              </Menu>
            </Popover>
          </MenuTrigger>
        ) : null}
      </header>

      {confirmClose ? (
        <div className="inbox-confirm">
          <Banner tone="warn" title="Encerrar esta conversa?" role="alert">
            <p>Se a cliente escrever de novo, a conversa abre outra vez.</p>
            <div className="inbox-confirm-actions">
              <Button
                className="panel-btn-primary panel-btn-compact"
                isDisabled={busy}
                onPress={() => {
                  setConfirmClose(false)
                  void closeConv()
                }}
              >
                Encerrar
              </Button>
              <Button
                className="panel-btn-ghost panel-btn-compact"
                autoFocus
                onPress={() => setConfirmClose(false)}
              >
                Cancelar
              </Button>
            </div>
          </Banner>
        </div>
      ) : null}

      {!isMine && detail.status !== 'closed' ? (
        <div className="inbox-assign">
          <UserCheck aria-hidden size={20} strokeWidth={2} />
          <p>
            {detail.assigneeClerkUserId
              ? `${detail.assigneeDisplayName ?? 'Outra pessoa'} está atendendo esta conversa.`
              : 'Ninguém está atendendo esta conversa.'}
          </p>
          <Button
            className="panel-btn-primary panel-btn-compact"
            onPress={() => void assume()}
            isDisabled={busy}
          >
            {busy ? 'Assumindo…' : 'Assumir'}
          </Button>
        </div>
      ) : null}

      <ReservarBlocoSheet
        open={reserveOpen}
        tenantId={tenantId}
        api={api}
        generation={generation}
        conversationId={conversationId}
        contactName={detail.contact?.displayName ?? null}
        windowOpen={windowOpen}
        onClose={() => setReserveOpen(false)}
        onReserved={async (message) => {
          void load({ quiet: true })
          if (message) await sendPayload({ body: message })
          else if (!windowOpen) {
            setNotice('Horário reservado na agenda. A mensagem não foi enviada porque passaram 24 h desde a última mensagem da paciente.')
          }
        }}
      />
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

      {pixAlerts.length > 0 ? (
        <div className="inbox-notice inbox-pix-alert" role="alert">
          {pixAlerts.map((a) => {
            const charge = pixCharges.find((c) => c.id === a.chargeId)
            const refundPending = charge?.status === 'refund_requested'
            const refundFailed = charge?.status === 'refund_failed'
            return (
              <div key={a.id} className="inbox-pix-card">
                <strong>Sinal pago, mas o horário foi ocupado</strong>
                <p>
                  {charge
                    ? (charge.amountCents / 100).toLocaleString('pt-BR', {
                        style: 'currency',
                        currency: 'BRL',
                      })
                    : 'Pagamento registrado'}
                  {' · '}
                  {a.reason === 'payment_after_expiry'
                    ? 'pagamento após o prazo'
                    : a.reason === 'slot_occupied'
                      ? 'horário já reservado'
                      : 'não foi possível confirmar o horário'}
                  {refundPending
                    ? ' · devolução pedida (dinheiro ainda não devolvido)'
                    : refundFailed
                      ? ' · a devolução não deu certo'
                      : ''}
                </p>
                <div className="clinic-actions">
                  <Button
                    className="panel-btn-primary"
                    onPress={() =>
                      navigatePanel({
                        kind: 'area',
                        area: 'agenda',
                        tenantId,
                        section: 'agendar',
                        conversationId,
                        contactId: detail?.contactId,
                        alertId: a.id,
                      })
                    }
                    isDisabled={busy || refundPending}
                  >
                    Escolher outro horário
                  </Button>
                  <Button
                    className="panel-btn-secondary"
                    onPress={() => void refundAlert(a)}
                    isDisabled={busy || refundPending}
                  >
                    {refundFailed ? 'Tentar devolver de novo' : 'Devolver sinal'}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {pixCharges.some((c) => c.status === 'awaiting_payment') ? (
        <div className="inbox-notice" role="status">
          {pixCharges
            .filter((c) => c.status === 'awaiting_payment')
            .map((c) => (
              <div key={c.id} className="inbox-pix-card">
                <strong>Aguardando sinal</strong>
                <p>
                  {(c.amountCents / 100).toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  })}
                  {c.expiresAt
                    ? ` · prazo até ${new Date(c.expiresAt).toLocaleString('pt-BR')}`
                    : ''}
                  {' · horário não reservado'}
                </p>
                <div className="clinic-actions">
                  {c.pixCopyPaste ? (
                    <Button
                      className="panel-btn-secondary"
                      onPress={() => {
                        void navigator.clipboard?.writeText(c.pixCopyPaste!)
                        setNotice('Pix copiado')
                      }}
                    >
                      Copiar Pix
                    </Button>
                  ) : null}
                  <Button
                    className="panel-btn-secondary"
                    onPress={() => void cancelCharge(c)}
                    isDisabled={busy}
                  >
                    Cancelar cobrança
                  </Button>
                </div>
                {c.whatsappSendError ? (
                  <p role="alert">Não foi possível enviar a cobrança pelo WhatsApp. Copie o Pix e envie na conversa.</p>
                ) : null}
              </div>
            ))}
        </div>
      ) : null}

      <div className="inbox-timeline-wrap">
      <div
        className="inbox-timeline"
        aria-live="polite"
        ref={timelineRef}
        onScroll={(e) => {
          const el = e.currentTarget
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          stickToBottomRef.current = atBottom
          if (atBottom) setBelowCount(0)
        }}
      >
        {detail.messagesHasMore ? (
          <p className="inbox-timeline-more">Há mensagens mais antigas no histórico.</p>
        ) : null}
        {detail.messages.map((m, i) => (
          <Fragment key={m.id}>
            {i === 0 || !sameDay(detail.messages[i - 1]!.createdAt, m.createdAt) ? (
              <div className="inbox-day">{dayLabel(m.createdAt)}</div>
            ) : null}
            {unreadAnchor?.id === m.id ? (
              <div className="inbox-unread-divider" data-unread-divider>
                {unreadAnchor.count === 1
                  ? '1 mensagem não lida'
                  : `${unreadAnchor.count} mensagens não lidas`}
              </div>
            ) : null}
            <MessageBubble
              m={m}
              busy={busy}
              onRetry={m.deliveryState === 'failed' ? retryFailed : undefined}
            />
          </Fragment>
        ))}
        {outbox.map((o) => (
          <MessageBubble
            key={o.localId}
            m={localToMessage(o, detail)}
            busy={busy}
            onRetry={o.status === 'failed' ? () => void retryLocal(o) : undefined}
          />
        ))}
      </div>
      {belowCount > 0 ? (
        <Button
          className="inbox-scroll-latest"
          aria-label={`Ir para as mensagens novas (${belowCount} não lidas)`}
          onPress={scrollToLatest}
        >
          <ChevronDown aria-hidden="true" size={22} strokeWidth={2} />
          <span className="inbox-scroll-latest-count" aria-hidden="true">
            {belowCount}
          </span>
        </Button>
      ) : null}
      </div>

      {detail.status !== 'closed' ? (
        <div className="inbox-composer-wrap">
          {aiNotEnabled ? (
            <div className="ai-block ai-block-unavailable" role="status">
              <p>
                As sugestões com IA estão desligadas nesta clínica. O responsável pode ativar em
                Clínica › Sugestões com IA.
              </p>
            </div>
          ) : null}
          {aiUnavailable ? (
            <div className="ai-block ai-block-unavailable" role="status">
              <p>A sugestão não está disponível agora. Você pode responder normalmente.</p>
            </div>
          ) : null}
          {aiSuggestion ? (
            <div className="ai-block" role="region" aria-label="Sugestão da IA">
              <p className="ai-block-label">Sugestão da IA — revise antes de enviar</p>
              {aiSuggestion.warningLabels.map((w) => (
                <p key={w} className="ai-block-warn" role="status">
                  {w}
                </p>
              ))}
              {aiSuggestion.sourceRefs.map((s) => (
                <p key={s.serviceName} className="ai-block-source">
                  {s.label}
                </p>
              ))}
              <p className="ai-block-text">
                <PlainText text={aiSuggestion.suggestedText} />
              </p>
              <div className="ai-block-actions">
                <Button
                  className="panel-btn-secondary ai-btn"
                  onPress={() => useAndEditAiSuggestion()}
                  isDisabled={aiBusy || busy}
                >
                  Usar e editar
                </Button>
                <Button
                  className="panel-btn-secondary ai-btn"
                  onPress={() => void requestAiSuggestion(aiSuggestion.id)}
                  isDisabled={aiBusy || busy}
                >
                  Gerar outra
                </Button>
                <Button
                  className="panel-btn-secondary ai-btn"
                  onPress={() => void discardAiSuggestion()}
                  isDisabled={aiBusy || busy}
                >
                  Descartar
                </Button>
              </div>
            </div>
          ) : null}
          {!windowOpen ? (
            <p className="inbox-window-banner" role="status">
              <Clock aria-hidden size={14} strokeWidth={2} />
              Passaram 24 horas: use um modelo de mensagem
            </p>
          ) : null}
          {windowOpen && windowHint(detail.messagingWindow?.closesAt ?? null) ? (
            <p className="inbox-window-banner" role="status">
              <Clock aria-hidden size={14} strokeWidth={2} />
              {windowHint(detail.messagingWindow?.closesAt ?? null)}
            </p>
          ) : null}
          {windowOpen && !aiSuggestion ? (
            <div className="inbox-composer-tools">
              <Button
                className="inbox-ai-trigger"
                aria-label="Sugerir resposta com IA"
                onPress={() => void requestAiSuggestion(null)}
                isDisabled={aiBusy || busy}
              >
                <Sparkles aria-hidden size={16} strokeWidth={2} />
                {aiBusy ? 'Gerando sugestão…' : 'Sugerir resposta'}
              </Button>
            </div>
          ) : null}
          {windowOpen ? (
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
                  rows={1}
                  autoComplete="off"
                  data-form-type="other"
                  data-lpignore="true"
                  data-1p-ignore
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault()
                      void send()
                    }
                  }}
                />
              </TextField>
              <Button
                className="inbox-send"
                type="submit"
                aria-label="Enviar"
                isDisabled={busy || !draft.trim()}
              >
                <Send aria-hidden size={20} strokeWidth={2} />
              </Button>
            </form>
          ) : (
            <div className="inbox-composer inbox-composer-template">
              <Button
                className="panel-btn-primary"
                onPress={() => {
                  setPickerOpen((o) => !o)
                  if (templates.length === 0) {
                    void api
                      .listWhatsappTemplates(tenantId, {
                        generation,
                        expectGeneration: () => generation,
                      })
                      .then((t) => setTemplates(t.items))
                  }
                }}
                isDisabled={busy}
              >
                Escolher modelo
              </Button>
            </div>
          )}

          <ModalOverlay
            isOpen={pickerOpen}
            onOpenChange={(next) => {
              if (!next && !busy) setPickerOpen(false)
            }}
            className="panel-overlay"
            style={{ position: 'fixed', inset: 0, zIndex: 30 }}
            isDismissable={!busy}
          >
            <Modal>
              <Dialog
                className="panel-sheet inbox-template-picker"
                style={{ position: 'fixed', left: 0, right: 0, bottom: 0 }}
                aria-labelledby="wa-template-title"
              >
                {({ close }) => (
                  <>
                    <span className="panel-sheet-handle" aria-hidden="true" />
                    <Heading
                      slot="title"
                      id="wa-template-title"
                      className="panel-title"
                      style={{ margin: '8px 0 2px' }}
                    >
                      Modelos WhatsApp
                    </Heading>
                    {templates.length === 0 ? (
                      <p className="panel-subtitle">
                        Nenhum modelo aprovado sincronizado.
                      </p>
                    ) : (
                      <ul className="inbox-template-list">
                        {templates.map((t) => (
                          <li key={`${t.name}:${t.language}`}>
                            <button
                              type="button"
                              className={
                                selectedTemplate?.name === t.name
                                  ? 'inbox-template-item inbox-template-item-active'
                                  : 'inbox-template-item'
                              }
                              aria-pressed={selectedTemplate?.name === t.name}
                              onClick={() => {
                                setSelectedTemplate(t)
                                const next: Record<string, string> = {}
                                for (const k of t.paramKeys)
                                  next[k] = templateParams[k] ?? ''
                                setTemplateParams(next)
                              }}
                            >
                              <strong>{t.name}</strong>
                              <span>
                                {t.category}
                                {t.pricingCategory
                                  ? ` · ${t.pricingCategory}`
                                  : ''}
                              </span>
                              <span className="inbox-template-pricing">
                                {t.pricingNote}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {selectedTemplate ? (
                      <div className="inbox-template-form">
                        <p className="inbox-template-preview">
                          <PlainText text={selectedTemplate.bodyPreview} />
                        </p>
                        <p className="inbox-template-pricing" role="note">
                          {selectedTemplate.pricingNote}
                        </p>
                        {selectedTemplate.paramKeys.map((key) => (
                          <label key={key} className="inbox-template-param">
                            <span>{key}</span>
                            <input
                              autoComplete="off"
                              value={templateParams[key] ?? ''}
                              onChange={(e) =>
                                setTemplateParams((prev) => ({
                                  ...prev,
                                  [key]: e.target.value,
                                }))
                              }
                            />
                          </label>
                        ))}
                        <Button
                          className="panel-btn-primary"
                          onPress={() => void sendTemplate()}
                          isDisabled={busy}
                        >
                          Enviar modelo
                        </Button>
                      </div>
                    ) : null}
                    <Button
                      className="panel-btn-secondary"
                      style={{ marginTop: 8 }}
                      isDisabled={busy}
                      onPress={() => {
                        close()
                        setPickerOpen(false)
                      }}
                    >
                      Fechar
                    </Button>
                  </>
                )}
              </Dialog>
            </Modal>
          </ModalOverlay>
        </div>
      ) : (
        <p className="inbox-composer-closed">Conversa encerrada. Se a cliente escrever de novo, a conversa abre outra vez.</p>
      )}
    </div>
  )
}
