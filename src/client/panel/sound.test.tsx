import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APPOINTMENT_CONFIRMED_SOUND_URL,
  isSoundEnabled,
  maybePlayAppointmentConfirmedSound,
  maybePlayHandoffEscalateSound,
  maybePlayHandoffSound,
  maybePlayInboundSound,
  playMessageSound,
  resetSoundForTests,
  setSoundEnabled,
} from './sound'

const starts = vi.fn()
const bufferStarts = vi.fn()

class FakeAudioContext {
  state = 'running'
  currentTime = 0
  destination = {}
  createOscillator() {
    const osc = {
      type: '',
      frequency: { value: 0 },
      connect: (n: unknown) => n,
      start: starts,
      stop: vi.fn(),
    }
    return osc
  }
  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), value: 1 },
      connect: (n: unknown) => n,
    }
  }
  createBufferSource() {
    return {
      buffer: null as AudioBuffer | null,
      connect: (n: unknown) => n,
      start: bufferStarts,
      stop: vi.fn(),
    }
  }
  decodeAudioData(raw: ArrayBuffer) {
    return Promise.resolve({ duration: 1, length: raw.byteLength } as AudioBuffer)
  }
  resume = vi.fn(async () => {})
}

const inbound = { eventType: 'message.created', payload: { direction: 'inbound' } }

describe('som de mensagem', () => {
  beforeEach(() => {
    starts.mockClear()
    bufferStarts.mockClear()
    resetSoundForTests()
    window.localStorage.clear()
    Object.defineProperty(window, 'AudioContext', { value: FakeAudioContext, configurable: true })
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    )
  })
  afterEach(() => {
    Reflect.deleteProperty(window, 'AudioContext')
    vi.unstubAllGlobals()
  })

  it('vem ligado por omissão e respeita a preferência', () => {
    expect(isSoundEnabled()).toBe(true)
    setSoundEnabled(false)
    expect(isSoundEnabled()).toBe(false)
    setSoundEnabled(true)
    expect(isSoundEnabled()).toBe(true)
  })

  it('toca duas notas em mensagem recebida', () => {
    // primeiro uso cria o contexto; fica 'running' no fake
    expect(maybePlayInboundSound(inbound)).toBe(true)
    expect(starts).toHaveBeenCalledTimes(2)
  })

  it('não toca em mensagem enviada nem em outros eventos', () => {
    expect(maybePlayInboundSound({ eventType: 'message.created', payload: { direction: 'outbound' } })).toBe(false)
    expect(maybePlayInboundSound({ eventType: 'message.delivery_updated', payload: { direction: 'inbound' } })).toBe(false)
    expect(starts).not.toHaveBeenCalled()
  })

  it('não toca com som desligado ou aba em segundo plano', () => {
    setSoundEnabled(false)
    expect(maybePlayInboundSound(inbound)).toBe(false)
    setSoundEnabled(true)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    expect(maybePlayInboundSound(inbound)).toBe(false)
    expect(starts).not.toHaveBeenCalled()
  })

  it('sem Web Audio não falha', () => {
    Reflect.deleteProperty(window, 'AudioContext')
    expect(playMessageSound()).toBe(false)
  })

  it('toca handoff e reforço com painel visível', () => {
    expect(
      maybePlayHandoffSound({
        eventType: 'conversation.ai_pause',
        payload: { aiReplyPaused: true, source: 'handoff', handoffTimeoutAt: 1 },
      }),
    ).toBe(true)
    expect(starts).toHaveBeenCalled()
    starts.mockClear()
    expect(
      maybePlayHandoffEscalateSound({
        eventType: 'conversation.needs_person_escalate',
        payload: { escalate: true },
      }),
    ).toBe(true)
    expect(starts).toHaveBeenCalled()
  })

  it('não toca handoff em resume, pause false ou aba oculta', () => {
    expect(
      maybePlayHandoffSound({
        eventType: 'conversation.ai_pause',
        payload: { aiReplyPaused: false, source: 'manual_resume' },
      }),
    ).toBe(false)
    expect(
      maybePlayHandoffSound({
        eventType: 'conversation.ai_pause',
        payload: { aiReplyPaused: false, source: 'timeout_resume' },
      }),
    ).toBe(false)
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    })
    expect(
      maybePlayHandoffSound({
        eventType: 'conversation.ai_pause',
        payload: { aiReplyPaused: true, source: 'handoff' },
      }),
    ).toBe(false)
  })

  it('toca campainha Mixkit só em appointment.confirmed', async () => {
    expect(
      maybePlayAppointmentConfirmedSound({ eventType: 'appointment.confirmed', payload: {} }),
    ).toBe(true)
    expect(fetch).toHaveBeenCalledWith(APPOINTMENT_CONFIRMED_SOUND_URL)
    await vi.waitFor(() => expect(bufferStarts).toHaveBeenCalled())
    bufferStarts.mockClear()
    expect(
      maybePlayAppointmentConfirmedSound({ eventType: 'appointment.rescheduled', payload: {} }),
    ).toBe(false)
    expect(
      maybePlayAppointmentConfirmedSound({ eventType: 'opportunity.created', payload: {} }),
    ).toBe(false)
    expect(bufferStarts).not.toHaveBeenCalled()
  })

  it('não toca campainha com som desligado ou aba oculta', () => {
    setSoundEnabled(false)
    expect(
      maybePlayAppointmentConfirmedSound({ eventType: 'appointment.confirmed', payload: {} }),
    ).toBe(false)
    setSoundEnabled(true)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    expect(
      maybePlayAppointmentConfirmedSound({ eventType: 'appointment.confirmed', payload: {} }),
    ).toBe(false)
    expect(bufferStarts).not.toHaveBeenCalled()
  })
})

