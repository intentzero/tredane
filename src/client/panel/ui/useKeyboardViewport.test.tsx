// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useKeyboardViewport } from './useKeyboardViewport'

afterEach(cleanup)

function fakeViewport(height: number) {
  const listeners = new Map<string, Array<() => void>>()
  const view = {
    height,
    offsetTop: 0,
    scale: 1,
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

describe('useKeyboardViewport', () => {
  it('publica --panel-vvh só com o teclado aberto', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true })
    const { view, fire } = fakeViewport(844)
    const { unmount } = renderHook(() => useKeyboardViewport())
    const root = document.documentElement
    expect(root.style.getPropertyValue('--panel-vvh')).toBe('')
    view.height = 500
    act(fire)
    expect(root.style.getPropertyValue('--panel-vvh')).toBe('500px')
    expect(root.style.getPropertyValue('--keyboard-inset-bottom')).toBe('344px')
    expect(root.dataset.keyboard).toBe('open')
    view.height = 844
    act(fire)
    expect(root.style.getPropertyValue('--panel-vvh')).toBe('')
    expect(root.dataset.keyboard).toBeUndefined()
    unmount()
  })

  it('repor scroll do documento ao abrir e fechar o teclado', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })
    const scrollTo = vi.fn()
    Object.defineProperty(window, 'scrollTo', { value: scrollTo, configurable: true })
    Object.defineProperty(window, 'scrollY', { value: 120, configurable: true, writable: true })
    Object.defineProperty(window, 'scrollX', { value: 0, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true })
    const { view, fire } = fakeViewport(844)
    const { unmount } = renderHook(() => useKeyboardViewport())
    view.height = 500
    act(fire)
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
    scrollTo.mockClear()
    Object.defineProperty(window, 'scrollY', { value: 80, configurable: true, writable: true })
    view.height = 844
    act(fire)
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
    unmount()
  })
})
