import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Input, SearchField } from 'react-aria-components'
import type { InboxConversation, InboxCounts, InboxFilter, PanelApi } from '../../api'
import { navigatePanel } from '../../routes'
import { EmptyState, ErrorState } from '../../states/StatusScreens'
import {
  assigneeLine,
  avatarTone,
  contactLabel,
  filterLabel,
  initials,
  previewLine,
  relativeTime,
  statusTone,
  statusLabel,
} from './format'
import {
  eventConversationId,
  useInboxRealtime,
  type InboxRealtimeSignal,
} from '../../realtime/InboxRealtime'
import { friendlyError } from '../../copy/errors'
import { Badge } from '../../states/Badge'
import { ListSkeleton } from '../../states/ListSkeleton'
import { applyAppBadge } from '../../badge'
import { AI_DRAFTING_SR_LABEL, draftingFlagFromAiDraftState } from './aiDrafting'

const FILTERS: InboxFilter[] = ['all', 'new', 'mine', 'unassigned', 'needs_person', 'closed']

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  viewerClerkUserId: string
  /** Conversa aberta ao lado (desktop): a linha fica marcada. */
  activeConversationId?: string
}

/** Aplica sinais WS ao mapa de drafting (imutável se nada mudar). */
export function applyDraftingSignals(
  prev: Record<string, boolean>,
  signals: InboxRealtimeSignal[],
): Record<string, boolean> {
  let next = prev
  for (const signal of signals) {
    if (signal.kind === 'resync') continue
    const { event } = signal
    const id = eventConversationId(event)
    if (!id) continue
    if (event.eventType === 'conversation.ai_draft') {
      const flag = draftingFlagFromAiDraftState(event.payload?.state)
      if (flag == null) continue
      if (next === prev) next = { ...prev }
      next[id] = flag
      continue
    }
    // Pausa DEC-083 cancela o job — desliga o spinner sem esperar o refetch.
    if (
      event.eventType === 'conversation.ai_pause' &&
      event.payload?.aiReplyPaused === true
    ) {
      if (next === prev) next = { ...prev }
      next[id] = false
    }
  }
  return next
}

function draftingMapFromList(conversations: InboxConversation[]): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  for (const c of conversations) {
    if (c.aiDrafting) map[c.id] = true
  }
  return map
}

function InboxAiDraftingIndicator() {
  return (
    <span
      className="inbox-row-ai"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="inbox-row-ai-spinner" aria-hidden />
      <span className="inbox-row-ai-label" aria-hidden>
        IA
      </span>
      <span className="panel-sr-only">{AI_DRAFTING_SR_LABEL}</span>
    </span>
  )
}

export function InboxList({
  tenantId,
  api,
  generation,
  viewerClerkUserId,
  activeConversationId,
}: Props) {
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<InboxConversation[] | null>(null)
  const [counts, setCounts] = useState<InboxCounts | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  /** Overlay WS: true/false por conversa até o próximo refetch reconciliar. */
  const [draftingById, setDraftingById] = useState<Record<string, boolean>>({})

  async function load(opts?: { keep?: boolean }) {
    if (!opts?.keep) setLoading(true)
    setError(null)
    try {
      const res = await api.listInboxConversations(
        tenantId,
        { filter, q: q.trim() || undefined, limit: 50 },
        { generation, expectGeneration: () => generation },
      )
      setItems(res.conversations)
      setCounts(res.counts)
      // API é a fonte de verdade após refetch (resync / evento).
      setDraftingById(draftingMapFromList(res.conversations))
      // Badge do ícone coerente com a lista que a pessoa está vendo.
      const unread = res.counts?.unread ?? 0
      const needsPerson = res.counts?.needsPerson ?? 0
      applyAppBadge(Math.max(unread, needsPerson))
    } catch (err) {
      setError(friendlyError(err, 'Não conseguimos carregar as conversas.'))
      if (!opts?.keep) setItems(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [tenantId, generation, filter, q])

  // Tempo real: actualiza o spinner já no payload; refetch silencioso reconcilia.
  useInboxRealtime((signals) => {
    setDraftingById((prev) => applyDraftingSignals(prev, signals))
    void load({ keep: true })
  })

  if (loading && !items) {
    return <ListSkeleton label="Carregando conversas…" />
  }

  if (error && !items) {
    return (
      <ErrorState
        title="Não foi possível carregar a caixa de entrada"
        description={error}
        actionLabel="Tentar de novo"
        onAction={() => void load()}
      />
    )
  }

  const list = items ?? []
  const emptyAll = list.length === 0 && filter === 'all' && !q.trim()

  return (
    <div className="inbox-root">
      <SearchField
        className="inbox-search"
        aria-label="Buscar nome ou telefone"
        value={q}
        onChange={setQ}
      >
        <Search aria-hidden size={18} strokeWidth={2} className="inbox-search-icon" />
        <Input
          className="inbox-search-input"
          placeholder="Buscar nome ou telefone"
          autoComplete="off"
          data-form-type="other"
          data-lpignore="true"
          data-1p-ignore
        />
      </SearchField>

      <div
        className="inbox-filters"
        role="toolbar"
        aria-label="Filtros da caixa de entrada"
      >
        {FILTERS.map((f) => {
          const count =
            counts == null
              ? null
              : f === 'all'
                ? counts.all
                : f === 'new'
                  ? counts.new
                  : f === 'mine'
                    ? counts.mine
                    : f === 'unassigned'
                      ? counts.unassigned
                      : f === 'needs_person'
                        ? (counts.needsPerson ?? 0)
                        : counts.closed
          const selected = filter === f
          return (
            <Button
              key={f}
              className="panel-chip"
              aria-pressed={selected}
              onPress={() => setFilter(f)}
            >
              {filterLabel(f)}
              {count != null ? (
                <span
                  className={`panel-chip-count${(f === 'new' || f === 'needs_person') && count > 0 ? ' panel-chip-count--hot' : ''}`}
                >
                  {count}
                </span>
              ) : null}
            </Button>
          )
        })}
      </div>

      {list.length === 0 ? (
        <>
          <EmptyState
            title={emptyAll ? 'Nenhuma conversa ainda' : 'Nenhuma conversa neste filtro'}
            description={
              emptyAll
                ? 'Quando uma cliente mandar mensagem para o WhatsApp da clínica, ela aparece aqui.'
                : 'Escolha outro filtro ou limpe a busca.'
            }
            actionLabel={emptyAll ? undefined : 'Limpar filtro'}
            onAction={
              emptyAll
                ? undefined
                : () => {
                    setFilter('all')
                    setQ('')
                  }
            }
          />
        </>
      ) : (
        <ul className="inbox-list">
          {list.map((c) => {
            const label = contactLabel(c.contact)
            const drafting = draftingById[c.id] === true
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className={`inbox-row${c.unreadCount > 0 ? ' inbox-row--unread' : ''}${c.id === activeConversationId ? ' inbox-row--active' : ''}`}
                  aria-current={c.id === activeConversationId ? 'page' : undefined}
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
                  <span className={`inbox-avatar inbox-avatar--${avatarTone(label)}`} aria-hidden>
                    {initials(label)}
                  </span>
                  <span className="inbox-row-main">
                    <span className="inbox-row-top">
                      <span className="inbox-row-name">{label}</span>
                      <span className="inbox-row-time">{relativeTime(c.lastMessageAt)}</span>
                    </span>
                    <span className="inbox-row-preview">
                      {previewLine(c, viewerClerkUserId)}
                    </span>
                    <span className="inbox-row-meta">
                      <Badge tone={statusTone(c.status)}>{statusLabel(c.status)}</Badge>
                      {c.needsPerson ? <Badge tone="wait">Precisa de alguém</Badge> : null}
                      {drafting ? <InboxAiDraftingIndicator /> : null}
                      <span className="inbox-row-assignee">
                        {assigneeLine(c, viewerClerkUserId)}
                      </span>
                      {c.unreadCount > 0 ? (
                        <span className="inbox-unread" aria-label={`${c.unreadCount} não lidas`}>
                          {c.unreadCount}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
