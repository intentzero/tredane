import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computeBackoffMs,
  createRealtimeConnection,
  RealtimeFatalError,
  REALTIME_MAX_DELAY_MS,
  type WebSocketLike,
} from './connection'

class FakeSocket implements WebSocketLike {
  static all: FakeSocket[] = []
  readyState = 0
  onopen: WebSocketLike['onopen'] = null
  onmessage: WebSocketLike['onmessage'] = null
  onclose: WebSocketLike['onclose'] = null
  onerror: WebSocketLike['onerror'] = null
  sent: string[] = []
  closed = false
  constructor(readonly url: string) {
    FakeSocket.all.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.closed = true
  }
  hello() {
    this.readyState = 1
    this.onmessage?.({ data: JSON.stringify({ v: 1, type: 'hello', connectionId: 'ws_1' }) })
  }
  drop(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code, reason: '' })
  }
}

function setup(overrides: Partial<Parameters<typeof createRealtimeConnection>[0]> = {}) {
  const resyncs: string[] = []
  const events: string[] = []
  const states: string[] = []
  let n = 0
  const getUrl = vi.fn(async () => `ws://x/api/tenants/t/ws?ticket=t${++n}`)
  const conn = createRealtimeConnection({
    getUrl,
    onEvent: (e) => events.push(e.eventType),
    onResync: (r) => resyncs.push(r),
    onStateChange: (s) => states.push(s),
    createSocket: (url) => new FakeSocket(url),
    random: () => 0.5,
    ...overrides,
  })
  return { conn, resyncs, events, states, getUrl }
}

const last = () => FakeSocket.all[FakeSocket.all.length - 1]!

describe('backoff exponencial com jitter', () => {
  it('cresce 2× por tentativa, com jitter em [50%,100%] e teto ~30 s', () => {
    expect(computeBackoffMs(0, () => 0)).toBe(500)
    expect(computeBackoffMs(0, () => 0.999)).toBeLessThanOrEqual(1_000)
    expect(computeBackoffMs(1, () => 0)).toBe(1_000)
    expect(computeBackoffMs(3, () => 0)).toBe(4_000)
    for (const a of [5, 6, 10, 50]) {
      expect(computeBackoffMs(a, () => 0.999)).toBeLessThanOrEqual(REALTIME_MAX_DELAY_MS)
      expect(computeBackoffMs(a, () => 0)).toBe(REALTIME_MAX_DELAY_MS / 2)
    }
  })
})

describe('ligação WS do inbox (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeSocket.all = []
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('liga, entrega eventos e faz resync no hello', async () => {
    const { conn, resyncs, events } = setup()
    conn.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(FakeSocket.all).toHaveLength(1)
    last().hello()
    expect(conn.state).toBe('live')
    expect(resyncs).toEqual(['connected'])
    last().onmessage?.({
      data: JSON.stringify({ type: 'event', eventType: 'message.created', payload: {} }),
    })
    expect(events).toEqual(['message.created'])
    conn.stop()
  })

  it('religa com backoff crescente (jitter) até ~30 s e repõe após hello', async () => {
    const { conn, resyncs, getUrl } = setup()
    conn.start()
    await vi.advanceTimersByTimeAsync(0)
    last().hello()

    // random=0.5 → 75% do exponencial: 750, 1500, 3000, 6000, 12000, 22500, 22500…
    const expected = [750, 1_500, 3_000, 6_000, 12_000, 22_500, 22_500]
    for (const delay of expected) {
      const before = FakeSocket.all.length
      last().drop()
      expect(conn.state).toBe('reconnecting')
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(FakeSocket.all.length).toBe(before)
      await vi.advanceTimersByTimeAsync(1)
      expect(FakeSocket.all.length).toBe(before + 1)
    }
    // Cada tentativa pede bilhete novo (uso único).
    expect(getUrl).toHaveBeenCalledTimes(expected.length + 1)

    last().hello()
    expect(conn.attempt).toBe(0)
    expect(resyncs).toEqual(['connected', 'reconnected'])

    // Após hello o backoff volta ao início.
    const before = FakeSocket.all.length
    last().drop()
    await vi.advanceTimersByTimeAsync(750)
    expect(FakeSocket.all.length).toBe(before + 1)
    conn.stop()
  })

  it('falha ao obter bilhete (rede) também religa com backoff', async () => {
    let fail = true
    const { conn } = setup({
      getUrl: async () => {
        if (fail) throw new Error('network')
        return 'ws://x/ws?ticket=ok'
      },
    })
    conn.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(FakeSocket.all).toHaveLength(0)
    expect(conn.state).toBe('reconnecting')
    fail = false
    await vi.advanceTimersByTimeAsync(750)
    expect(FakeSocket.all).toHaveLength(1)
    conn.stop()
  })

  it('access_revoked / close 4001 / bilhete 403 param as tentativas', async () => {
    const a = setup()
    a.conn.start()
    await vi.advanceTimersByTimeAsync(0)
    last().hello()
    last().onmessage?.({ data: JSON.stringify({ type: 'access_revoked', reason: 'membership_revoked' }) })
    expect(a.conn.state).toBe('access_revoked')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(FakeSocket.all).toHaveLength(1)

    FakeSocket.all = []
    const b = setup()
    b.conn.start()
    await vi.advanceTimersByTimeAsync(0)
    last().drop(4001)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(b.conn.state).toBe('access_revoked')
    expect(FakeSocket.all).toHaveLength(1)

    FakeSocket.all = []
    const c = setup({
      getUrl: async () => {
        throw new RealtimeFatalError('tenant_access_denied')
      },
    })
    c.conn.start()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(c.conn.state).toBe('access_revoked')
    expect(FakeSocket.all).toHaveLength(0)
  })

  it('aba visível: resync se ligada; religa já se em backoff', async () => {
    const { conn, resyncs } = setup()
    conn.start()
    await vi.advanceTimersByTimeAsync(0)
    last().hello()
    conn.notifyVisible()
    expect(resyncs).toEqual(['connected', 'visible'])

    // Várias quedas → backoff longo; visível religa sem esperar.
    for (let i = 0; i < 5; i++) {
      last().drop()
      await vi.advanceTimersByTimeAsync(30_000)
    }
    last().drop()
    const before = FakeSocket.all.length
    conn.notifyVisible()
    await vi.advanceTimersByTimeAsync(0)
    expect(FakeSocket.all.length).toBe(before + 1)
    last().hello()
    expect(resyncs[resyncs.length - 1]).toBe('reconnected')
    conn.stop()
  })

  it('stop fecha o socket e cancela religações pendentes', async () => {
    const { conn } = setup()
    conn.start()
    await vi.advanceTimersByTimeAsync(0)
    const s = last()
    s.hello()
    conn.stop()
    expect(s.closed).toBe(true)
    s.drop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeSocket.all).toHaveLength(1)
    expect(conn.state).toBe('closed')
  })

  it('heartbeat envia ping enquanto ligado', async () => {
    const { conn } = setup({ heartbeatMs: 1_000 })
    conn.start()
    await vi.advanceTimersByTimeAsync(0)
    last().hello()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(last().sent).toEqual(['ping', 'ping'])
    conn.stop()
  })
})
