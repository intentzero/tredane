import type { ReactNode } from 'react'

type Props = {
  title: string
  description?: string
  action?: ReactNode
}

/**
 * Cabeçalho de página da Clínica (DEC-175): título, uma frase e, se houver, a ação principal.
 * No celular o título já está no cabeçalho único (DEC-163); aqui fica só a frase.
 */
export function ClinicPageHeader({ title, description, action }: Props) {
  return (
    <header className="clinic-page-header">
      <div className="clinic-page-header-copy">
        <h1 className="clinic-page-title">{title}</h1>
        {description ? <p className="clinic-page-desc">{description}</p> : null}
      </div>
      {action ? <div className="clinic-page-header-action">{action}</div> : null}
    </header>
  )
}
