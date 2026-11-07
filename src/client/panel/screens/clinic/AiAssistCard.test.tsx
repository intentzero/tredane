// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'
import '../../../ui/panel.css'
import { AiAssistCard } from './AiAssistCard'

afterEach(cleanup)

function api(): PanelApi {
  return {
    setClinicAiAssist: vi.fn(async () => ({ aiAssistEnabled: true })),
    setClinicAiProfile: vi.fn(async () => ({ ok: true })),
  } as unknown as PanelApi
}

function renderCard(over: { gender?: 'masculino' | 'feminino' | null; name?: string } = {}) {
  return render(
    <div className="clinic-work" style={{ height: 480, overflowY: 'auto' }}>
      <div style={{ height: 320 }} aria-hidden="true" />
      <AiAssistCard
        tenantId="clinic-demo-a"
        api={api()}
        generation={1}
        initialEnabled
        initialVirtualAttendantName={over.name ?? 'Gioconda'}
        initialVirtualAttendantGender={over.gender ?? 'feminino'}
      />
    </div>,
  )
}

function radioMinHeightOk(minH: string): boolean {
  if (minH === '' || minH === '0px' || minH === 'auto') return true
  const px = Number.parseFloat(minH)
  return Number.isFinite(px) && px <= 1
}

describe('AiAssistCard — género do atendente (layout desktop)', () => {
  it('mantém nome, os três géneros e «Salvar dados para a IA» visíveis ao trocar para Masculino', () => {
    renderCard()
    const card = screen.getByRole('region', { name: 'Sugestões com IA' })
    const group = within(card).getByRole('radiogroup', { name: 'Género do atendente virtual' })

    fireEvent.click(within(group).getByRole('radio', { name: 'Masculino' }))

    expect(within(card).getByDisplayValue('Gioconda')).toBeTruthy()
    expect(within(group).getByRole('radio', { name: 'Neutro' })).toBeTruthy()
    expect(within(group).getByRole('radio', { name: 'Feminino' })).toBeTruthy()
    const masculino = within(group).getByRole('radio', { name: 'Masculino' })
    expect(masculino).toBeTruthy()
    expect((masculino as HTMLInputElement).checked).toBe(true)
    expect(within(card).getByRole('button', { name: 'Salvar dados para a IA' })).toBeTruthy()

    // Inputs escondidos do React Aria não herdam o min-height 48px dos campos de texto.
    for (const radio of within(group).getAllByRole('radio')) {
      expect(radioMinHeightOk(getComputedStyle(radio).minHeight)).toBe(true)
    }
  })

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
})
