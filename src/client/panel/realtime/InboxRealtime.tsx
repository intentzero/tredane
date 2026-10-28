import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { PanelApiError, type PanelApi } from '../api'
import { applyAppBadge } from '../badge'
import { installSoundUnlock, maybePlayInboundSound } from '../sound'
import {
  buildInboxWsUrl,
  createRealtimeConnection,
  RealtimeFatalError,
  type RealtimeServerEvent,
  type RealtimeState,
} from './connection'

/**
 * Sinal entregue aos ecrãs do inbox:
 * - `resync`: (re)ligação ou aba visível — refazer fetch de tudo o que está aberto.
 * - `event`: evento persistido no DO da clínica — refazer fetch do afetado.
 */
export type InboxRealtimeSignal =
  | { kind: 'resync'; reason: 'connected' | 'reconnected' | 'visible' }
  | { kind: 'event'; event: RealtimeServerEvent }

type Listener = (signal: InboxRealtimeSignal) => void

type Ctx = {
  subscribe(listener: Listener): () => void
  state: RealtimeState
}

const InboxRealtimeContext = createContext<Ctx | null>(null)

/** Eventos que afetam lista/conversa (outros tipos são ignorados pelo inbox). */
export function isInboxEvent(event: RealtimeServerEvent): boolean {
  return (
    event.eventType.startsWith('message.') ||
    event.eventType.startsWith('conversation.') ||
    event.eventType.startsWith('contact.') ||
    // DEC-061: a etapa mostrada na conversa muda sozinha e por correção de outra pessoa.
    event.eventType === 'opportunity.stage_changed'
  )
}

/** Eventos que mudam a grade de horários do Agendar (DEC-057). */
export function isScheduleEvent(event: RealtimeServerEvent): boolean {
  return (
    event.eventType.startsWith('appointment.')
    || event.eventType.startsWith('schedule_hold.')
    || event.eventType === 'cobranca.paga'
  )
}

/** conversationId afetado (payload ou entidade), se houver. */
export function eventConversationId(event: RealtimeServerEvent): string | null {
  const fromPayload = event.payload?.conversationId
  if (typeof fromPayload === 'string') return fromPayload
  if (event.entity?.type === 'conversation') return event.entity.id
  return null
}

export function InboxRealtimeProvider({
  tenantId,
  api,
  generation,
  children,
  acceptEvent = isInboxEvent,
}: {
  tenantId: string
  api: PanelApi
  generation: number
  children: ReactNode
  /** Filtro de eventos entregues aos ecrãs (padrão: inbox). */
  acceptEvent?: (event: RealtimeServerEvent) => boolean
}) {
  const listeners = useRef(new Set<Listener>())
  const [state, setState] = useState<RealtimeState>('idle')
  const [ctx] = useState<Omit<Ctx, 'state'>>(() => ({
    subscribe(listener: Listener) {
      listeners.current.add(listener)
      return () => {
        listeners.current.delete(listener)
      }
    },
  }))

  useEffect(() => {
    if (typeof WebSocket === 'undefined' || typeof api.getRealtimeTicket !== 'function') {
      return
    }
    const soundSeen = new Set<string>()
    const removeSoundUnlock = installSoundUnlock()
    const emit = (signal: InboxRealtimeSignal) => {
      for (const l of [...listeners.current]) {
        try {
          l(signal)
        } catch {
          /* listener isolado */
        }
      }
    }
    // Badge do ícone: refetch leve (limit=1 → counts.unread), coalescido.
    let badgeTimer: ReturnType<typeof setTimeout> | null = null
    let badgeStopped = false
    const refreshBadge = () => {
      if (typeof api.listInboxConversations !== 'function') return
      if (badgeTimer) clearTimeout(badgeTimer)
      badgeTimer = setTimeout(() => {
        badgeTimer = null
        api
          .listInboxConversations(tenantId, { limit: 1 })
          .then((res) => {
            if (!badgeStopped && typeof res?.counts?.unread === 'number') {
              applyAppBadge(res.counts.unread)
            }
          })
          .catch(() => undefined)
      }, 400)
    }
    const isVisible = () =>
      typeof document === 'undefined' || document.visibilityState === 'visible'
    const conn = createRealtimeConnection({
      getVisible: isVisible,
      getUrl: async () => {
        try {
          const { ticket } = await api.getRealtimeTicket(tenantId, {
            generation,
            expectGeneration: () => generation,
          })
          return buildInboxWsUrl(window.location, tenantId, ticket)
        } catch (err) {
          if (err instanceof PanelApiError && err.status === 403) {
            throw new RealtimeFatalError(err.code)
          }
          throw err
        }
      },
      onEvent: (event) => {
        if (acceptEvent(event)) {
          if (isInboxEvent(event) && !soundSeen.has(event.eventId)) {
            soundSeen.add(event.eventId)
            if (soundSeen.size > 200) soundSeen.delete(soundSeen.values().next().value as string)
            maybePlayInboundSound(event)
          }
          emit({ kind: 'event', event })
          refreshBadge()
        }
      },
      onResync: (reason) => {
        emit({ kind: 'resync', reason })
        refreshBadge()
      },
      onStateChange: setState,
    })
    conn.start()
    const onVisibility = () => {
      conn.sendPresence()
      if (document.visibilityState === 'visible') {
        conn.notifyVisible()
        refreshBadge()
      }
    }
    const onOnline = () => conn.notifyVisible()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
      removeSoundUnlock()
      badgeStopped = true
      if (badgeTimer) clearTimeout(badgeTimer)
      conn.stop()
    }
  }, [api, tenantId, generation, acceptEvent])

  return (
    <InboxRealtimeContext.Provider value={{ ...ctx, state }}>
      {children}
    </InboxRealtimeContext.Provider>
  )
}

/**
 * Subscreve sinais do inbox com coalescência (vários eventos seguidos → 1 fetch).
 * `handler` recebe a lista de sinais acumulados. Sem provider → no-op.
 */
export function useInboxRealtime(
  handler: (signals: InboxRealtimeSignal[]) => void,
  debounceMs = 150,
): RealtimeState | null {
  const ctx = useContext(InboxRealtimeContext)
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  const subscribe = ctx?.subscribe
  useEffect(() => {
    if (!subscribe) return
    let pending: InboxRealtimeSignal[] = []
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = subscribe((signal) => {
      pending.push(signal)
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        const batch = pending
        pending = []
        handlerRef.current(batch)
      }, debounceMs)
    })
    return () => {
      unsubscribe()
      if (timer !== null) clearTimeout(timer)
    }
  }, [subscribe, debounceMs])

  return ctx?.state ?? null
}
