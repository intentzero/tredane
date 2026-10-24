import { render } from '@testing-library/react'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'
import { ReactAriaAgendar } from './react-aria/Agendar'
import { ReactAriaAcompanhamento } from './react-aria/Acompanhamento'
import '../ui/panel.css'

async function expectNoAxeViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: {
      // jsdom não calcula contraste de forma fiável; contraste é coberto por check_contrast.py
      'color-contrast': { enabled: false },
    },
  })
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
}

describe('prova F0 — axe em M-04 e M-05 (React Aria, DEC-048)', () => {
  it('React Aria M-04 sem violações axe', async () => {
    const { container } = render(
      <div className="panel-root">
        <ReactAriaAgendar />
      </div>,
    )
    await expectNoAxeViolations(container)
  })

  it('React Aria M-05 sem violações axe', async () => {
    const { container } = render(
      <div className="panel-root">
        <ReactAriaAcompanhamento />
      </div>,
    )
    await expectNoAxeViolations(container)
  })
})
