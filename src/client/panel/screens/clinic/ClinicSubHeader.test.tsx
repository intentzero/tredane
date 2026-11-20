// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClinicSubScreen } from './ClinicSubHeader'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ClinicSubScreen — chrome móvel sem cobrir o conteúdo', () => {
  it('renderiza o cabeçalho de voltar e o título da subtela', () => {
    render(
      <ClinicSubScreen tenantId="clinic-demo-a" title="Assistente">
        <div className="clinic-page">
          <h2>Atendimento automático no WhatsApp</h2>
        </div>
      </ClinicSubScreen>,
    )
    expect(screen.getByRole('heading', { name: 'Assistente', level: 1 })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Voltar à Clínica' })).toBeTruthy()
    expect(screen.getByText('Atendimento automático no WhatsApp')).toBeTruthy()
    expect(document.querySelector('.clinic-sub > .clinic-sub-header')).toBeTruthy()
    expect(document.querySelector('.clinic-sub > .clinic-page')).toBeTruthy()
  })

  it('CSS: shell flush + header in-flow; sem sticky com margem negativa', () => {
    const css = readFileSync(join(__dirname, '../../../ui/panel.css'), 'utf8')
    // Main sem padding quando a subtela da Clínica é filha directa.
    expect(css).toMatch(
      /\.panel-shell-main:has\(>\s*\.clinic-sub\)\s*\{[^}]*padding:\s*0/s,
    )
    expect(css).toMatch(
      /\.panel-shell-main:has\(>\s*\.clinic-sub\)\s*\{[^}]*overflow:\s*hidden/s,
    )
    // Header fora do scroll — relative/flex, sem position:sticky nem margin negativa.
    expect(css).toMatch(
      /\.clinic-sub-header\s*\{[^}]*position:\s*relative[^}]*flex:\s*none/s,
    )
    expect(css).not.toMatch(
      /\.clinic-sub-header\s*\{[^}]*position:\s*sticky/s,
    )
    expect(css).not.toMatch(
      /\.clinic-sub-header\s*\{[^}]*margin:\s*calc\(-1\s*\*\s*var\(--space-4\)\)/s,
    )
    // Corpo rola sob o chrome com o mesmo ritmo --space-4.
    expect(css).toMatch(
      /\.clinic-sub\s*>\s*\.clinic-page\s*\{[^}]*overflow-y:\s*auto[^}]*padding:\s*var\(--space-4\)/s,
    )
  })

  it('CSS: kn-dock mantém scroll interno sem padding duplo na página', () => {
    const css = readFileSync(join(__dirname, '../../../ui/panel.css'), 'utf8')
    expect(css).toMatch(
      /\.clinic-sub:has\(\.kn-dock\)\s*>\s*\.clinic-page\s*\{[^}]*overflow:\s*hidden[^}]*padding:\s*0\s+var\(--space-4\)/s,
    )
  })
})
