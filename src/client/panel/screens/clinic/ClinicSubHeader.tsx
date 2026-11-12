import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from 'react-aria-components'
import { navigatePanel } from '../../routes'

type Props = {
  tenantId: string
  title: string
  children: ReactNode
}

/**
 * DEC-163: no celular, as telas internas da Clínica têm um só cabeçalho de 56 px
 * (voltar, título, «Clínica»); o cabeçalho global e os «Voltar» soltos somem (CSS).
 */
export function ClinicSubScreen({ tenantId, title, children }: Props) {
  return (
    <div className="clinic-sub">
      <header className="clinic-sub-header">
        <Button
          className="panel-icon-btn"
          aria-label="Voltar à Clínica"
          onPress={() => navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'hub' })}
        >
          <ChevronLeft aria-hidden size={22} strokeWidth={2} />
        </Button>
        <span className="clinic-sub-titles">
          <h1 className="clinic-sub-title">{title}</h1>
          <span className="clinic-sub-eyebrow">Clínica</span>
        </span>
      </header>
      {children}
    </div>
  )
}
