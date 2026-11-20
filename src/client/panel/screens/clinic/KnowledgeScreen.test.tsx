// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelApi } from '../../api'
import '../../../ui/panel.css'
import { KnowledgeScreen } from './KnowledgeScreen'

afterEach(cleanup)

function api(): PanelApi {
  return {
    listKnowledgeCategories: vi.fn(async () => []),
    listKnowledgeEntries: vi.fn(async () => []),
  } as unknown as PanelApi
}

describe('Respostas da clínica — editor da pergunta', () => {
  it('os campos têm o estilo dos outros ecrãs (.clinic-field) e a caixa das palavras estica', async () => {
    render(<KnowledgeScreen tenantId="clinic-demo-a" api={api()} generation={1} />)
    fireEvent.click(await screen.findByRole('button', { name: /Escrever outra pergunta/ }))
    const pergunta = await screen.findByRole('textbox', { name: 'Pergunta' })
    expect(pergunta.closest('.clinic-field')).not.toBeNull()
    expect(screen.getByRole('textbox', { name: 'Resposta à cliente' }).closest('.clinic-field')).not.toBeNull()
    expect(screen.getByRole('textbox', { name: 'Categoria' }).closest('.clinic-field')).not.toBeNull()
    const palavra = screen.getByRole('textbox', { name: 'Nova palavra' })
    expect(palavra.className).toContain('kn-cue-input')
    const css = readFileSync(join(__dirname, '../../../ui/panel.css'), 'utf8')
    expect(css).toMatch(/\.kn-cue-input\s*\{[^}]*flex:\s*1/)
  })
})
