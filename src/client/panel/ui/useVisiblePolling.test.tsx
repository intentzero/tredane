// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVisiblePolling } from './useVisiblePolling'

function Probe({ fn }: { fn: () => void }) {
  useVisiblePolling(fn, 1000)
  return null
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useVisiblePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setVisibility('visible')
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('repete enquanto a aba está visível', () => {
    const fn = vi.fn()
    render(<Probe fn={fn} />)
    vi.advanceTimersByTime(3000)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('para com a aba oculta e chama de novo ao voltar a ficar visível', () => {
    const fn = vi.fn()
    render(<Probe fn={fn} />)
    setVisibility('hidden')
    vi.advanceTimersByTime(10_000)
    expect(fn).not.toHaveBeenCalled()
    setVisibility('visible')
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2000)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('não repete depois de desmontar', () => {
    const fn = vi.fn()
    const { unmount } = render(<Probe fn={fn} />)
    unmount()
    vi.advanceTimersByTime(5000)
    expect(fn).not.toHaveBeenCalled()
  })
})
