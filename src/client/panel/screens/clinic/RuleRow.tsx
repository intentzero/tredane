import type { ReactNode } from 'react'

type Props = {
  label: string
  value: string
  onPress?: () => void
  /** Estado visual opcional (ex.: aviso). */
  tone?: 'neutral' | 'warn'
  /** Conteúdo extra sob o valor (erro inline). */
  error?: string | null
  children?: ReactNode
}

/**
 * Linha de regra da ficha do serviço (DEC-084): rótulo + estado; toque abre editor ou folha.
 */
export function RuleRow({ label, value, onPress, tone = 'neutral', error, children }: Props) {
  const body = (
    <>
      <span className="rule-row-copy">
        <strong>{label}</strong>
        <span data-tone={tone === 'warn' ? 'warn' : undefined}>{value}</span>
      </span>
      {onPress ? (
        <span aria-hidden className="rule-row-chev">
          ›
        </span>
      ) : null}
    </>
  )
  return (
    <div className="rule-row" data-has-error={error ? '' : undefined}>
      {onPress ? (
        <button type="button" className="rule-row-btn" onClick={onPress}>
          {body}
        </button>
      ) : (
        <div className="rule-row-btn" role="group" aria-label={label}>
          {body}
        </div>
      )}
      {children}
      {error ? (
        <p className="clinic-form-error rule-row-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
