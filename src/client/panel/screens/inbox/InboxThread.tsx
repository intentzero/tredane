import {
  Ban,
  CalendarPlus,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  Clock,
  EllipsisVertical,
  FileText,
  Info,
  Maximize2,
  RefreshCw,
  Send,
  Sparkles,
  UserCheck,
  X,
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
  Separator,
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
import { BlockContactDialog } from './BlockContactDialog'
import { awaitingClinicReply } from './lastRelevant'
import { ThreadActionsSheet, type ThreadAction } from './ThreadActionsSheet'
import { TransferSheet } from './TransferSheet'
import { useMediaQuery } from '../../ui/useMediaQuery'
import { AiWorking } from '../../ui/AiWorking'
import { navigatePanel } from '../../routes'
import { requestSummaryFocus } from './summaryFocus'
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
  showReadBy = false,
}: {
  m: InboxMessage
  onRetry?: (m: InboxMessage) => void
  busy: boolean
  showReadBy?: boolean
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
      {showReadBy && m.readAt ? (
        <span className="inbox-msg-readby">
          Lida por {m.readByDisplayName ?? 'equipe'} ·{' '}
          {new Date(m.readAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
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
  const [reserveOpen, setReserveOpen] = useState(false)
  const [templates, setTemplates] = useState<WhatsappTemplateItem[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [blockOpen, setBlockOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const narrow = useMediaQuery('(max-width: 767.98px)')
  const [blockBusy, setBlockBusy] = useState(false)
  const [blockError, setBlockError] = useState<string | null>(null)
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
  // Rascunho automático da IA (nunca envia; nunca sobrescreve o que a atendente escreve).
  const [autoDraftState, setAutoDraftState] = useState<'idle' | 'generating'>('idle')
  const [pendingAutoDraft, setPendingAutoDraft] = useState<AiSuggestion | null>(null)
  const [aiNotes, setAiNotes] = useState<string | null>(null)
  const [aiDraftTagged, setAiDraftTagged] = useState(false)
  const [aiNotesOpen, setAiNotesOpen] = useState(false)
  const [draftFullOpen, setDraftFullOpen] = useState(false)
  const [aiFallback, setAiFallback] = useState(false)
  const [aiCapReached, setAiCapReached] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const draftRef = useRef('')
  draftRef.current = draft
  const seenSuggestionIdsRef = useRef<Set<string>>(new Set())
  const revealTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function stopReveal() {
    if (revealTimerRef.current) clearInterval(revealTimerRef.current)
    revealTimerRef.current = null
    setRevealing(false)
  }

  /** Insere o rascunho no compositor revelando-o aos poucos (sem streaming real de tokens). */
  function insertDraft(s: AiSuggestion) {
    stopReveal()
    seenSuggestionIdsRef.current.add(s.id)
    setPendingAutoDraft(null)
    setActiveSuggestionId(s.id)
    setAiNotes(s.internalNotes?.trim() || null)
    setAiDraftTagged(true)
    const full = s.suggestedText
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || full.length < 8) {
      setDraft(full)
      return
    }
    let i = 0
    setRevealing(true)
    setDraft('')
    revealTimerRef.current = setInterval(() => {
      i = Math.min(full.length, i + Math.max(2, Math.ceil(full.length / 40)))
      setDraft(full.slice(0, i))
      if (i >= full.length) stopReveal()
    }, 25)
  }

  useEffect(() => () => stopReveal(), [])

  async function refreshAiDraft(messages: InboxMessage[]) {
    try {
      const st = await api.getAiDraft(tenantId, conversationId, {
        generation,
        expectGeneration: () => generation,
      })
      setAiFallback(st.syntheticFallback === true)
      setAiCapReached(st.usage?.capReached === true)
      setAutoDraftState(st.job ? 'generating' : 'idle')
      const s = st.suggestion
      if (!s || s.origin !== 'auto' || s.status !== 'pending' || !s.suggestedText) return
      if (seenSuggestionIdsRef.current.has(s.id)) return
      // Só o rascunho da última mensagem da cliente ainda sem resposta.
      if (!awaitingClinicReply(messages)) return
      const last = [...messages].reverse().find((m) => m.direction === 'inbound')
      if (!last) return
      if (s.replyToMessageId && s.replyToMessageId !== last.id) return
      if (draftRef.current.trim() === '') insertDraft(s)
      else setPendingAutoDraft(s)
    } catch {
      /* rascunho automático é best-effort */
    }
  }

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
      if (res.messagingWindow?.open && res.status !== 'closed') void refreshAiDraft(res.messages)
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
    stopReveal()
    setPendingAutoDraft(null)
    setAiNotes(null)
    setAiDraftTagged(false)
    seenSuggestionIdsRef.current = new Set()
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

  async function transferTo(member: { clerkUserId: string; displayName: string }) {
    if (!detail) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await api.assignInboxConversation(
        tenantId,
        conversationId,
        {
          assigneeClerkUserId: member.clerkUserId,
          assigneeDisplayName: member.displayName,
          expectedAssignmentVersion: detail.assignmentVersion,
        },
        { generation, expectGeneration: () => generation },
      )
      setDetail((prev) =>
        prev ? { ...prev, ...res.conversation, messages: [...prev.messages, res.systemMessage] } : prev,
      )
      setTransferOpen(false)
    } catch (err) {
      setNotice(friendlyError(err, 'Não foi possível transferir a conversa. Tente de novo.'))
    } finally {
      setBusy(false)
    }
  }

  async function blockContact(reason: string | null) {
    if (!detail) return
    setBlockBusy(true)
    setBlockError(null)
    try {
      await api.blockInboxContact(tenantId, detail.contactId, { reason }, {
        generation,
        expectGeneration: () => generation,
      })
      setBlockOpen(false)
      discardDraftInComposer()
      await load({ quiet: true })
    } catch {
      setBlockError('Não foi possível bloquear agora. Tente de novo.')
    } finally {
      setBlockBusy(false)
    }
  }

  async function unblockContact() {
    if (!detail) return
    setBusy(true)
    try {
      await api.unblockInboxContact(tenantId, detail.contactId, {
        generation,
        expectGeneration: () => generation,
      })
      await load({ quiet: true })
    } catch (err) {
      setNotice(friendlyError(err, 'Não foi possível desbloquear agora. Tente de novo.'))
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
      } else if (parentSuggestionId && aiDraftTagged && !aiSuggestion) {
        // «Gerar outra» a partir do rascunho no compositor: substitui-o.
        insertDraft(res.suggestion)
      } else {
        setAiSuggestion(res.suggestion)
        setAiUnavailable(false)
      }
    } catch (err) {
      setAiSuggestion(null)
      if (err instanceof PanelApiError && (err.code as string) === 'ai_not_enabled') {
        setAiNotEnabled(true)
      } else if (err instanceof PanelApiError && (err.code as string) === 'ai_daily_cap_reached') {
        setAiCapReached(true)
      } else {
        setAiUnavailable(true)
      }
    } finally {
      setAiBusy(false)
    }
  }

  /** Descarta o rascunho que já está no compositor (sem tocar no que a atendente escreveu depois). */
  function discardDraftInComposer() {
    stopReveal()
    setDraft('')
    setAiDraftTagged(false)
    setAiNotes(null)
    setAiNotesOpen(false)
    setDraftFullOpen(false)
    setActiveSuggestionId(null)
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
    seenSuggestionIdsRef.current.add(aiSuggestion.id)
    setDraft(aiSuggestion.suggestedText)
    setActiveSuggestionId(aiSuggestion.id)
    setAiNotes(aiSuggestion.internalNotes?.trim() || null)
    setAiDraftTagged(true)
    setAiSuggestion(null)
  }

  // DEC-062: a atendente leu o texto completo e envia em 1 toque; a origem da sugestão fica registrada.
  async function sendAiSuggestion() {
    if (!aiSuggestion) return
    seenSuggestionIdsRef.current.add(aiSuggestion.id)
    await sendPayload({ body: aiSuggestion.suggestedText, aiSuggestionId: aiSuggestion.id })
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
      setAiNotes(null)
      setAiDraftTagged(false)
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
        setAiNotes(null)
        setAiDraftTagged(false)
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
  // «Lida por» só sob a última mensagem da cliente já lida pela equipe.
  const lastReadInboundId =
    [...detail.messages].reverse().find((m) => m.direction === 'inbound' && m.readAt)?.id ?? null

  const label = contactLabel(detail.contact)
  const isMine =
    detail.assigneeClerkUserId != null &&
    detail.assigneeClerkUserId === viewerClerkUserId
  const blocked = detail.contact?.blockedAt != null
  const threadActions: ThreadAction[] = [
    { id: 'contact', label: 'Ver detalhes do contato' },
    ...(detail.status !== 'closed' && !blocked ? [{ id: 'hold', label: 'Reservar bloco' }] : []),
    ...(detail.status !== 'closed' && !blocked ? [{ id: 'transfer', label: 'Transferir para outra pessoa' }] : []),
    ...(detail.status !== 'closed' ? [{ id: 'close', label: 'Encerrar conversa' }] : []),
    blocked
      ? { id: 'unblock', label: 'Desbloquear contato' }
      : { id: 'block', label: 'Bloquear contato', danger: true },
  ]
  function runThreadAction(id: string) {
    if (id === 'contact') {
      navigatePanel({
        kind: 'area',
        area: 'conversas',
        tenantId,
        section: 'contato',
        conversationId: detail!.id,
        contactId: detail!.contactId,
      })
    }
    if (id === 'hold') setReserveOpen(true)
    if (id === 'transfer') setTransferOpen(true)
    if (id === 'close') setConfirmClose(true)
    if (id === 'block') {
      setBlockError(null)
      setBlockOpen(true)
    }
    if (id === 'unblock') void unblockContact()
  }
  const windowOpen = detail.messagingWindow?.open !== false && !blocked
  // Última mensagem relevante nossa (ignora sistema/notas): sem «Sugerir resposta» nem sugestão automática.
  const canSuggest = awaitingClinicReply(detail.messages)
  const cardMode = windowOpen && aiDraftTagged && !!draft.trim() && !pendingAutoDraft

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
              {blocked ? (
                <Badge tone="closed">Bloqueado</Badge>
              ) : (
                <Badge tone={statusTone(detail.status)}>{statusLabel(detail.status)}</Badge>
              )}
              <span>{assigneeLine(detail, viewerClerkUserId)}</span>
            </span>
          </span>
        </button>
        {/* Celular: atalho visível para o Resumo da IA (no desktop está na coluna/gaveta do contato). */}
        <Button
          className="panel-icon-btn inbox-thread-summary-btn"
          aria-label="Resumo da IA"
          onPress={() => {
            requestSummaryFocus()
            navigatePanel({
              kind: 'area',
              area: 'conversas',
              tenantId,
              section: 'contato',
              conversationId: detail.id,
              contactId: detail.contactId,
            })
          }}
        >
          <FileText aria-hidden size={20} strokeWidth={2} />
        </Button>
        {detail.status !== 'closed' && !blocked ? (
          <Button
            className="panel-header-action"
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
            <CalendarPlus aria-hidden size={20} strokeWidth={2} />
            <span>Agendar</span>
          </Button>
        ) : null}
        {narrow ? (
          <Button
            className="panel-icon-btn"
            aria-label="Mais opções da conversa"
            aria-haspopup="dialog"
            onPress={() => setActionsOpen(true)}
          >
            <EllipsisVertical aria-hidden size={22} strokeWidth={2} />
          </Button>
        ) : (
          <MenuTrigger>
            <Button className="panel-icon-btn" aria-label="Mais opções da conversa">
              <EllipsisVertical aria-hidden size={22} strokeWidth={2} />
            </Button>
            <Popover className="panel-popover" placement="bottom end">
              <Menu
                className="panel-menu"
                aria-label="Opções da conversa"
                onAction={(key) => runThreadAction(String(key))}
              >
                {threadActions
                  .filter((a) => a.id !== 'contact')
                  .map((a, i) => (
                    <Fragment key={a.id}>
                      {a.danger && i > 0 ? <Separator className="panel-menu-separator" /> : null}
                      <MenuItem
                        id={a.id}
                        className={`panel-menu-item${a.danger ? ' panel-menu-item--danger' : ''}`}
                      >
                        {a.label}
                      </MenuItem>
                    </Fragment>
                  ))}
              </Menu>
            </Popover>
          </MenuTrigger>
        )}
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

      <ThreadActionsSheet
        open={actionsOpen && narrow}
        title={`Conversa com ${label}`}
        actions={threadActions}
        onAction={runThreadAction}
        onClose={() => setActionsOpen(false)}
      />
      <TransferSheet
        open={transferOpen}
        tenantId={tenantId}
        api={api}
        generation={generation}
        viewerClerkUserId={viewerClerkUserId}
        currentAssigneeClerkUserId={detail.assigneeClerkUserId}
        busy={busy}
        onClose={() => setTransferOpen(false)}
        onPick={(m) => void transferTo(m)}
      />
      <BlockContactDialog
        open={blockOpen}
        contactLabel={label}
        busy={blockBusy}
        hasPendingPix={detail.contactHasPendingPix === true}
        error={blockError}
        onClose={() => setBlockOpen(false)}
        onConfirm={(reason) => {
          void blockContact(reason)
        }}
      />
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
              showReadBy={m.id === lastReadInboundId}
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

      {blocked ? (
        <div className="inbox-blocked" role="status">
          <p>
            <Ban aria-hidden size={20} strokeWidth={2} />
            Contato bloqueado. Mensagens novas deste número não aparecem no painel e não é possível
            responder.
          </p>
          <Button className="panel-btn-secondary" isDisabled={busy} onPress={() => void unblockContact()}>
            Desbloquear
          </Button>
        </div>
      ) : detail.status !== 'closed' ? (
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
              {aiSuggestion.internalNotes ? (
                <p className="ai-notes" role="note">
                  <span className="ai-notes-label">Notas da IA para você (não são enviadas)</span>
                  <PlainText text={aiSuggestion.internalNotes} />
                </p>
              ) : null}
              <div className="ai-block-actions">
                {windowOpen ? (
                  <Button
                    className="panel-btn-primary ai-btn ai-btn--send"
                    onPress={() => void sendAiSuggestion()}
                    isDisabled={aiBusy || busy}
                  >
                    Enviar
                  </Button>
                ) : null}
                <Button
                  className="panel-btn-secondary ai-btn"
                  onPress={() => useAndEditAiSuggestion()}
                  isDisabled={aiBusy || busy}
                >
                  Editar
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
          {aiFallback ? (
            <p className="ai-banner" role="status">
              IA em modo de teste: a chave do provedor não está configurada, por isso as
              sugestões são fictícias. Avise o responsável.
            </p>
          ) : null}
          {aiCapReached ? (
            <p className="ai-banner" role="status">
              Limite diário de rascunhos da IA atingido nesta clínica. As sugestões voltam amanhã;
              você pode responder normalmente.
            </p>
          ) : null}
          {windowOpen && canSuggest && (autoDraftState === 'generating' || pendingAutoDraft) ? (
            <div className="inbox-ai-status">
              {autoDraftState === 'generating' && !pendingAutoDraft && !aiDraftTagged ? (
                <AiWorking label="IA escrevendo um rascunho…" />
              ) : null}
              {pendingAutoDraft ? (
                <Button
                  className="inbox-ai-chip"
                  aria-label="Sugestão pronta, inserir no lugar do texto atual"
                  onPress={() => insertDraft(pendingAutoDraft)}
                >
                  <Sparkles aria-hidden size={14} strokeWidth={2} />
                  Sugestão pronta · inserir
                </Button>
              ) : null}
            </div>
          ) : null}
          {windowOpen && canSuggest && !aiSuggestion && !aiDraftTagged ? (
            <div className="inbox-composer-tools">
              <Button
                className="inbox-ai-trigger"
                aria-label="Sugerir resposta com IA"
                onPress={() => void requestAiSuggestion(null)}
                isDisabled={aiBusy || busy}
              >
                <Sparkles aria-hidden size={16} strokeWidth={2} />
                {aiBusy ? <AiWorking compact label="Gerando sugestão…" /> : 'Sugerir resposta'}
              </Button>
            </div>
          ) : null}
          {windowOpen ? (
            <form
              className={`inbox-composer${cardMode ? ' inbox-ai-card' : ''}`}
              onSubmit={(e) => {
                e.preventDefault()
                void send()
              }}
            >
              {cardMode ? (
                <div className="inbox-ai-card-head">
                  {revealing || aiBusy ? (
                    <AiWorking label={aiBusy ? 'Gerando outra…' : 'IA escrevendo…'} />
                  ) : (
                    <span className="inbox-ai-draft-tag">
                      <Sparkles aria-hidden size={14} strokeWidth={2} />
                      Rascunho da IA<span className="inbox-ai-draft-sub"> · revise antes de enviar</span>
                    </span>
                  )}
                  <Button
                    className="inbox-ai-icon"
                    aria-label="Ver rascunho em tela cheia"
                    onPress={() => setDraftFullOpen(true)}
                  >
                    <Maximize2 aria-hidden size={18} strokeWidth={2} />
                  </Button>
                  <Button
                    className="inbox-ai-icon"
                    aria-label="Descartar rascunho"
                    onPress={discardDraftInComposer}
                  >
                    <X aria-hidden size={18} strokeWidth={2} />
                  </Button>
                </div>
              ) : null}
              {cardMode && aiNotes && aiNotesOpen ? (
                <p className="ai-notes ai-notes--card" role="note">
                  <span className="ai-notes-label">Nota para você · não é enviada</span>
                  {aiNotes}
                </p>
              ) : null}
              <TextField
                className="inbox-composer-field"
                aria-label="Mensagem"
                value={draft}
                onChange={(v) => {
                  if (revealing) stopReveal()
                  setDraft(v)
                  if (!v.trim() && aiDraftTagged) {
                    setAiDraftTagged(false)
                    setAiNotes(null)
                    setAiNotesOpen(false)
                    setActiveSuggestionId(null)
                  }
                }}
              >
                <TextArea
                  id={composerId}
                  className={`inbox-composer-input${cardMode ? ' inbox-composer-input--card' : ''}`}
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
              {cardMode ? (
                <div className="inbox-ai-card-foot">
                  <Button
                    className="inbox-ai-foot-btn"
                    aria-label="Gerar outra"
                    onPress={() => void requestAiSuggestion(activeSuggestionId)}
                    isDisabled={aiBusy || busy || revealing}
                  >
                    <RefreshCw aria-hidden size={16} strokeWidth={2} />
                    Outra
                  </Button>
                  {aiNotes ? (
                    <Button
                      className="inbox-ai-foot-btn"
                      aria-expanded={aiNotesOpen}
                      aria-label="Nota da IA para você"
                      onPress={() => setAiNotesOpen((o) => !o)}
                    >
                      <Info aria-hidden size={16} strokeWidth={2} />
                      Nota
                    </Button>
                  ) : null}
                  <span className="inbox-ai-foot-spacer" />
                  <Button
                    className="inbox-send inbox-send--label"
                    type="submit"
                    aria-label="Enviar"
                    isDisabled={busy || !draft.trim()}
                  >
                    Enviar
                    <Send aria-hidden size={16} strokeWidth={2} />
                  </Button>
                </div>
              ) : (
                <Button
                  className="inbox-send"
                  type="submit"
                  aria-label="Enviar"
                  isDisabled={busy || !draft.trim()}
                >
                  <Send aria-hidden size={20} strokeWidth={2} />
                </Button>
              )}
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
            isOpen={draftFullOpen && cardMode}
            onOpenChange={setDraftFullOpen}
            className="panel-overlay"
            style={{ position: 'fixed', inset: 0, zIndex: 30 }}
            isDismissable
          >
            <Modal className="inbox-draft-full-modal">
              <Dialog className="inbox-draft-full" aria-labelledby="draft-full-title">
                {({ close }) => (
                  <>
                    <header className="inbox-draft-full-head">
                      <Button className="panel-icon-btn" aria-label="Voltar para a conversa" onPress={close}>
                        <ChevronLeft aria-hidden size={22} strokeWidth={2} />
                      </Button>
                      <div className="inbox-draft-full-title">
                        <Heading slot="title" id="draft-full-title">
                          Resposta para {label}
                        </Heading>
                        <span>Rascunho da IA · revise antes de enviar</span>
                      </div>
                      <Button
                        className="inbox-ai-foot-btn"
                        aria-label="Gerar outra"
                        onPress={() => void requestAiSuggestion(activeSuggestionId)}
                        isDisabled={aiBusy || busy || revealing}
                      >
                        <RefreshCw aria-hidden size={16} strokeWidth={2} />
                        Outra
                      </Button>
                    </header>
                    {aiNotes ? (
                      <p className="ai-notes ai-notes--card" role="note">
                        <span className="ai-notes-label">Nota para você · não é enviada</span>
                        {aiNotes}
                      </p>
                    ) : null}
                    <TextField className="inbox-draft-full-field" aria-label="Resposta" value={draft} onChange={setDraft}>
                      <TextArea className="inbox-draft-full-input" />
                    </TextField>
                    <div className="inbox-draft-full-foot">
                      <Button className="panel-btn-secondary" onPress={close}>
                        Voltar
                      </Button>
                      <Button
                        className="panel-btn-primary"
                        isDisabled={busy || !draft.trim()}
                        onPress={() => {
                          close()
                          void send()
                        }}
                      >
                        Enviar para {label}
                      </Button>
                    </div>
                  </>
                )}
              </Dialog>
            </Modal>
          </ModalOverlay>

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
