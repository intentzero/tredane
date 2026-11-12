// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useVisualViewportSheet } from './useVisualViewportSheet'

afterEach(cleanup)

function fakeViewport(height: number, offsetTop = 0) {
  const listeners = new Map<string, Array<() => void>>()
  const view = {
    height,
    offsetTop,
    addEventListener: (type: string, fn: () => void) => {
      const list = listeners.get(type) ?? []
      list.push(fn)
      listeners.set(type, list)
    },
    removeEventListener: vi.fn(),
  }
  Object.defineProperty(window, 'visualViewport', { value: view, configurable: true })
  return {
    view,
    fire: (type = 'resize') => (listeners.get(type) ?? []).forEach((fn) => fn()),
  }
}

describe('useVisualViewportSheet', () => {
  it('mode full: ocupa a área visível e sobe com o teclado', () => {
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true })
    const { view, fire } = fakeViewport(844)
    const { result } = renderHook(() => useVisualViewportSheet(true, { mode: 'full' }))
    expect(result.current).toMatchObject({
      position: 'fixed',
      bottom: 0,
      height: 844,
      maxHeight: 844,
    })
    view.height = 500
    act(fire)
    expect(result.current).toMatchObject({
      bottom: 344,
      height: 500,
      maxHeight: 500,
    })
  })

  it('mode lift: só ajusta bottom/maxHeight com o teclado aberto', () => {
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true })
    const { view, fire } = fakeViewport(844)
    const { result } = renderHook(() => useVisualViewportSheet(true, { mode: 'lift' }))
    expect(result.current).toEqual({})
    view.height = 500
    act(fire)
    expect(result.current).toEqual({ bottom: 344, maxHeight: 500 })
    view.height = 844
    act(fire)
    expect(result.current).toEqual({})
  })

  it('mode lift: inativo devolve estilo vazio', () => {
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true })
    fakeViewport(500)
    const { result } = renderHook(() => useVisualViewportSheet(false, { mode: 'lift' }))
    expect(result.current).toEqual({})
  })

  it('rola o input focado para o centro após focusin', () => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true })
    fakeViewport(500)
    renderHook(() => useVisualViewportSheet(true, { mode: 'lift' }))
    const input = document.createElement('input')
    const scrollIntoView = vi.fn()
    input.scrollIntoView = scrollIntoView
    document.body.appendChild(input)
    act(() => {
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
    vi.useRealTimers()
    input.remove()
  })
})
