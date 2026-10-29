import horizontalUrl from '../../../../docs/design/brand/svg/tredane-horizontal-cor.svg?url'
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

/** Símbolo + nome lado a lado (entrar). */
export function BrandHorizontal({ height = 40 }: { height?: number }) {
  return (
    <img
      className="brand-horizontal"
      src={horizontalUrl}
      height={height}
      alt="Tredane"
      draggable={false}
    />
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
