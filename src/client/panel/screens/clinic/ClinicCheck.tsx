import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { Checkbox, type CheckboxProps } from 'react-aria-components'

type Props = Omit<CheckboxProps, 'children'> & { children: ReactNode }

/** Caixa de seleção com quadrado visível (o Checkbox do React Aria não desenha o seu). */
export function ClinicCheck({ children, className = 'clinic-check', ...rest }: Props) {
  return (
    <Checkbox {...rest} className={className as string}>
      {({ isSelected }) => (
        <>
          <span className="clinic-check-box" aria-hidden>
            {isSelected ? <Check size={14} strokeWidth={3} /> : null}
          </span>
          <span className="clinic-check-label">{children}</span>
        </>
      )}
    </Checkbox>
  )
}
