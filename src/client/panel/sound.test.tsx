import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isSoundEnabled,
  maybePlayInboundSound,
  playMessageSound,
  resetSoundForTests,
  setSoundEnabled,
} from './sound'

const starts = vi.fn()

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
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: (n: unknown) => n,
    }
  }
  resume = vi.fn(async () => {})
}

const inbound = { eventType: 'message.created', payload: { direction: 'inbound' } }

describe('som de mensagem', () => {
  beforeEach(() => {
    starts.mockClear()
    resetSoundForTests()
    window.localStorage.clear()
    Object.defineProperty(window, 'AudioContext', { value: FakeAudioContext, configurable: true })
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })
  afterEach(() => {
    Reflect.deleteProperty(window, 'AudioContext')
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
})
