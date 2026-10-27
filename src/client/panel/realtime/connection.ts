/**
 * Ligação WebSocket do inbox (tempo real, um DO por clínica).
 *
 * - Bilhete curto via API autenticada antes de cada (re)ligação.
 * - Reconexão com backoff exponencial + jitter (teto ~30 s).
 * - `onResync` em cada (re)ligação aceite: o ecrã refaz o fetch da lista e da
 *   conversa aberta (simples e correto > aplicar diffs).
 * - Para de religar em `access_revoked` / close 4001 / bilhete negado (403).
 * Sem dependência de React — testável com fake timers.
 */

export type RealtimeServerEvent = {
  type: 'event'
  seq: number
  eventId: string
  eventType: string
  entity: { type: string; id: string }
  occurredAt: number
  payload: Record<string, unknown>
}

export type RealtimeState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'access_revoked' | 'closed'

export type WebSocketLike = {
  readonly readyState: number
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number; reason: string }) => void) | null
  onerror: ((ev: unknown) => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
}

export type RealtimeConnectionOptions = {
  /** Devolve a URL `ws(s)://…/api/tenants/:id/ws?ticket=…` (pede o bilhete). */
  getUrl: () => Promise<string>
  onEvent: (event: RealtimeServerEvent) => void
  /** (Re)ligação aceite (hello) — refazer fetch. */
  onResync: (reason: 'connected' | 'reconnected' | 'visible') => void
  onStateChange?: (state: RealtimeState) => void
  createSocket?: (url: string) => WebSocketLike
  random?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  baseDelayMs?: number
  maxDelayMs?: number
  /** Heartbeat app-level (o DO responde `ping`→`pong` sem acordar). */
  heartbeatMs?: number
  /**
   * Presença (supressão de push no servidor): se definido, o heartbeat e o
   * hello enviam `{type:'presence', visible}` em vez de `ping`.
   */
  getVisible?: () => boolean
}

export const REALTIME_BASE_DELAY_MS = 1_000
export const REALTIME_MAX_DELAY_MS = 30_000

/**
 * Backoff exponencial com "equal jitter": metade fixa + metade aleatória.
 * attempt 0 → [0.5 s, 1 s); … ; teto `maxMs` (≈30 s).
 */
export function computeBackoffMs(
  attempt: number,
  random: () => number = Math.random,
  baseMs = REALTIME_BASE_DELAY_MS,
  maxMs = REALTIME_MAX_DELAY_MS,
): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt))
  const half = exp / 2
  return Math.round(half + random() * half)
}

/** Erro de bilhete que não deve gerar nova tentativa (sem permissão). */
export class RealtimeFatalError extends Error {}

export function buildInboxWsUrl(
  loc: { protocol: string; host: string },
  tenantId: string,
  ticket: string,
): string {
  const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${loc.host}/api/tenants/${encodeURIComponent(tenantId)}/ws?ticket=${encodeURIComponent(ticket)}`
}

export function presenceFrame(visible: boolean): string {
  return JSON.stringify({ v: 1, type: 'presence', visible })
}

export type RealtimeConnection = {
  start(): void
  stop(): void
  /** Reporta visibilidade já (visibilitychange). */
  sendPresence(): void
  /** Aba voltou a ficar visível: refetch e, se caída, religa já. */
  notifyVisible(): void
  readonly state: RealtimeState
  /** Tentativas consecutivas falhadas (testes / diagnóstico). */
  readonly attempt: number
}

export function createRealtimeConnection(opts: RealtimeConnectionOptions): RealtimeConnection {
  const random = opts.random ?? Math.random
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const createSocket =
    opts.createSocket ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike)
  const baseMs = opts.baseDelayMs ?? REALTIME_BASE_DELAY_MS
  const maxMs = opts.maxDelayMs ?? REALTIME_MAX_DELAY_MS
  const heartbeatMs = opts.heartbeatMs ?? 25_000

  let state: RealtimeState = 'idle'
  let attempt = 0
  let everConnected = false
  let socket: WebSocketLike | null = null
  let retryTimer: unknown = null
  let heartbeatTimer: unknown = null
  let stopped = true
  /** Incrementa a cada ligação; descarta callbacks de sockets antigos. */
  let token = 0

  function setState(next: RealtimeState) {
    if (state === next) return
    state = next
    opts.onStateChange?.(next)
  }

  function clearRetry() {
    if (retryTimer !== null) {
      clearTimer(retryTimer)
      retryTimer = null
    }
  }

  function clearHeartbeat() {
    if (heartbeatTimer !== null) {
      clearTimer(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  function scheduleHeartbeat(myToken: number) {
    clearHeartbeat()
    heartbeatTimer = setTimer(() => {
      heartbeatTimer = null
      if (myToken !== token || !socket) return
      try {
        socket.send(opts.getVisible ? presenceFrame(opts.getVisible()) : 'ping')
      } catch {
        /* close tratará */
      }
      scheduleHeartbeat(myToken)
    }, heartbeatMs)
  }

  function scheduleReconnect() {
    if (stopped || state === 'access_revoked') return
    clearRetry()
    const delay = computeBackoffMs(attempt, random, baseMs, maxMs)
    attempt += 1
    setState('reconnecting')
    retryTimer = setTimer(() => {
      retryTimer = null
      void connect()
    }, delay)
  }

  function dropSocket() {
    clearHeartbeat()
    const s = socket
    socket = null
    if (s) {
      s.onopen = null
      s.onmessage = null
      s.onclose = null
      s.onerror = null
      try {
        s.close(1000, 'client_close')
      } catch {
        /* ignore */
      }
    }
  }

  async function connect() {
    if (stopped) return
    clearRetry()
    dropSocket()
    const myToken = ++token
    setState(everConnected ? 'reconnecting' : 'connecting')
    let url: string
    try {
      url = await opts.getUrl()
    } catch (err) {
      if (myToken !== token || stopped) return
      if (err instanceof RealtimeFatalError) {
        setState('access_revoked')
        return
      }
      scheduleReconnect()
      return
    }
    if (myToken !== token || stopped) return

    let s: WebSocketLike
    try {
      s = createSocket(url)
    } catch {
      scheduleReconnect()
      return
    }
    socket = s

    s.onmessage = (ev) => {
      if (myToken !== token) return
      let msg: { type?: unknown } & Record<string, unknown>
      try {
        msg = JSON.parse(String(ev.data)) as typeof msg
      } catch {
        return // 'pong' em texto simples, etc.
      }
      if (msg.type === 'hello') {
        const reconnected = everConnected
        everConnected = true
        attempt = 0
        setState('live')
        scheduleHeartbeat(myToken)
        if (opts.getVisible) {
          try {
            s.send(presenceFrame(opts.getVisible()))
          } catch {
            /* close tratará */
          }
        }
        opts.onResync(reconnected ? 'reconnected' : 'connected')
        return
      }
      if (msg.type === 'event') {
        opts.onEvent(msg as unknown as RealtimeServerEvent)
        return
      }
      if (msg.type === 'access_revoked') {
        setState('access_revoked')
        dropSocket()
      }
    }
    s.onclose = (ev) => {
      if (myToken !== token) return
      clearHeartbeat()
      socket = null
      if (ev.code === 4001) {
        setState('access_revoked')
        return
      }
      scheduleReconnect()
    }
    s.onerror = () => {
      /* onclose segue-se sempre */
    }
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      void connect()
    },
    stop() {
      stopped = true
      token++
      clearRetry()
      dropSocket()
      setState('closed')
    },
    sendPresence() {
      if (!opts.getVisible || !socket || state !== 'live') return
      try {
        socket.send(presenceFrame(opts.getVisible()))
      } catch {
        /* ignore */
      }
    },
    notifyVisible() {
      if (stopped || state === 'access_revoked') return
      if (state === 'live') {
        opts.onResync('visible')
        return
      }
      // Em espera de backoff: religar já (o hello dispara o resync).
      // Tentativa já em curso (bilhete/handshake): não duplicar.
      if (retryTimer === null) return
      attempt = 0
      void connect()
    },
    get state() {
      return state
    },
    get attempt() {
      return attempt
    },
  }
}
