import horizontalUrl from '../../../../docs/design/brand/svg/tredane-horizontal-cor.svg?url'
import horizontalDarkUrl from '../../../../docs/design/brand/svg/tredane-horizontal-escuro.svg?url'
import stackedUrl from '../../../../docs/design/brand/svg/tredane-empilhado-cor.svg?url'
import symbolUrl from '../../../../docs/design/brand/svg/tredane-simbolo-cor.svg?url'

/**
 * Logotipo oficial (DEC-050), usado como vem de docs/design/brand: sem alterar cor,
 * proporção nem espaçamento. Símbolo ≥ 16 px; horizontal ≥ 24 px de altura.
 */

/** Símbolo sozinho (cabeçalho do celular e menu do desktop). */
export function BrandMark({ size = 32, label = 'Tredane' }: { size?: number; label?: string }) {
  return (
    <img
      className="brand-mark"
      src={symbolUrl}
      width={size}
      height={size}
      alt={label}
      draggable={false}
    />
  )
}

/**
 * Símbolo + nome lado a lado (entrar).
 * Fundo claro: arte `cor`. Fundo escuro: arte `escuro` (DEC-098). O CSS escolhe;
 * as duas ficam no DOM para o tema do sistema mudar sem flash.
 */
export function BrandHorizontal({ height = 40 }: { height?: number }) {
  return (
    <span className="brand-swap">
      <img
        className="brand-horizontal brand-on-light"
        src={horizontalUrl}
        height={height}
        alt="Tredane"
        draggable={false}
      />
      <img
        className="brand-horizontal brand-on-dark"
        src={horizontalDarkUrl}
        height={height}
        alt="Tredane"
        draggable={false}
      />
    </span>
  )
}

/** Símbolo acima do nome (escolher clínica). */
export function BrandStacked({ width = 132 }: { width?: number }) {
  return (
    <img
      className="brand-stacked"
      src={stackedUrl}
      width={width}
      alt="Tredane"
      draggable={false}
    />
  )
}
