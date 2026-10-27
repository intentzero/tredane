import type { ReactNode } from 'react'

export type BadgeTone = 'new' | 'open' | 'closed' | 'wait' | 'bad' | 'ai'

/**
 * Estado de um item (conversa, cobrança, mensagem). Não é clicável: se clica,
 * é chip. A cor nunca vem sozinha: sempre há texto (e ícone em espera/falha).
 */
export function Badge({
  tone,
  icon,
  children,
}: {
  tone: BadgeTone
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <span className={`panel-badge panel-badge-${tone}`}>
      {icon}
      {children}
    </span>
  )
}
