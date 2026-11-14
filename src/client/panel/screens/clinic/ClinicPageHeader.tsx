import type { ReactNode } from 'react'
import { useMediaQuery } from '../../ui/useMediaQuery'
import { ShellSlot } from '../../shell/ShellSlot'

type Props = {
  title: string
  description?: string
  action?: ReactNode
}

/**
 * Cabeçalho de página da Clínica (DEC-175): título, uma frase e, se houver, a ação principal.
 * No celular o título já está no cabeçalho único (DEC-163); aqui fica só a frase.
 * No desktop (≥ 1280 px, DEC-183) o título e a ação principal sobem para o cabeçalho do
 * shell, no espaço livre à direita de «Clínica»; no corpo fica só a frase.
 */
export function ClinicPageHeader({ title, description, action }: Props) {
  const wide = useMediaQuery('(min-width: 1280px)')
  if (wide) {
    return (
      <>
        <ShellSlot>
          <h2 className="clinic-bar-title">{title}</h2>
          {action ? <div className="clinic-bar-action">{action}</div> : null}
        </ShellSlot>
        {description ? <p className="clinic-page-desc">{description}</p> : null}
      </>
    )
  }
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
