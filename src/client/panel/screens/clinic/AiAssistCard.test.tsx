// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'
import '../../../ui/panel.css'
import { AiProfileCard } from './AiAssistCard'

afterEach(cleanup)

function api(): PanelApi {
  return {
    setClinicAiAssist: vi.fn(async () => ({ aiAssistEnabled: true })),
    setClinicAiProfile: vi.fn(async () => ({ ok: true })),
    getPix: vi.fn(async () => ({ signalSettings: { enabled: false, cancellationPolicy: '' } })),
  } as unknown as PanelApi
}

describe('AiProfileCard — layout desktop (clinic-field / clinic-work)', () => {
  it('CSS do clinic-field exclui radio/checkbox e o clinic-work desktop contém o foco absoluto', () => {
    const css = readFileSync(join(__dirname, '../../../ui/panel.css'), 'utf8')
    expect(css).toMatch(
      /\.clinic-field input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\)/,
    )
    expect(css).toMatch(/\.tempo-radio\s*\{[^}]*position:\s*relative/s)
    expect(css).toMatch(
      /@media \(min-width: 1280px\)\s*\{[\s\S]*?\.clinic-work\s*\{[^}]*position:\s*relative/s,
    )
  })

  it('mostra localização e regras gerais', () => {
    render(
      <div className="clinic-work" style={{ height: 480, overflowY: 'auto' }}>
        <AiProfileCard
          tenantId="clinic-demo-a"
          api={api()}
          generation={1}
          initialGoogleBusinessUrl=""
          initialReschedulePolicy=""
        />
      </div>,
    )
    expect(screen.getByRole('region', { name: 'Sobre a clínica' })).toBeTruthy()
    expect(screen.getByLabelText(/Localização/)).toBeTruthy()
    expect(screen.getByLabelText(/Regras gerais/)).toBeTruthy()
  })
})
