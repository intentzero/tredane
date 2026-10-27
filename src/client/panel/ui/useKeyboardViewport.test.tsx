// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useKeyboardViewport } from './useKeyboardViewport'

afterEach(cleanup)

function fakeViewport(height: number) {
  const listeners: Array<() => void> = []
  const view = {
    height,
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
    removeEventListener: vi.fn(),
  }
  Object.defineProperty(window, 'visualViewport', { value: view, configurable: true })
  return { view, fire: () => listeners.forEach((fn) => fn()) }
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
    expect(root.dataset.keyboard).toBe('open')
    view.height = 844
    act(fire)
    expect(root.style.getPropertyValue('--panel-vvh')).toBe('')
    expect(root.dataset.keyboard).toBeUndefined()
    unmount()
  })
})
