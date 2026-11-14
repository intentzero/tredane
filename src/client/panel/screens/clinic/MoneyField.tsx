import type { ReactNode } from 'react'
import { Input, Label, TextField } from 'react-aria-components'
import { formatPriceAmount, maskPriceInput, parsePriceToCents } from './format'

type Props = {
  label: ReactNode
  value: string
  onChange: (value: string) => void
  isDisabled?: boolean
  placeholder?: string
  className?: string
  /** Quando o rótulo já traz contexto (ex.: «Preço (Feminino)»). */
  'aria-label'?: string
}

/** Normaliza valor legado («R$ 50,00», «50», «50,00») para a máscara do campo. */
function amountForInput(value: string): string {
  if (!value.trim()) return ''
  const cents = parsePriceToCents(value)
  if (cents != null) return formatPriceAmount(cents)
  return maskPriceInput(value)
}

/**
 * Campo de preço do painel: prefixo «R$» + máscara BR com centavos ao digitar.
 * O estado continua string («120,00»); `parsePriceToCents` grava centavos no backend.
 */
export function MoneyField({
  label,
  value,
  onChange,
  isDisabled,
  placeholder = '0,00',
  className,
  'aria-label': ariaLabel,
}: Props) {
  return (
    <TextField
      className={['clinic-field', 'clinic-money', className].filter(Boolean).join(' ')}
      isDisabled={isDisabled}
      aria-label={ariaLabel}
      value={amountForInput(value)}
      onChange={(next) => onChange(maskPriceInput(next))}
    >
      <Label>{label}</Label>
      <div className="clinic-money-row">
        <span aria-hidden>R$</span>
        <Input inputMode="decimal" placeholder={placeholder} autoComplete="off" />
      </div>
    </TextField>
  )
}
