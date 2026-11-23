// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BrandHorizontal, BrandMark, BrandStacked } from './Brand'

afterEach(cleanup)

describe('logotipo oficial', () => {
  it('símbolo, horizontal e empilhado têm o nome Tredane e vêm dos SVG da marca', () => {
    render(
      <>
        <BrandMark size={32} />
        <BrandHorizontal height={40} />
        <BrandStacked width={132} />
      </>,
    )
    const imgs = screen.getAllByRole('img', { name: 'Tredane' })
    // símbolo (claro e escuro), horizontal (claro e escuro) e empilhado
    expect(imgs).toHaveLength(5)
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(
      expect.arrayContaining([
        // O símbolo é pequeno e o Vite o embute (data URI): confere as cores oficiais
        // (Violeta e Tinta, marca revista em 23/11/2026; antes Petróleo e Damasco).
        expect.stringMatching(/5C32C9.*211339/),
        // Versão para fundo escuro: traço Lavanda e ponto Lima.
        expect.stringMatching(/CBB8FF.*D5FF55/),
        expect.stringContaining('tredane-horizontal-cor'),
        expect.stringContaining('tredane-horizontal-escuro'),
        expect.stringContaining('tredane-empilhado-cor'),
      ]),
    )
  })

  it('o símbolo respeita o tamanho mínimo de 16 px', () => {
    render(<BrandMark size={32} />)
    // As duas versões (fundo claro e escuro) respeitam o mínimo.
    for (const img of screen.getAllByRole('img', { name: 'Tredane' })) {
      expect(Number(img.getAttribute('width'))).toBeGreaterThanOrEqual(16)
    }
  })
})
