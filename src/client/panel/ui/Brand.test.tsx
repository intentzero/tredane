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
    expect(imgs).toHaveLength(4)
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(
      expect.arrayContaining([
        // O símbolo é pequeno e o Vite o embute (data URI): confere as cores oficiais.
        expect.stringMatching(/0E5A5C.*E8875A/),
        expect.stringContaining('tredane-horizontal-cor'),
        expect.stringContaining('tredane-horizontal-escuro'),
        expect.stringContaining('tredane-empilhado-cor'),
      ]),
    )
  })

  it('o símbolo respeita o tamanho mínimo de 16 px', () => {
    render(<BrandMark size={32} />)
    const img = screen.getByRole('img', { name: 'Tredane' })
    expect(Number(img.getAttribute('width'))).toBeGreaterThanOrEqual(16)
  })
})
