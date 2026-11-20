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
    // O botão «Adicionar» herda width:100% de .panel-btn-secondary: sem width:auto esmaga o campo.
    expect(css).toMatch(/\.kn-new-cat > \.panel-btn-secondary\s*\{[^}]*width:\s*auto/)
  })

  it('CSS: teclado aberto no mobile esconde a tab bar (não flutua acima do teclado)', () => {
    const css = readFileSync(join(__dirname, '../../../ui/panel.css'), 'utf8')
    // Pin do shell (#959) mantém-se em todo .panel-app.
    expect(css).toMatch(
      /:root\[data-keyboard=['"]open['"]\]\s*\.panel-app\s*\{[^}]*height:\s*var\(--panel-vvh\)/s,
    )
    // Tab bar some com teclado no telemóvel — não volta a subir sobre o accessory bar.
    expect(css).toMatch(
      /@media\s*\(max-width:\s*767\.98px\)\s*\{[^}]*:root\[data-keyboard=['"]open['"]\]\s*\.panel-nav\s*\{[^}]*display:\s*none/s,
    )
    // Rodapé do editor Knowledge continua a sumir (M-64).
    expect(css).toMatch(
      /:root\[data-keyboard=['"]open['"]\]\s*\.clinic-footer-sticky\s*,\s*:root\[data-keyboard=['"]open['"]\]\s*\.clinic-footer-dock\s*,\s*:root\[data-keyboard=['"]open['"]\]\s*\.kn-footer\s*\{[^}]*display:\s*none/s,
    )
  })

  it('sugestões sem endereço; tocar numa dá exemplo no campo da resposta; o cartão de cima só aparece na lista', async () => {
    render(
      <KnowledgeScreen
        tenantId="clinic-demo-a"
        api={api()}
        generation={1}
        lead={<section aria-label="Sobre a clínica">cartão</section>}
      />,
    )
    expect(await screen.findByRole('region', { name: 'Sobre a clínica' })).toBeTruthy()
    expect(screen.queryByText('Qual o endereço e como chegar?')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Tem estacionamento\?/ }))
    const resposta = (await screen.findByRole('textbox', { name: 'Resposta à cliente' })) as HTMLTextAreaElement
    expect(resposta.value).toBe('')
    expect(resposta.placeholder).toMatch(/estacionamento conveniado/)
    expect(screen.queryByRole('region', { name: 'Sobre a clínica' })).toBeNull()
  })

  it('avisa quando o editor abre ou fecha e fecha quando o cabeçalho pede «Voltar sem salvar»', async () => {
    const onEditorChange = vi.fn()
    const { rerender } = render(
      <KnowledgeScreen tenantId="clinic-demo-a" api={api()} generation={1} onEditorChange={onEditorChange} closeEditorSignal={0} />,
    )
    expect(await screen.findByRole('button', { name: /Escrever outra pergunta/ })).toBeTruthy()
    expect(onEditorChange).toHaveBeenLastCalledWith(null)
    fireEvent.click(screen.getByRole('button', { name: /Escrever outra pergunta/ }))
    expect(await screen.findByRole('textbox', { name: 'Pergunta' })).toBeTruthy()
    expect(onEditorChange).toHaveBeenLastCalledWith('new')
    // O cabeçalho tem o seu «Voltar sem salvar»: o do corpo some.
    expect(screen.queryByRole('button', { name: /Voltar sem salvar/ })).toBeNull()
    rerender(
      <KnowledgeScreen tenantId="clinic-demo-a" api={api()} generation={1} onEditorChange={onEditorChange} closeEditorSignal={1} />,
    )
    expect(await screen.findByRole('button', { name: /Escrever outra pergunta/ })).toBeTruthy()
    expect(onEditorChange).toHaveBeenLastCalledWith(null)
  })
})
