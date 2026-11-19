// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isEditableKeyboardTarget, useKeyboardViewport } from './useKeyboardViewport'

afterEach(cleanup)

function fakeViewport(height: number, offsetTop = 0) {
  const listeners = new Map<string, Array<() => void>>()
  const view = {
    height,
    offsetTop,
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

function focusTextInput() {
  const input = document.createElement('input')
  input.type = 'text'
  document.body.appendChild(input)
  input.focus()
  return input
}

describe('isEditableKeyboardTarget', () => {
  it('aceita texto, textarea e contenteditable; recusa botão e checkbox', () => {
    const text = document.createElement('input')
    text.type = 'text'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    const button = document.createElement('input')
    button.type = 'button'
    const area = document.createElement('textarea')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    expect(isEditableKeyboardTarget(text)).toBe(true)
    expect(isEditableKeyboardTarget(area)).toBe(true)
    expect(isEditableKeyboardTarget(editable)).toBe(true)
    expect(isEditableKeyboardTarget(checkbox)).toBe(false)
    expect(isEditableKeyboardTarget(button)).toBe(false)
    expect(isEditableKeyboardTarget(null)).toBe(false)
  })
})

describe('useKeyboardViewport', () => {
  it('não publica vars só porque o visualViewport encolheu (chrome Safari / sem foco)', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true })
    const { view, fire } = fakeViewport(844)
    const { unmount } = renderHook(() => useKeyboardViewport())
    const root = document.documentElement
    view.height = 500
    view.offsetTop = 80
    act(fire)
    expect(root.style.getPropertyValue('--panel-vvh')).toBe('')
    expect(root.dataset.keyboard).toBeUndefined()
    unmount()
  })

  it('publica --panel-vvh / --panel-vv-top só com teclado aberto e campo focado', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true })
    const { view, fire } = fakeViewport(844)
    const { unmount } = renderHook(() => useKeyboardViewport())
    const root = document.documentElement
    const input = focusTextInput()
    expect(root.style.getPropertyValue('--panel-vvh')).toBe('')
    expect(root.style.getPropertyValue('--panel-vv-top')).toBe('')
    view.height = 500
    view.offsetTop = 80
    act(fire)
    expect(root.style.getPropertyValue('--panel-vvh')).toBe('500px')
    expect(root.style.getPropertyValue('--panel-vv-top')).toBe('80px')
    expect(root.style.getPropertyValue('--keyboard-inset-bottom')).toBe('264px')
    expect(root.dataset.keyboard).toBe('open')
    view.height = 844
    view.offsetTop = 0
    act(fire)
    expect(root.style.getPropertyValue('--panel-vvh')).toBe('')
    expect(root.style.getPropertyValue('--panel-vv-top')).toBe('')
    expect(root.dataset.keyboard).toBeUndefined()
    input.remove()
    unmount()
  })

  it('limpa data-keyboard ao desfocar o campo mesmo com viewport ainda encolhido', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true })
    const { view, fire } = fakeViewport(844)
    const { unmount } = renderHook(() => useKeyboardViewport())
    const root = document.documentElement
    const input = focusTextInput()
    view.height = 500
    view.offsetTop = 80
    act(fire)
    expect(root.dataset.keyboard).toBe('open')
    act(() => {
      input.blur()
      document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(root.dataset.keyboard).toBeUndefined()
    expect(root.style.getPropertyValue('--panel-vvh')).toBe('')
    input.remove()
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
    const input = focusTextInput()
    view.height = 500
    act(fire)
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
    scrollTo.mockClear()
    Object.defineProperty(window, 'scrollY', { value: 80, configurable: true, writable: true })
    view.height = 844
    act(fire)
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
    input.remove()
    unmount()
  })
})
