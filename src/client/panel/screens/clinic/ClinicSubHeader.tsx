import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from 'react-aria-components'
import { navigatePanel } from '../../routes'

type Props = {
  tenantId: string
  title: string
  children: ReactNode
  /** Para onde volta e o que diz; por defeito, o início da Clínica. */
  back?: { section: 'servicos'; label: string; eyebrow: string }
}

/**
 * DEC-163: no celular, as telas internas da Clínica têm um só cabeçalho de 56 px
 * (voltar, título, «Clínica»); o cabeçalho global e os «Voltar» soltos somem (CSS).
 */
export function ClinicSubScreen({ tenantId, title, children, back }: Props) {
  return (
    <div className="clinic-sub">
      <header className="clinic-sub-header">
        <Button
          className="panel-icon-btn"
          aria-label={back?.label ?? 'Voltar à Clínica'}
          onPress={() =>
            navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: back?.section ?? 'hub' })
          }
        >
          <ChevronLeft aria-hidden size={22} strokeWidth={2} />
        </Button>
        <span className="clinic-sub-titles">
          <h1 className="clinic-sub-title">{title}</h1>
          <span className="clinic-sub-eyebrow">{back?.eyebrow ?? 'Clínica'}</span>
        </span>
      </header>
      {children}
    </div>
  )
}
