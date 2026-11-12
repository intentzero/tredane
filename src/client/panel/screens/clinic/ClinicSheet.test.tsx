// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClinicSheet } from './ClinicSheet'

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

describe('ClinicSheet — teclado iOS', () => {
  it('com teclado aberto sobe a folha (bottom + maxHeight do visualViewport)', () => {
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: query.includes('min-width: 1280') ? false : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
    const { view, fire } = fakeViewport(844)
    render(
      <ClinicSheet isOpen onOpenChange={() => {}} title="Convidar pessoa">
        <label>
          E-mail
          <input type="email" />
        </label>
      </ClinicSheet>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Convidar pessoa' })
    expect(dialog.style.bottom).toBe('')
    expect(dialog.style.maxHeight).toBe('')
    view.height = 480
    act(fire)
    expect(dialog.style.bottom).toBe('364px')
    expect(dialog.style.maxHeight).toBe('480px')
  })

  it('CSS: com data-keyboard=open a folha limita-se a --panel-vvh', () => {
    const css = readFileSync(join(__dirname, '../../../ui/panel.css'), 'utf8')
    expect(css).toMatch(
      /:root\[data-keyboard=['"]open['"]\]\s*\.clinic-sheet\.panel-choice-sheet\s*\{[^}]*max-height:\s*var\(--panel-vvh/s,
    )
  })
})
